#!/usr/bin/env bash
# memory-plan-tick.sh — one autonomous tick of the OpenClaw Memory Plan workplan.
#
# Invoked by launchd (~/Library/LaunchAgents/com.openclaw.memory-plan-tick.plist)
# on a 30-minute cadence. May also be run manually for testing.
#
# Behavior:
#   1. Pre-flight at the wrapper level (cheap checks that don't require Claude).
#   2. If BLOCKED.md exists, exit immediately without launching Claude.
#   3. Otherwise, invoke `claude -p` with the TICK_PROMPT.md body as input.
#   4. Capture stdout to a tick log under memory-plan/tick-logs/.
#
# Exit codes:
#   0  — tick ran to completion (step closed, or pre-flight short-circuit, or already-blocked).
#   1  — wrapper-level failure (claude CLI missing, repo missing, etc).
#   2  — tick attempted but blocked (BLOCKED.md was written by the tick).
#
# Manual usage:
#   ./workspace-bin/memory-plan-tick.sh             # default: run one tick now
#   DRY_RUN=1 ./workspace-bin/memory-plan-tick.sh   # print plan, do not invoke claude

set -euo pipefail

REPO="/Users/moltymac/openclaw-nodedev"
PLAN_DIR="${REPO}/memory-plan"
TICK_LOG_DIR="${PLAN_DIR}/tick-logs"
PROMPT_FILE="${PLAN_DIR}/TICK_PROMPT.md"
BLOCK_FILE="${PLAN_DIR}/BLOCKED.md"
VERSION_FILE="${PLAN_DIR}/VERSION"
INVENTORY_FILE="${PLAN_DIR}/INVENTORY.md"
LOCK_DIR="${PLAN_DIR}/.tick.lock"

# ── Wrapper-level pre-flight ──────────────────────────────────────────────────

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] %s\n' "$(ts)" "$*"; }

[ -d "${REPO}/.git" ] || { log "FATAL: ${REPO} is not a git repo"; exit 1; }
[ -f "${PROMPT_FILE}" ] || { log "FATAL: ${PROMPT_FILE} missing"; exit 1; }
command -v claude >/dev/null 2>&1 || { log "FATAL: claude CLI not on PATH"; exit 1; }

mkdir -p "${TICK_LOG_DIR}"

# Single-tick lock: a previous tick must not still be running.
# Use mkdir() atomicity since macOS doesn't ship flock(1). Stale locks older
# than 60 minutes are reaped (longer than the per-tick budget).
if [ -d "${LOCK_DIR}" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "${LOCK_DIR}" 2>/dev/null || echo 0) ))
  if [ "${LOCK_AGE}" -lt 3600 ]; then
    log "skip: another tick is already running (lock: ${LOCK_DIR}, age=${LOCK_AGE}s)"
    exit 0
  fi
  log "info: reaping stale lock (age=${LOCK_AGE}s)"
  rmdir "${LOCK_DIR}" 2>/dev/null || rm -rf "${LOCK_DIR}"
fi
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  log "skip: lock race lost — another tick won"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

# Auto-pause helper. When run under launchd with WORKPLAN_AUTOPAUSE=1, fast-exit
# paths tell launchd to unload this job (stop polling) instead of looping every
# ThrottleInterval seconds. Operator resumes via the viewer's Resume button or
# by running `launchctl enable gui/$UID/<label> && launchctl bootstrap …`.
#
# Earlier attempt used a detached subshell to delay the bootout, hoping to
# survive launchd's job-tree cleanup. It didn't — the subshell was killed
# before sleep completed. New approach:
#   1. `launchctl disable` first — synchronous, sets a persistent flag, does
#      not try to kill us. After the wrapper exits, launchd checks the flag
#      and skips the next refire. This alone is sufficient to stop polling.
#   2. `launchctl bootout` after, best-effort, to also remove from the current
#      session. May SIGTERM us mid-call; the EXIT trap still fires.
maybe_autopause() {
  local reason="$1"
  [ "${WORKPLAN_AUTOPAUSE:-0}" = "1" ] || return 0
  [ -n "${WORKPLAN_PLIST_LABEL:-}" ] || return 0
  local target="gui/$(id -u)/${WORKPLAN_PLIST_LABEL}"
  log "auto-pause: ${reason} — disabling ${WORKPLAN_PLIST_LABEL}"
  launchctl disable "${target}" >/dev/null 2>&1 || true
  launchctl bootout  "${target}" >/dev/null 2>&1 || true
}

