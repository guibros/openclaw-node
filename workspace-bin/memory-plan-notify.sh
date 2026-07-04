#!/usr/bin/env bash
# memory-plan-notify.sh — compatibility shim over bin/openclaw-notify.mjs for
# the tick-chain callers (memory-plan-tick.sh / plan-tick.sh).
#
# The real notification path lives in lib/notify.mjs: every event is appended
# to ~/.openclaw/notifications/ledger.jsonl and the popup click-links back to
# the workplan viewer. See docs/NOTIFICATIONS.md.
#
# Usage (unchanged):
#   memory-plan-notify.sh closed  <version> <step-description>
#   memory-plan-notify.sh blocked <version> <one-line-reason>
#   memory-plan-notify.sh skipped <reason>
#   memory-plan-notify.sh test
#
# Disable globally with MEMORY_PLAN_NOTIFY=off.

set -u
[ "${MEMORY_PLAN_NOTIFY:-on}" = "off" ] && exit 0

HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="${HERE}/../bin/openclaw-notify.mjs"
[ -f "${CLI}" ] || exit 0

NODE="$(command -v node 2>/dev/null || true)"
[ -z "${NODE}" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
[ -z "${NODE}" ] && [ -x /usr/local/bin/node ]    && NODE=/usr/local/bin/node
[ -z "${NODE}" ] && exit 0

VIEWER_URL="http://127.0.0.1:${WORKPLAN_VIEWER_PORT:-7892}/"

fire() {  # fire <kind> <title> <subtitle> <message>
  "${NODE}" "${CLI}" --source workplan --kind "$1" --title "$2" \
    --subtitle "$3" --message "$4" --url "${VIEWER_URL}" >/dev/null 2>&1 || true
}

KIND="${1:-}"
shift || true

case "${KIND}" in
  closed)
    fire success "Workplan — step forward" "${1:-}" "${2:-step closed}"
    ;;
  blocked)
    fire block "Workplan — BLOCKED" "${1:-}" "${2:-see BLOCKED.md}"
    ;;
  skipped)
    exit 0
    ;;
  test)
    fire success "Workplan — step forward" "v0.0-test" "smoke test: forward"
    sleep 1
    fire block "Workplan — BLOCKED" "v0.0-test" "smoke test: blocked"
    ;;
  *)
    echo "usage: memory-plan-notify.sh {closed|blocked|skipped|test} [args]" >&2
    exit 1
    ;;
esac

exit 0
