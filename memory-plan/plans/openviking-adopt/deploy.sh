#!/usr/bin/env bash
# deploy.sh — deploy the openviking-adopt batch onto THIS node and run the
# INVENTORY runtime probes (PROTOCOL §3 Phase 5, MASTER_PLAN §4.1).
#
# Run on the node, from the repo checkout that ~/.openclaw/workspace/lib
# symlinks to (redesign 0.1/0.2):
#
#   bash memory-plan/plans/openviking-adopt/deploy.sh            # deploy + probe
#   bash memory-plan/plans/openviking-adopt/deploy.sh --probe    # probes only
#   bash memory-plan/plans/openviking-adopt/deploy.sh --no-gateway
#
# What it does, in order:
#   1. preflight — the runtime lib IS this checkout (else refuse), node, sqlite3
#   2. root `npm install` (the sharp 0.35.4 lockfile) — non-destructive
#   3. restart ai.openclaw.memory-daemon (launchd kickstart -k), wait for :7893
#   4. Block 2/1 deploy: one knowledge index pass (schema v2, directory
#      summaries built) + the path-scope probe, via probe.mjs
#   5. Block 4 deploy: install the context-engine plugin into the gateway and
#      point plugins.slots.contextEngine at it, restart the gateway
#   6. print PASS / FAIL / PENDING per INVENTORY step and write the record to
#      audits/deploy_<ts>.md — the Runtime-Evidence for closing rows.
#
# Rollback: `git checkout main && launchctl kickstart -k gui/$UID/ai.openclaw.memory-daemon`
# (schema bumps are additive; old code ignores the new tables/columns) and
# `openclaw config set plugins.slots.contextEngine legacy`.

set -u

PLAN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$PLAN_DIR/../../.." && pwd)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_ROOT/workspace}"
STATE_DB="${OPENCLAW_STATE_DB:-$OPENCLAW_ROOT/state.db}"
KNOWLEDGE_DB="${KNOWLEDGE_DB:-$WORKSPACE/.knowledge.db}"
TOKEN_FILE="$OPENCLAW_ROOT/config/memory-injection-token"
INJECT_URL="${MEMORY_INJECT_URL:-http://127.0.0.1:7893}"
PLUGIN_SRC="$REPO/packages/openclaw-memory-context-engine"
PLUGIN_ID="openclaw-node-memory"
TS="$(date '+%Y-%m-%d_%H%M%S')"
REPORT="$PLAN_DIR/audits/deploy_${TS}.md"

DO_DEPLOY=1; DO_GATEWAY=1
for a in "$@"; do
  case "$a" in
    --probe) DO_DEPLOY=0 ;;
    --no-gateway) DO_GATEWAY=0 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