# Write a BLOCKED.md describing a dirty-tree situation so the operator has
# context when they investigate. Idempotent — won't overwrite an existing one.
write_dirty_tree_block_file() {
  [ -f "${BLOCK_FILE}" ] && return 0
  local stamp
  stamp=$(date '+%Y-%m-%d %H:%M:%S %z')
  {
    printf '# CONTINUATION_BLOCKED — %s\n\n' "${stamp}"
    printf '**Step**: (pre-tick guard)\n'
    printf '**Phase you were in**: (pre-flight)\n'
    printf '**Trigger**: working tree dirty on clean VERSION=%s\n\n' "${VERSION:-?}"
    printf '## What failed\n\n'
    printf 'The tick wrapper found uncommitted/untracked files in the working tree, but\n'
    printf 'VERSION=`%s` is clean (no `-pre` / `-mid` suffix). This means the changes are\n' "${VERSION:-?}"
    printf 'unexpected — either an in-progress edit the operator made by hand, leftover\n'
    printf 'artifacts from a previous run, or a bug.\n\n'
    printf '```\n'
    printf '%s\n' "${DIRTY}"
    printf '```\n\n'
    printf "## What's needed from the user\n\n"
    printf -- '- Inspect each file: keep, stash, commit, or `git restore` it.\n'
    printf -- '- Delete this `BLOCKED.md`.\n'
    printf -- '- The scheduler was auto-unloaded; re-enable it from the viewer\n'
    printf '  (Automation tab → ▶ Load scheduler) or by clicking ▶ Resume on the Block tab.\n\n'
    printf '## How to resume\n\n'
    printf '1. Address the dirty files above.\n'
    printf '2. Delete this file (or click Resume in the viewer).\n'
    printf '3. The next tick will proceed.\n\n'
    printf '## State at block\n\n'
    printf -- '- Source: auto-pause from `memory-plan-tick.sh` pre-flight\n'
    printf -- '- Time: %s\n' "${stamp}"
    printf -- '- VERSION: `%s`\n' "${VERSION:-?}"
  } > "${BLOCK_FILE}"
  log "      wrote ${BLOCK_FILE} with dirty-tree details"
}

# If BLOCKED.md is present, exit silently. The operator must delete it.
if [ -f "${BLOCK_FILE}" ]; then
  log "skip: ${BLOCK_FILE} present — operator must clear before next tick"
  maybe_autopause "BLOCKED.md present"
  exit 0
fi

# Hard pre-flight: working tree must be clean OR matched against an in-flight sub-version.
cd "${REPO}"
DIRTY=$(git status --short)
VERSION=$(cat "${VERSION_FILE}" 2>/dev/null || echo "")

if [ -n "${DIRTY}" ]; then
  case "${VERSION}" in
    *-pre|*-mid)
      log "info: working tree dirty but VERSION=${VERSION} (in-flight sub-version); proceeding"
      ;;
    *)
      log "skip: working tree dirty and VERSION=${VERSION} (clean) — unexpected dirt; not invoking claude"
      log "      git status --short:"
      printf '%s\n' "${DIRTY}" | sed 's/^/        /'
      write_dirty_tree_block_file
      maybe_autopause "dirty working tree on clean VERSION"
      exit 0
      ;;
  esac
fi

# Inventory must have at least one [A] or [ ] row, else write block-close ceremony hint.
if ! grep -E '^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[(A| )\]' "${INVENTORY_FILE}" >/dev/null 2>&1; then
  log "skip: no [A]/[ ] rows in inventory — plan is fully closed"
  maybe_autopause "plan complete (all steps closed)"
  exit 0
fi

# ── Invoke claude headless with TICK_PROMPT.md as the prompt ──────────────────

TICK_LOG="${TICK_LOG_DIR}/$(date '+%Y%m%d-%H%M%S').log"
log "starting tick → ${TICK_LOG}"
log "VERSION=${VERSION:-<unset>}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  log "DRY_RUN=1 → not invoking claude"
  exit 0
fi

# `--print` runs headless. `--permission-mode acceptEdits` allows file edits without
# interactive prompts (the framework's Deep Review Gate is the real safety net).
# `--add-dir` grants tool access to the workspace (out of repo) for runtime-file inspection.
# Unset CLAUDECODE so the headless invocation isn't blocked as "nested".
# Safe in production (launchd has no parent CLAUDECODE); also enables manual
# smoke tests from inside an interactive `claude` session. The child's
# environment is independent — the parent session is not affected.
unset CLAUDECODE CLAUDECODE_TICK CLAUDE_CODE_ENTRYPOINT

TICK_RAW="${TICK_LOG%.log}.jsonl"
PRETTY="${REPO}/workspace-bin/memory-plan-pretty-stream.sh"
TICK_START_EPOCH=$(date +%s)

# Heartbeat: emit a one-line proof-of-life to OUR stdout (= launchd.stdout.log)
# every 60s while claude is running. Without this the launchd log sits silent
# for 5-15 minutes between "starting tick" and "tick done", making it look
# stuck. The subshell is backgrounded BEFORE the heredoc block so its stdout
# is the wrapper's stdout, not the redirected TICK_LOG.
(
  while sleep 60; do
    NOW=$(date +%s)
    ELAPSED=$(( NOW - TICK_START_EPOCH ))
    MINS=$(( ELAPSED / 60 ))
    TICK_SIZE=0
    [ -f "${TICK_LOG}" ] && TICK_SIZE=$(stat -f '%z' "${TICK_LOG}" 2>/dev/null || echo 0)
    TICK_KB=$(( TICK_SIZE / 1024 ))
    log "heartbeat: ${MINS}m elapsed · ${TICK_KB} KB written · log=$(basename "${TICK_LOG}")"
  done
) &
HEARTBEAT_PID=$!
# Re-set the trap to also kill the heartbeat. Defensive against unset var.
trap 'kill "${HEARTBEAT_PID:-}" 2>/dev/null || true; rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

