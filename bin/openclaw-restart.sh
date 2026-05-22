#!/usr/bin/env bash
# openclaw-restart.sh — Manual graceful restart of all OpenClaw memory daemons.
#
# Usage:
#   bin/openclaw-restart.sh           # restart all memory daemons
#   bin/openclaw-restart.sh --status  # show status only
#
# On macOS, uses launchctl for managed services. Falls back to pgrep/kill for
# processes not managed by launchd.

set -euo pipefail

SERVICES=(
  "ai.openclaw.memory-daemon"
)

UNMANAGED_PROCESSES=(
  "memory-promoter.mjs"
  "memory-subscriber.mjs"
  "health-watch.mjs"
)

WAIT_SEC=10

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

status_launchd() {
  local label="$1"
  if launchctl list "$label" >/dev/null 2>&1; then
    local pid
    pid=$(launchctl list "$label" 2>/dev/null | tail -1 | awk '{print $1}')
    if [ "$pid" != "-" ] && [ -n "$pid" ]; then
      echo "running (pid=$pid)"
    else
      echo "registered (not running)"
    fi
  else
    echo "not registered"
  fi
}

status_process() {
  local pattern="$1"
  local pid
  pid=$(pgrep -f "$pattern" 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    echo "running (pid=$pid)"
  else
    echo "not running"
  fi
}

stop_process() {
  local pattern="$1"
  local pids
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  Sending SIGTERM to $pattern (pids: $(echo $pids | tr '\n' ' '))"
    echo "$pids" | xargs kill -TERM 2>/dev/null || true
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Status command
# ---------------------------------------------------------------------------

show_status() {
  echo "=== OpenClaw Memory Daemons ==="
  echo ""
  for svc in "${SERVICES[@]}"; do
    printf "  %-45s %s\n" "$svc" "$(status_launchd "$svc")"
  done
  for proc in "${UNMANAGED_PROCESSES[@]}"; do
    printf "  %-45s %s\n" "$proc" "$(status_process "$proc")"
  done
  echo ""
}

# ---------------------------------------------------------------------------
# Restart command
# ---------------------------------------------------------------------------

restart_all() {
  echo "=== Stopping memory daemons ==="

  # Stop launchd-managed services
  for svc in "${SERVICES[@]}"; do
    echo "  Stopping $svc via launchctl..."
    launchctl kickstart -k "gui/$(id -u)/$svc" 2>/dev/null \
      && echo "  $svc restarted via kickstart" \
      || echo "  $svc: kickstart failed (may not be loaded)"
  done

  # Stop unmanaged processes
  local stopped=0
  for proc in "${UNMANAGED_PROCESSES[@]}"; do
    if stop_process "$proc"; then
      stopped=1
    else
      echo "  $proc: not running"
    fi
  done

  if [ $stopped -eq 1 ]; then
    echo ""
    echo "  Waiting ${WAIT_SEC}s for graceful shutdown..."
    sleep "$WAIT_SEC"
  fi

  echo ""
  echo "=== Post-restart status ==="
  show_status
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

case "${1:-restart}" in
  --status|-s|status)
    show_status
    ;;
  restart|--restart)
    restart_all
    ;;
  *)
    echo "Usage: openclaw-restart.sh [--status | restart]" >&2
    exit 1
    ;;
esac