RESULTS=""
say()  { printf '%s\n' "$*"; }
head1(){ printf '\n\033[1m== %s\033[0m\n' "$*"; }
record(){ # step status detail
  RESULTS="${RESULTS}| $1 | $2 | $3 |"$'\n'
  case "$2" in
    PASS)    printf '  \033[32mPASS\033[0m    %s — %s\n' "$1" "$3" ;;
    FAIL)    printf '  \033[31mFAIL\033[0m    %s — %s\n' "$1" "$3" ;;
    *)       printf '  \033[33m%s\033[0m %s — %s\n' "$2" "$1" "$3" ;;
  esac
}
die() { printf '\033[31mABORT:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. preflight ─────────────────────────────────────────────────────────────
head1 "preflight"
[ "$(uname)" = "Darwin" ] || say "note: not macOS — launchctl steps will be skipped"
command -v node >/dev/null || die "node not on PATH"
command -v sqlite3 >/dev/null || die "sqlite3 not on PATH"
say "repo:      $REPO ($(git -C "$REPO" rev-parse --abbrev-ref HEAD) @ $(git -C "$REPO" rev-parse --short HEAD))"
say "workspace: $WORKSPACE"
if [ -L "$WORKSPACE/lib" ]; then
  LIB_TARGET="$(cd "$WORKSPACE/lib" && pwd -P)"
  if [ "$LIB_TARGET" != "$REPO/lib" ]; then
    die "$WORKSPACE/lib -> $LIB_TARGET, not this checkout ($REPO/lib). Run from the checkout the runtime symlinks to (redesign 0.1)."
  fi
  say "runtime lib is this checkout (symlink) — code is live on disk"
else
  die "$WORKSPACE/lib is not a symlink; the redesign 0.1 deploy-gap closure is not in place on this node"
fi
[ -f "$TOKEN_FILE" ] || say "note: no inject token yet at $TOKEN_FILE (the daemon writes it on first start)"

# ── 2. deps + daemon restart ──────────────────────────────────────────────────
if [ "$DO_DEPLOY" = 1 ]; then
  head1 "root dependencies (sharp 0.35.4 lockfile)"
  (cd "$REPO" && npm install --no-audit --no-fund --omit=dev 2>&1 | tail -3) || die "npm install failed"
  if [ -f "$REPO/packages/event-schemas/tsconfig.json" ] && [ ! -f "$REPO/packages/event-schemas/dist/index.js" ]; then
    (cd "$REPO" && npx --yes --package typescript@5 tsc -p packages/event-schemas/tsconfig.json) || die "event-schemas build failed"
  fi

  head1 "restart memory daemon"
  if [ "$(uname)" = "Darwin" ]; then
    launchctl kickstart -k "gui/$(id -u)/ai.openclaw.memory-daemon" 2>&1 || say "kickstart returned non-zero (unit not loaded?) — continuing"
  else
    say "non-macOS: restart the memory daemon yourself, then re-run with --probe"
  fi
fi

head1 "inject server"
TOKEN=""; [ -f "$TOKEN_FILE" ] && TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
OK=0
for i in $(seq 1 30); do
  if [ -n "$TOKEN" ] && curl -fsS -m 3 -H "Authorization: Bearer $TOKEN" "$INJECT_URL/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
  [ -z "$TOKEN" ] && [ -f "$TOKEN_FILE" ] && TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
done
if [ "$OK" = 1 ]; then
  PID="$(launchctl list 2>/dev/null | awk '$3=="ai.openclaw.memory-daemon"{print $1}')"
  record "daemon" PASS ":7893 /health ok (pid ${PID:-?})"
else
  record "daemon" FAIL ":7893 not answering after 30s — check $WORKSPACE/.tmp/memory-daemon.err"
fi

# ── 3. Block 3 — extraction-store schema v6 ───────────────────────────────────
head1 "Block 3 — extraction store"
if [ -f "$STATE_DB" ]; then
  UV="$(sqlite3 "$STATE_DB" 'PRAGMA user_version' 2>/dev/null)"
  HAS_ALIASES="$(sqlite3 "$STATE_DB" "SELECT COUNT(*) FROM sqlite_master WHERE name='entity_aliases'" 2>/dev/null)"
  HAS_SUP="$(sqlite3 "$STATE_DB" "SELECT COUNT(*) FROM pragma_table_info('decisions') WHERE name='superseded_by'" 2>/dev/null)"
  if [ "$UV" = "6" ] && [ "$HAS_ALIASES" = "1" ] && [ "$HAS_SUP" = "1" ]; then
    record "3.1" PASS "state.db user_version=6, entity_aliases + decisions.superseded_by present"
  elif [ "$OK" = 1 ]; then
    record "3.1" FAIL "state.db user_version=$UV aliases=$HAS_ALIASES superseded_by=$HAS_SUP (daemon up but migration not applied — is the daemon running this checkout?)"
  else
    record "3.1" PENDING "daemon not up; migration runs when it opens the store"
  fi
  NA="$(sqlite3 "$STATE_DB" 'SELECT COUNT(*) FROM entity_aliases' 2>/dev/null || echo 0)"
  NS="$(sqlite3 "$STATE_DB" 'SELECT COUNT(*) FROM decisions WHERE superseded_by IS NOT NULL' 2>/dev/null || echo 0)"
  NE="$(sqlite3 "$STATE_DB" 'SELECT COUNT(*) FROM entities' 2>/dev/null || echo 0)"
  if [ "${NA:-0}" -gt 0 ] || [ "${NS:-0}" -gt 0 ]; then
    record "3.2" PASS "entity_aliases=$NA superseded decisions=$NS (entities=$NE)"
  else
    record "3.2" PENDING "no live flush yet since deploy: entity_aliases=$NA superseded=$NS (entities=$NE). Re-run --probe after the next session flush (idle 15 min / session end)."
  fi
else
  record "3.1" FAIL "no state.db at $STATE_DB"
fi

# ── 4. Blocks 1+2 — knowledge index pass + probes ─────────────────────────────
head1 "Blocks 1+2 — knowledge index (embedder loads; first pass can take minutes)"
PROBE_OUT="$(cd "$REPO" && KNOWLEDGE_ROOT="$WORKSPACE" KNOWLEDGE_DB="$KNOWLEDGE_DB" node "$PLAN_DIR/probe.mjs" 2>&1)"
PROBE_RC=$?
printf '%s\n' "$PROBE_OUT" | sed 's/^/    /'
# probe.mjs prints machine lines: STEP <id> <PASS|FAIL|PENDING> <detail>
while IFS= read -r line; do
  case "$line" in
    "STEP "*) set -- $line; id="$2"; st="$3"; shift 3; record "$id" "$st" "$*" ;;
  esac
