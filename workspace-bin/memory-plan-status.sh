#!/usr/bin/env bash
# memory-plan-status.sh — one-command view of the OpenClaw Memory Plan state.
#
# Usage:
#   ./workspace-bin/memory-plan-status.sh            # one-shot summary
#   ./workspace-bin/memory-plan-status.sh --watch    # refresh every 2s
#   ./workspace-bin/memory-plan-status.sh --log      # also tail the active tick log
#   ./workspace-bin/memory-plan-status.sh --json     # machine-readable

set -u
# Intentionally NOT pipefail/errexit — grep returning 1 on zero matches
# is normal here and must not abort the script.

REPO="/Users/moltymac/openclaw"
PLAN="${REPO}/memory-plan"

# ── helpers ───────────────────────────────────────────────────────────────────

dim()  { printf '\033[2m%s\033[0m' "$*"; }
bold() { printf '\033[1m%s\033[0m' "$*"; }
green(){ printf '\033[32m%s\033[0m' "$*"; }
amber(){ printf '\033[33m%s\033[0m' "$*"; }
red()  { printf '\033[31m%s\033[0m' "$*"; }

# ── data probes ───────────────────────────────────────────────────────────────

probe() {
  VERSION=$(cat "${PLAN}/VERSION" 2>/dev/null || echo "<missing>")
  # Only count [x]/[A]/[ ] inside actual inventory rows (not the legend line).
  # Use `grep | wc -l` so zero matches still gives a clean integer.
  CLOSED=$(grep -E '^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[x\]' "${PLAN}/INVENTORY.md" 2>/dev/null | wc -l | tr -d ' ')
  ACTIVE=$(grep -E '^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[A\]' "${PLAN}/INVENTORY.md" 2>/dev/null | wc -l | tr -d ' ')
  TOTAL=$(grep -E '^\| [0-9]+ \| [0-9]+\.[0-9]+' "${PLAN}/INVENTORY.md" 2>/dev/null | wc -l | tr -d ' ')
  BLOCKED=$([ -f "${PLAN}/BLOCKED.md" ] && echo yes || echo no)
  LOCKED=$([ -d "${PLAN}/.tick.lock" ] && echo yes || echo no)
  LAST_COMMIT=$(git -C "${REPO}" log -1 --pretty='%h %s' 2>/dev/null || echo "<no commits>")
  DIRTY=$(git -C "${REPO}" status --short 2>/dev/null || echo "")
  CURRENT_STEP=$(grep -E '^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[(A| )\]' "${PLAN}/INVENTORY.md" 2>/dev/null | head -1 | sed 's/^| *//; s/ *|/ /g; s/ *$//')
  LATEST_LOG=$(ls -1t "${PLAN}/tick-logs/"*.log 2>/dev/null | head -1)
  RECENT_TICKS=$(ls -1t "${PLAN}/tick-logs/"*.log 2>/dev/null | head -5 | wc -l | tr -d ' ')
  LAUNCHD=$(launchctl list 2>/dev/null | grep -c 'com.openclaw.memory-plan-tick' || true)
  LAUNCHD=${LAUNCHD:-0}
}

# ── output formats ────────────────────────────────────────────────────────────

print_json() {
  probe
  cat <<EOF
{
  "version": "${VERSION}",
  "closed_steps": ${CLOSED},
  "in_flight_steps": ${ACTIVE},
  "total_steps": ${TOTAL},
  "blocked": "${BLOCKED}",
  "tick_locked": "${LOCKED}",
  "launchd_loaded": ${LAUNCHD},
  "current_step": "${CURRENT_STEP}",
  "last_commit": "${LAST_COMMIT}",
  "dirty_tree_lines": $(printf '%s' "${DIRTY}" | wc -l | tr -d ' '),
  "latest_tick_log": "${LATEST_LOG}",
  "recent_tick_count": ${RECENT_TICKS}
}
EOF
}

