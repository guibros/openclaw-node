#!/usr/bin/env bash
# memory-plan-status.sh — one-command view of the OpenClaw Memory Plan state.
#
# Usage:
#   ./workspace-bin/memory-plan-status.sh             # one-shot summary
#   ./workspace-bin/memory-plan-status.sh --watch     # full redraw every 2s
#   ./workspace-bin/memory-plan-status.sh --stream    # append-only event log (real-time)
#   ./workspace-bin/memory-plan-status.sh --stream --with-log
#                                                     # event log + tail of live tick log
#   ./workspace-bin/memory-plan-status.sh --log       # also tail the active tick log
#   ./workspace-bin/memory-plan-status.sh --json      # machine-readable

set -u
# Intentionally NOT pipefail/errexit — grep returning 1 on zero matches
# is normal here and must not abort the script.

REPO="/Users/moltymac/openclaw-nodedev"
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

# ── streaming mode ────────────────────────────────────────────────────────────
#
# Append-only event log. Polls the plan filesystem once per second and emits
# one line whenever something changed. Never clears the screen.
#
# Events: VER (version carrier), STEP (inventory state), COMMIT (new git log
# entry), BLOCK (BLOCKED.md create/delete), LOCK (tick lock acquire/release),
# TICK (new tick log file).

ts()      { date '+%H:%M:%S'; }
ev_ts()   { dim "$(ts)"; }
tag_ver()    { printf '\033[36m%-7s\033[0m' "VER";    }   # cyan
tag_step()   { printf '\033[35m%-7s\033[0m' "STEP";   }   # magenta
tag_commit() { printf '\033[32m%-7s\033[0m' "COMMIT"; }   # green
tag_block()  { printf '\033[31m%-7s\033[0m' "BLOCK";  }   # red
tag_lock()   { printf '\033[33m%-7s\033[0m' "LOCK";   }   # amber
tag_tick()   { printf '\033[34m%-7s\033[0m' "TICK";   }   # blue
tag_init()   { printf '\033[2m%-7s\033[0m'  "init";   }   # dim

emit() {
  local tag="$1"; shift
  printf '%s  %s  %s\n' "$(ev_ts)" "${tag}" "$*"
}

# Snapshot the inventory state lines we care about. Format per line:
#   "<step>|<state>"
# Example: "0.3|[A]". Cheap diff source.
snap_inventory() {
  grep -E '^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[(x|A| )\]' \
    "${PLAN}/INVENTORY.md" 2>/dev/null \
    | awk -F'|' '{gsub(/ /,"",$3); gsub(/ /,"",$5); print $3 "|" $5}'
}