done <<EOF2
$PROBE_OUT
EOF2
[ "$PROBE_RC" = 0 ] || record "probe" FAIL "probe.mjs exited $PROBE_RC"

# ── 5. Block 4 — gateway plugin ───────────────────────────────────────────────
head1 "Block 4 — OpenClaw context-engine plugin"
if [ "$DO_GATEWAY" = 0 ]; then
  record "4.1" PENDING "--no-gateway"
elif ! command -v openclaw >/dev/null; then
  record "4.1" PENDING "openclaw CLI not on PATH — install the gateway, then: openclaw plugins install $PLUGIN_SRC && openclaw config set plugins.slots.contextEngine $PLUGIN_ID"
else
  if [ "$DO_DEPLOY" = 1 ]; then
    if ! openclaw plugins install "$PLUGIN_SRC" 2>&1 | tail -3; then
      say "plugin manager refused a local path — deploying as an extension dir instead"
      EXT="$OPENCLAW_ROOT/extensions/$PLUGIN_ID"
      mkdir -p "$EXT" && rsync -a --delete "$PLUGIN_SRC/" "$EXT/" || die "extension copy failed"
    fi
    openclaw config set plugins.slots.contextEngine "$PLUGIN_ID" 2>&1 | tail -2
    [ "$(uname)" = "Darwin" ] && launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway" 2>/dev/null
  fi
  SLOT="$(openclaw config get plugins.slots.contextEngine 2>/dev/null | tr -d '[:space:]"')"
  if [ "$SLOT" = "$PLUGIN_ID" ]; then
    record "4.1" PASS "plugins.slots.contextEngine=$SLOT. Confirm on the next gateway turn: memory.injected event with frontend=openclaw-context-engine (Mission Control → watcher)"
  else
    record "4.1" FAIL "plugins.slots.contextEngine='$SLOT' (expected $PLUGIN_ID)"
  fi
fi

# ── 6. record ─────────────────────────────────────────────────────────────────
head1 "summary"
mkdir -p "$PLAN_DIR/audits"
{
  echo "# openviking-adopt — deploy + runtime probes ($TS)"
  echo
  echo "repo \`$(git -C "$REPO" rev-parse --abbrev-ref HEAD)\` @ \`$(git -C "$REPO" rev-parse --short HEAD)\` · host \`$(hostname)\` · workspace \`$WORKSPACE\`"
  echo
  echo "| Step | Result | Evidence |"
  echo "|---|---|---|"
  printf '%s' "$RESULTS"
  echo
  echo "PASS rows are the Runtime-Evidence for closing the matching INVENTORY row (PROTOCOL §3 Phase 9)."
  echo "PENDING rows need a later \`--probe\` run (3.2 after a live flush) or an operator action."
} > "$REPORT"
printf '%s' "$RESULTS" | awk -F'|' '{printf "  %-8s %-8s %s\n", $2, $3, $4}'
say ""
say "record: $REPORT"
printf '%s' "$RESULTS" | grep -q '| FAIL |' && exit 1 || exit 0
