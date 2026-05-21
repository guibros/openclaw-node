#!/usr/bin/env bash
# memory-plan-notify.sh — macOS notification helper for memory-plan ticks.
#
# Usage:
#   memory-plan-notify.sh closed   <version>  <step-description>     # green banner
#   memory-plan-notify.sh blocked  <version>  <one-line-reason>      # red banner + sound
#   memory-plan-notify.sh skipped  <reason>                          # quiet (no notification)
#   memory-plan-notify.sh test                                       # smoke test (both kinds)
#
# Notifications use `osascript`. Sound for the blocked case uses `afplay`.
# Falls back gracefully if either tool is unavailable (no error, just no notification).
#
# Disable globally by setting `MEMORY_PLAN_NOTIFY=off` in the environment.

set -u

[ "${MEMORY_PLAN_NOTIFY:-on}" = "off" ] && exit 0
command -v osascript >/dev/null 2>&1 || exit 0

KIND="${1:-}"
shift || true

notify() {
  local title="$1" subtitle="$2" message="$3" sound="${4:-}"
  # osascript escaping: only the message is user-supplied, sanitize quotes
  message=$(printf '%s' "${message}" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-200)
  subtitle=$(printf '%s' "${subtitle}" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-100)
  if [ -n "${sound}" ]; then
    osascript -e "display notification \"${message}\" with title \"${title}\" subtitle \"${subtitle}\" sound name \"${sound}\"" 2>/dev/null || true
  else
    osascript -e "display notification \"${message}\" with title \"${title}\" subtitle \"${subtitle}\"" 2>/dev/null || true
  fi
}

play_alert() {
  if command -v afplay >/dev/null 2>&1 && [ -f /System/Library/Sounds/Sosumi.aiff ]; then
    afplay /System/Library/Sounds/Sosumi.aiff 2>/dev/null &
  fi
}

case "${KIND}" in
  closed)
    VERSION="${1:-}"; DESC="${2:-step closed}"
    notify "Memory Plan — step closed" "${VERSION}" "${DESC}" "Glass"
    ;;
  blocked)
    VERSION="${1:-}"; REASON="${2:-see BLOCKED.md}"
    # Sound + banner. The sound name in osascript fires the built-in chime;
    # afplay adds the longer Sosumi alert in the background for extra audibility.
    notify "Memory Plan — BLOCKED" "${VERSION}" "${REASON}" "Sosumi"
    play_alert
    ;;
  skipped)
    # Intentionally quiet — no notification for pre-flight skips
    exit 0
    ;;
  test)
    notify "Memory Plan — step closed" "v0.0-test" "smoke test: closed notification" "Glass"
    sleep 2
    notify "Memory Plan — BLOCKED" "v0.0-test" "smoke test: blocked notification" "Sosumi"
    play_alert
    ;;
  *)
    echo "usage: memory-plan-notify.sh {closed|blocked|skipped|test} [args]" >&2
    exit 1
    ;;
esac