stream_mode() {
  local with_log="${1:-no}"

  # Initial snapshot.
  local prev_version prev_blocked prev_locked prev_commit prev_latest_log
  prev_version=$(cat "${PLAN}/VERSION" 2>/dev/null || echo '<missing>')
  prev_blocked=$([ -f "${PLAN}/BLOCKED.md" ] && echo yes || echo no)
  prev_locked=$([ -d "${PLAN}/.tick.lock" ] && echo yes || echo no)
  prev_commit=$(git -C "${REPO}" log -1 --format='%H' 2>/dev/null || echo '')
  prev_latest_log=$(ls -1t "${PLAN}/tick-logs/"*.log 2>/dev/null | head -1 || true)

  local prev_inv_file cur_inv_file
  prev_inv_file=$(mktemp -t mpstream.inv.prev.XXXXXX)
  cur_inv_file=$(mktemp -t mpstream.inv.cur.XXXXXX)
  snap_inventory > "${prev_inv_file}"

  # Banner.
  probe
  bold "memory-plan stream"; printf '   '
  dim "(Ctrl-C to stop · polling 1s · plan=${PLAN})"; printf '\n'
  emit "$(tag_init)" "version=${prev_version}  closed=${CLOSED}/${TOTAL}  blocked=${prev_blocked}  lock=${prev_locked}"
  if [ -n "${prev_latest_log}" ]; then
    emit "$(tag_init)" "latest log: $(basename "${prev_latest_log}")"
  fi

  # Background tail of the latest tick log (if requested).
  local TAIL_PID=""
  local cur_tailed=""
  start_log_tail() {
    local f="$1"
    [ -z "$f" ] && return
    [ "$f" = "$cur_tailed" ] && return
    if [ -n "${TAIL_PID}" ]; then
      kill "${TAIL_PID}" 2>/dev/null || true
      wait "${TAIL_PID}" 2>/dev/null || true
    fi
    cur_tailed="$f"
    ( tail -n 0 -F "$f" 2>/dev/null \
        | while IFS= read -r line; do
            printf '%s  %s  %s\n' "$(ev_ts)" "$(dim '   log ')" "$(dim "${line}")"
          done
    ) &
    TAIL_PID=$!
  }

  if [ "${with_log}" = "yes" ] && [ -n "${prev_latest_log}" ]; then
    start_log_tail "${prev_latest_log}"
  fi

  cleanup() {
    if [ -n "${TAIL_PID}" ]; then
      kill "${TAIL_PID}" 2>/dev/null || true
    fi
    rm -f "${prev_inv_file}" "${cur_inv_file}" 2>/dev/null || true
    printf '\n'; dim "stream stopped"; printf '\n'
  }
  trap cleanup EXIT INT TERM

  # Poll loop.
  while true; do
    sleep 1

    # VERSION change.
    local cur_version
    cur_version=$(cat "${PLAN}/VERSION" 2>/dev/null || echo '<missing>')
    if [ "${cur_version}" != "${prev_version}" ]; then
      emit "$(tag_ver)" "${prev_version} → $(bold "${cur_version}")"
      prev_version="${cur_version}"
    fi

    # BLOCKED.md state.
    local cur_blocked
    cur_blocked=$([ -f "${PLAN}/BLOCKED.md" ] && echo yes || echo no)
    if [ "${cur_blocked}" != "${prev_blocked}" ]; then
      if [ "${cur_blocked}" = "yes" ]; then
        local trig
        trig=$(grep -m1 '^\*\*Trigger\*\*:' "${PLAN}/BLOCKED.md" 2>/dev/null | sed 's/^\*\*Trigger\*\*: //')
        emit "$(tag_block)" "$(red 'PAUSED') — ${trig:-see BLOCKED.md}"
      else
        emit "$(tag_block)" "$(green 'cleared')"
      fi
      prev_blocked="${cur_blocked}"
    fi

    # Tick lock state.
    local cur_locked
    cur_locked=$([ -d "${PLAN}/.tick.lock" ] && echo yes || echo no)
    if [ "${cur_locked}" != "${prev_locked}" ]; then
      if [ "${cur_locked}" = "yes" ]; then
        emit "$(tag_lock)" "acquired (tick running)"
      else
        emit "$(tag_lock)" "released"
      fi
      prev_locked="${cur_locked}"
    fi

    # New git commit.
    local cur_commit
    cur_commit=$(git -C "${REPO}" log -1 --format='%H' 2>/dev/null || echo '')
    if [ -n "${cur_commit}" ] && [ "${cur_commit}" != "${prev_commit}" ]; then
      # Emit each commit between prev and cur (in chronological order).
      git -C "${REPO}" log --reverse --format='%h %s' "${prev_commit}..${cur_commit}" 2>/dev/null \
        | while IFS= read -r line; do
            [ -z "${line}" ] && continue
            emit "$(tag_commit)" "${line}"
          done
      prev_commit="${cur_commit}"
    fi

    # New tick log file (a tick started).
    local cur_latest_log
    cur_latest_log=$(ls -1t "${PLAN}/tick-logs/"*.log 2>/dev/null | head -1 || true)
    if [ -n "${cur_latest_log}" ] && [ "${cur_latest_log}" != "${prev_latest_log}" ]; then
      emit "$(tag_tick)" "new log: $(basename "${cur_latest_log}")"
      prev_latest_log="${cur_latest_log}"
      if [ "${with_log}" = "yes" ]; then
        start_log_tail "${cur_latest_log}"
      fi
    fi

    # Inventory step state diff.
    snap_inventory > "${cur_inv_file}"
    if ! cmp -s "${prev_inv_file}" "${cur_inv_file}"; then
      # Build a map of previous states and diff against current.
      while IFS='|' read -r step state; do
        [ -z "${step}" ] && continue
        local prev_state
        prev_state=$(awk -F'|' -v s="${step}" '$1==s {print $2}' "${prev_inv_file}")
        if [ -n "${prev_state}" ] && [ "${prev_state}" != "${state}" ]; then
          emit "$(tag_step)" "${step}  ${prev_state} → $(bold "${state}")"
        fi
      done < "${cur_inv_file}"
      cp "${cur_inv_file}" "${prev_inv_file}"
    fi
  done
}

# ── entry ─────────────────────────────────────────────────────────────────────

MODE=human
WATCH=no
TAIL_LOG=no
STREAM=no
WITH_LOG=no

for arg in "$@"; do
  case "$arg" in
    --json) MODE=json ;;
    --watch) WATCH=yes ;;
    --stream) STREAM=yes ;;
    --with-log) WITH_LOG=yes ;;
    --log) TAIL_LOG=yes ;;
    --help|-h)
      sed -n '2,12p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
  esac
done

if [ "${STREAM}" = "yes" ]; then
  stream_mode "${WITH_LOG}"
elif [ "${WATCH}" = "yes" ]; then
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