print_human() {
  probe
  printf '\n'
  bold "OpenClaw Memory Plan — Status"; printf '\n'
  printf '  '; dim "$(date '+%Y-%m-%d %H:%M:%S')"; printf '\n\n'

  # Progress bar
  if [ "${TOTAL}" -gt 0 ]; then
    PCT=$(( CLOSED * 100 / TOTAL ))
    BAR_FILLED=$(( CLOSED * 30 / TOTAL ))
    BAR_EMPTY=$(( 30 - BAR_FILLED ))
    printf '  Progress  '
    green "$(printf '█%.0s' $(seq 1 ${BAR_FILLED} 2>/dev/null))"
    dim "$(printf '░%.0s' $(seq 1 ${BAR_EMPTY} 2>/dev/null))"
    printf '  %d/%d (%d%%)\n' "${CLOSED}" "${TOTAL}" "${PCT}"
  fi

  printf '  Version   '; bold "${VERSION}"; printf '\n'

  printf '  Block     '
  case "${BLOCKED}" in
    yes) red 'BLOCKED — see memory-plan/BLOCKED.md' ;;
    *)   green 'clear' ;;
  esac
  printf '\n'

  printf '  Tick lock '
  case "${LOCKED}" in
    yes) amber 'held (a tick is running)' ;;
    *)   green 'free' ;;
  esac
  printf '\n'

  printf '  launchd   '
  if [ "${LAUNCHD}" -gt 0 ]; then
    green 'loaded'
  else
    dim 'not loaded (manual only)'
  fi
  printf '\n'

  printf '  Tree      '
  if [ -z "${DIRTY}" ]; then
    green 'clean'
  else
    DIRTY_LINES=$(printf '%s\n' "${DIRTY}" | grep -c '^' || echo 0)
    amber "${DIRTY_LINES} change(s)"
  fi
  printf '\n'

  printf '\n  '; bold 'Next step'; printf '\n'
  if [ -n "${CURRENT_STEP}" ]; then
    printf '    %s\n' "${CURRENT_STEP}"
  else
    printf '    '; green '(none — all steps closed)'; printf '\n'
  fi

  printf '\n  '; bold 'Last commit'; printf '\n'
  printf '    %s\n' "${LAST_COMMIT}"

  if [ -n "${LATEST_LOG:-}" ]; then
    printf '\n  '; bold 'Most recent tick log'; printf '\n'
    printf '    %s\n' "$(basename "${LATEST_LOG}")"
    printf '    %s\n' "$(dim "$(wc -l < "${LATEST_LOG}" | tr -d ' ') lines · $(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "${LATEST_LOG}")")"
  fi

  if [ -n "${DIRTY}" ]; then
    printf '\n  '; bold 'Working tree'; printf '\n'
    printf '%s\n' "${DIRTY}" | sed 's/^/    /'
  fi

  printf '\n'
}

# ── entry ─────────────────────────────────────────────────────────────────────

MODE=human
WATCH=no
TAIL_LOG=no

for arg in "$@"; do
  case "$arg" in
    --json) MODE=json ;;
    --watch) WATCH=yes ;;
    --log) TAIL_LOG=yes ;;
    --help|-h)
      sed -n '2,9p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
  esac
done

if [ "${WATCH}" = "yes" ]; then
  while true; do
    clear
    print_human
    if [ "${TAIL_LOG}" = "yes" ] && [ -n "${LATEST_LOG:-}" ]; then
      printf '  '; bold "Tail of $(basename ${LATEST_LOG})"; printf '\n'
      tail -10 "${LATEST_LOG}" | sed 's/^/    /'
      printf '\n'
    fi
    sleep 2
  done
elif [ "${MODE}" = "json" ]; then
  print_json
else
  print_human
  if [ "${TAIL_LOG}" = "yes" ] && [ -n "${LATEST_LOG:-}" ]; then
    printf '  '; bold "Tail of $(basename ${LATEST_LOG})"; printf '\n'
    tail -20 "${LATEST_LOG}" | sed 's/^/    /'
    printf '\n'
  fi
fi
