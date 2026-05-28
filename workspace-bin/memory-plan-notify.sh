#!/usr/bin/env bash
# memory-plan-notify.sh — top-right Notification Center banners for the
# memory-plan / redesign ticks and the workplan-viewer.
#
# Posts a real top-right NC banner via terminal-notifier (preferred), with an
# osascript `display notification` fallback. NOT a center-screen modal.
#
# PERSISTENCE: whether a banner stays until dismissed (Alerts style) or
# auto-dismisses after ~5s (Banners style) is a per-app macOS setting, NOT
# controllable from a script. To make these STAY until you discard them:
#   System Settings → Notifications → terminal-notifier → "Alerts"
# (one-time toggle; applies to every workplan banner thereafter).
#
# Usage:
#   memory-plan-notify.sh closed  <version> <step-description>   # forward → Glass
#   memory-plan-notify.sh blocked <version> <one-line-reason>    # block   → Sosumi
#   memory-plan-notify.sh skipped <reason>                       # quiet
#   memory-plan-notify.sh test                                   # both (top-right)
#
# Disable globally with MEMORY_PLAN_NOTIFY=off.

set -u
[ "${MEMORY_PLAN_NOTIFY:-on}" = "off" ] && exit 0

# Locate terminal-notifier (PATH can be minimal under launchd).
TN="$(command -v terminal-notifier 2>/dev/null || true)"
[ -z "${TN}" ] && [ -x /opt/homebrew/bin/terminal-notifier ] && TN=/opt/homebrew/bin/terminal-notifier
[ -z "${TN}" ] && [ -x /usr/local/bin/terminal-notifier ]   && TN=/usr/local/bin/terminal-notifier

# Post a top-right Notification Center banner.
banner() {  # banner <title> <subtitle> <message> <sound>
  local title="$1" subtitle="$2" message="$3" sound="$4"
  if [ -n "${TN}" ]; then
    "${TN}" -title "${title}" -subtitle "${subtitle}" -message "${message}" -sound "${sound}" >/dev/null 2>&1 || true
  elif command -v osascript >/dev/null 2>&1; then
    local m s
    m=$(printf '%s' "${message}"  | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-200)
    s=$(printf '%s' "${subtitle}" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-100)
    osascript -e "display notification \"${m}\" with title \"${title}\" subtitle \"${s}\" sound name \"${sound}\"" >/dev/null 2>&1 || true
  fi
}

KIND="${1:-}"
shift || true

case "${KIND}" in
  closed)
    banner "Workplan — step forward" "${1:-}" "${2:-step closed}" "Glass"
    ;;
  blocked)
    banner "Workplan — BLOCKED" "${1:-}" "${2:-see BLOCKED.md}" "Sosumi"
    ;;
  skipped)
    exit 0
    ;;
  test)
    banner "Workplan — step forward" "v0.0-test" "smoke test: forward (top-right banner)" "Glass"
    sleep 1
    banner "Workplan — BLOCKED" "v0.0-test" "smoke test: blocked (top-right banner)" "Sosumi"
    ;;
  *)
    echo "usage: memory-plan-notify.sh {closed|blocked|skipped|test} [args]" >&2
    exit 1
    ;;
esac

exit 0
