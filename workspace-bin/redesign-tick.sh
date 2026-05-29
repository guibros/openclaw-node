#!/usr/bin/env bash
# redesign-tick.sh — one autonomous tick of the OpenClaw memory-REDESIGN workplan.
#
# Targets memory-plan/plans/redesign/ (the siloed active plan). Adapted from
# workspace-bin/memory-plan-tick.sh. The redesign TICK_PROMPT enforces the new
# discipline: runtime-evidence done-contract, the Re-Orient Loop, BLOCK-not-fake.
#
# Modes:
#   ./workspace-bin/redesign-tick.sh --preflight   # dry-run: report next step, do NOT invoke claude
#   ./workspace-bin/redesign-tick.sh               # run one real tick (invokes headless claude)
#   DRY_RUN=1 ./workspace-bin/redesign-tick.sh      # full pre-flight then stop before claude
#
# Exit codes: 0 ran/short-circuit/blocked-already · 1 wrapper failure · 2 tick wrote BLOCKED.md
#
# NOTE: this script is built but its launchd plist is intentionally NOT loaded.
# Enabling autonomous ticks (and for which steps) is a separate operator decision
# — see memory-plan/plans/redesign/DECISIONS.md. The runtime-evidence gate in the TICK_PROMPT
# makes it safe to attempt steps: it BLOCKS rather than fake-closes.

set -euo pipefail

REPO="/Users/moltymac/openclaw-nodedev"
PLAN_DIR="${REPO}/memory-plan/plans/redesign"
TICK_LOG_DIR="${PLAN_DIR}/tick-logs"
PROMPT_FILE="${PLAN_DIR}/TICK_PROMPT.md"
BLOCK_FILE="${PLAN_DIR}/BLOCKED.md"
VERSION_FILE="${PLAN_DIR}/VERSION"
INVENTORY_FILE="${PLAN_DIR}/INVENTORY.md"
LOCK_DIR="${PLAN_DIR}/.tick.lock"

MODE="run"
case "${1:-}" in
  --preflight) MODE="preflight" ;;
  "") : ;;
  *) echo "unknown arg: $1 (use --preflight or no arg)"; exit 1 ;;
esac

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] %s\n' "$(ts)" "$*"; }

# Find the first [ ] or [A] inventory row → "next step". Echoes "version|step|desc" or empty.
next_step() {
  grep -E '^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[(A| )\]' "${INVENTORY_FILE}" 2>/dev/null \
    | head -1 \
    | awk -F'|' '{ gsub(/^ +| +$/,"",$3); gsub(/^ +| +$/,"",$5); gsub(/^ +| +$/,"",$6); print $4"|"$3"|"$6 }'
}

# ── Wrapper-level pre-flight (cheap, no claude) ───────────────────────────────

[ -d "${REPO}/.git" ] || { log "FATAL: ${REPO} is not a git repo"; exit 1; }
[ -f "${PROMPT_FILE}" ] || { log "FATAL: ${PROMPT_FILE} missing"; exit 1; }
[ -f "${INVENTORY_FILE}" ] || { log "FATAL: ${INVENTORY_FILE} missing"; exit 1; }
[ -f "${VERSION_FILE}" ] || { log "FATAL: ${VERSION_FILE} missing"; exit 1; }

VERSION=$(cat "${VERSION_FILE}" 2>/dev/null || echo "")
NEXT=$(next_step || true)

# --preflight: report and exit WITHOUT invoking claude or taking the lock.
if [ "${MODE}" = "preflight" ]; then
  log "=== redesign-tick PREFLIGHT (no claude invoked) ==="
  log "plan dir:    ${PLAN_DIR}"
  log "prompt:      ${PROMPT_FILE}"
  log "VERSION:     ${VERSION:-<unset>}"
  if [ -f "${BLOCK_FILE}" ]; then
    log "BLOCKED.md:  PRESENT — a real tick would exit immediately"
  else
    log "BLOCKED.md:  absent"
  fi
  cd "${REPO}"
  DIRTY=$(git status --short)
  log "tree:        $([ -n "${DIRTY}" ] && echo dirty || echo clean)"
  if [ -n "${NEXT}" ]; then
    log "next step:   $(printf '%s' "${NEXT}" | awk -F'|' '{print $2" ("$1") — "$3}')"
  else
    log "next step:   NONE — all steps closed (plan complete)"
  fi
  command -v claude >/dev/null 2>&1 && log "claude CLI:  present" || log "claude CLI:  MISSING (real tick would FATAL)"
  log "=== end preflight ==="
  exit 0
fi

# ── Real tick ─────────────────────────────────────────────────────────────────

command -v claude >/dev/null 2>&1 || { log "FATAL: claude CLI not on PATH"; exit 1; }
mkdir -p "${TICK_LOG_DIR}"

# Single-tick lock (mkdir atomicity; macOS has no flock). Reap stale >60min.
if [ -d "${LOCK_DIR}" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "${LOCK_DIR}" 2>/dev/null || echo 0) ))
  if [ "${LOCK_AGE}" -lt 3600 ]; then
    log "skip: another tick is already running (lock age=${LOCK_AGE}s)"; exit 0
  fi
  log "info: reaping stale lock (age=${LOCK_AGE}s)"; rmdir "${LOCK_DIR}" 2>/dev/null || rm -rf "${LOCK_DIR}"
fi
mkdir "${LOCK_DIR}" 2>/dev/null || { log "skip: lock race lost"; exit 0; }
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