{
  printf '## Tick started: %s\n' "$(ts)"
  printf '## VERSION at start: %s\n' "${VERSION:-<unset>}"
  printf '## Working tree dirty? %s\n' "$([ -n "${DIRTY}" ] && echo yes || echo no)"
  printf '## Raw JSON stream: %s\n' "$(basename "${TICK_RAW}")"
  printf '## ─── live claude work ───\n'
  set +e
  # stream-json + verbose → events flush line-by-line as claude works.
  # tee → raw .jsonl for forensics. pretty-stream → readable lines into log.
  # PIPESTATUS[0] = claude's exit code (what we care about).
  cat "${PROMPT_FILE}" | claude \
    --print \
    --permission-mode acceptEdits \
    --add-dir "/Users/moltymac/.openclaw/workspace" \
    --add-dir "/Users/moltymac/.openclaw" \
    --output-format stream-json \
    --verbose \
    | tee "${TICK_RAW}" \
    | "${PRETTY}"
  CLAUDE_RC=${PIPESTATUS[0]}
  set -e
  printf '\n## ─── end claude (rc=%d) ───\n' "${CLAUDE_RC}"
  printf '## Tick ended: %s\n' "$(ts)"
} >>"${TICK_LOG}" 2>&1

# Stop heartbeat now that claude is done; the EXIT trap also handles this.
kill "${HEARTBEAT_PID:-}" 2>/dev/null || true
TICK_DURATION=$(( $(date +%s) - "${TICK_START_EPOCH:-$(date +%s)}" ))
log "claude exited rc=${CLAUDE_RC:-?} after ${TICK_DURATION}s"

# ── Post-tick observability ──────────────────────────────────────────────────
# Regenerate the markdown timeline (best-effort; never blocks exit).
"${REPO}/workspace-bin/memory-plan-timeline.sh" >/dev/null 2>&1 || true

# Append a one-line digest entry to the workspace memory file. The file is
# outside the repo so it doesn't dirty the working tree. Daedalus (the interactive
# session) can be pointed at it via CLAUDE.md if desired.
DIGEST_FILE="${HOME}/.openclaw/workspace/memory/memory-plan-progress.md"
mkdir -p "$(dirname "${DIGEST_FILE}")"
if [ ! -f "${DIGEST_FILE}" ]; then
  printf '# Memory Plan — Progress digest\n\nOne line per autonomous tick. Newest at bottom.\n\n' > "${DIGEST_FILE}"
fi

POST_VERSION=$(cat "${VERSION_FILE}" 2>/dev/null || echo "?")
LATEST_COMMIT=$(git -C "${REPO}" log -1 --format='%h %s' 2>/dev/null || echo "?")

if [ -f "${BLOCK_FILE}" ]; then
  TRIG=$(grep -m1 '^\*\*Trigger\*\*:' "${BLOCK_FILE}" 2>/dev/null | sed 's/^\*\*Trigger\*\*: //' | cut -c1-120)
  printf -- '- `%s` BLOCKED at `%s` — %s\n' "$(ts)" "${POST_VERSION}" "${TRIG:-see BLOCKED.md}" >> "${DIGEST_FILE}"
  "${REPO}/workspace-bin/memory-plan-notify.sh" blocked "${POST_VERSION}" "${TRIG:-see BLOCKED.md}" >/dev/null 2>&1 || true
  log "tick blocked — see ${BLOCK_FILE}"
  exit 2
fi

# Did this tick close a step? Detect by comparing pre/post VERSION.
if [ "${POST_VERSION}" != "${VERSION:-}" ] && printf '%s' "${POST_VERSION}" | grep -qvE -- '-pre$|-mid$'; then
  printf -- '- `%s` closed `%s` — %s\n' "$(ts)" "${POST_VERSION}" "${LATEST_COMMIT}" >> "${DIGEST_FILE}"
  STEP_DESC=$(printf '%s' "${LATEST_COMMIT}" | sed -E 's/^[a-f0-9]+ v[0-9]+\.[0-9]+ — //' | cut -c1-120)
  "${REPO}/workspace-bin/memory-plan-notify.sh" closed "${POST_VERSION}" "${STEP_DESC}" >/dev/null 2>&1 || true
elif [ "${POST_VERSION}" != "${VERSION:-}" ]; then
  # In-flight sub-version progress (e.g. v0.3-pre or -mid). Log silently, no notification.
  printf -- '- `%s` progress: `%s` → `%s`\n' "$(ts)" "${VERSION:-?}" "${POST_VERSION}" >> "${DIGEST_FILE}"
fi

log "tick done (rc=${CLAUDE_RC:-?})"
exit 0