maybe_autopause() {
  local reason="$1"
  [ "${WORKPLAN_AUTOPAUSE:-0}" = "1" ] || return 0
  [ -n "${WORKPLAN_PLIST_LABEL:-}" ] || return 0
  local target="gui/$(id -u)/${WORKPLAN_PLIST_LABEL}"
  log "auto-pause: ${reason} — disabling ${WORKPLAN_PLIST_LABEL}"
  launchctl disable "${target}" >/dev/null 2>&1 || true
  launchctl bootout  "${target}" >/dev/null 2>&1 || true
}

if [ -f "${BLOCK_FILE}" ]; then
  log "skip: ${BLOCK_FILE} present — operator must clear before next tick"
  maybe_autopause "BLOCKED.md present"; exit 0
fi

cd "${REPO}"
DIRTY=$(git status --short)
if [ -n "${DIRTY}" ]; then
  case "${VERSION}" in
    *-pre|*-mid) log "info: tree dirty but VERSION=${VERSION} (in-flight); proceeding" ;;
    *) log "skip: tree dirty on clean VERSION=${VERSION} — unexpected; not invoking claude"
       printf '%s\n' "${DIRTY}" | sed 's/^/        /'
       maybe_autopause "dirty tree on clean VERSION"; exit 0 ;;
  esac
fi

if [ -z "${NEXT}" ]; then
  log "skip: no [A]/[ ] rows in inventory — redesign plan fully closed"
  maybe_autopause "redesign plan complete"; exit 0
fi

TICK_LOG="${TICK_LOG_DIR}/$(date '+%Y%m%d-%H%M%S').log"
log "starting redesign tick → ${TICK_LOG}"
log "VERSION=${VERSION:-<unset>}  next=$(printf '%s' "${NEXT}" | awk -F'|' '{print $2}')"

if [ "${DRY_RUN:-0}" = "1" ]; then log "DRY_RUN=1 → not invoking claude"; exit 0; fi

unset CLAUDECODE CLAUDECODE_TICK CLAUDE_CODE_ENTRYPOINT
TICK_RAW="${TICK_LOG%.log}.jsonl"
PRETTY="${REPO}/workspace-bin/memory-plan-pretty-stream.sh"
TICK_START_EPOCH=$(date +%s)
CURRENT_LINK="${TICK_LOG_DIR}/current.log"
ln -sfn "$(basename "${TICK_LOG}")" "${CURRENT_LINK}"

{
  printf '## Redesign tick started: %s\n' "$(ts)"
  printf '## VERSION at start: %s\n' "${VERSION:-<unset>}"
  printf '## Next step: %s\n' "${NEXT}"
  printf '## ─── live claude work ───\n'
  set +e
  cat "${PROMPT_FILE}" | claude \
    --print \
    --permission-mode acceptEdits \
    --add-dir "/Users/moltymac/.openclaw/workspace" \
    --add-dir "/Users/moltymac/.openclaw" \
    --output-format stream-json \
    --verbose \
    | tee "${TICK_RAW}" \
    | { [ -x "${PRETTY}" ] && "${PRETTY}" || cat; }
  CLAUDE_RC=${PIPESTATUS[0]}
  set -e
  printf '\n## ─── end claude (rc=%d) ───\n' "${CLAUDE_RC}"
  printf '## Redesign tick ended: %s\n' "$(ts)"
} >>"${TICK_LOG}" 2>&1

TICK_DURATION=$(( $(date +%s) - "${TICK_START_EPOCH:-$(date +%s)}" ))
log "claude exited rc=${CLAUDE_RC:-?} after ${TICK_DURATION}s"

DIGEST_FILE="${HOME}/.openclaw/workspace/memory/redesign-progress.md"
mkdir -p "$(dirname "${DIGEST_FILE}")"
[ -f "${DIGEST_FILE}" ] || printf '# Memory Redesign — Progress digest\n\nOne line per autonomous tick. Newest at bottom.\n\n' > "${DIGEST_FILE}"
POST_VERSION=$(cat "${VERSION_FILE}" 2>/dev/null || echo "?")
LATEST_COMMIT=$(git -C "${REPO}" log -1 --format='%h %s' 2>/dev/null || echo "?")

if [ -f "${BLOCK_FILE}" ]; then
  TRIG=$(grep -m1 '^\*\*Trigger\*\*:' "${BLOCK_FILE}" 2>/dev/null | sed 's/^\*\*Trigger\*\*: //' | cut -c1-120)
  printf -- '- `%s` BLOCKED at `%s` — %s\n' "$(ts)" "${POST_VERSION}" "${TRIG:-see BLOCKED.md}" >> "${DIGEST_FILE}"
  log "tick blocked — see ${BLOCK_FILE}"; exit 2
fi

if [ "${POST_VERSION}" != "${VERSION:-}" ] && printf '%s' "${POST_VERSION}" | grep -qvE -- '-pre$|-mid$'; then
  printf -- '- `%s` closed `%s` — %s\n' "$(ts)" "${POST_VERSION}" "${LATEST_COMMIT}" >> "${DIGEST_FILE}"
elif [ "${POST_VERSION}" != "${VERSION:-}" ]; then
  printf -- '- `%s` progress: `%s` → `%s`\n' "$(ts)" "${VERSION:-?}" "${POST_VERSION}" >> "${DIGEST_FILE}"
fi

log "tick done (rc=${CLAUDE_RC:-?})"
exit 0
