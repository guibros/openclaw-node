#!/usr/bin/env bash
# memory-plan-notify.sh — macOS notification helper for memory-plan / redesign ticks
# and the workplan-viewer.
#
# PERSISTENT alerts (operator decision 2026-05-28, "both persist"): each kind pops
# a `display alert` WINDOW that stays on screen until the operator clicks Dismiss —
# no auto-dismiss. The window is launched detached so the caller returns immediately
# and the window survives independently. A sound (afplay) plays alongside.
#
# Usage:
#   memory-plan-notify.sh closed  <version> <step-description>   # forward → Glass
#   memory-plan-notify.sh blocked <version> <one-line-reason>    # block   → Sosumi (critical)
#   memory-plan-notify.sh skipped <reason>                       # quiet (no notification)
#   memory-plan-notify.sh test                                   # smoke test (both; dismiss them)
#
# Disable globally with MEMORY_PLAN_NOTIFY=off.

set -u

[ "${MEMORY_PLAN_NOTIFY:-on}" = "off" ] && exit 0
command -v osascript >/dev/null 2>&1 || exit 0

SOUNDS="/System/Library/Sounds"

# Play a system sound in the background (best-effort).
play() {  # play <SoundName>
  local f="${SOUNDS}/$1.aiff"
  if command -v afplay >/dev/null 2>&1 && [ -f "${f}" ]; then
    ( afplay "${f}" >/dev/null 2>&1 & )
  fi
}

# Persistent alert WINDOW — stays until the user clicks. Detached (nohup &) so the
# caller returns immediately and the window survives the script exiting. No
# `giving up after`, so it never auto-dismisses.
persist_alert() {  # persist_alert <title> <message> [critical]
  local title msg crit=""
  title=$(printf '%s' "$1" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-150)
  msg=$(printf '%s' "$2"   | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-400)
  [ "${3:-}" = "critical" ] && crit=" as critical"
  nohup osascript -e "display alert \"${title}\" message \"${msg}\"${crit}" >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

KIND="${1:-}"
shift || true

case "${KIND}" in
  closed)
    VERSION="${1:-}"; DESC="${2:-step closed}"
    play Glass
    persist_alert "Workplan — step forward · ${VERSION}" "${DESC}"
    ;;
  blocked)
    VERSION="${1:-}"; REASON="${2:-see BLOCKED.md}"
    play Sosumi
    persist_alert "Workplan — BLOCKED · ${VERSION}" "${REASON}" critical
    ;;
  skipped)
    # Intentionally quiet — no notification for pre-flight skips.
    exit 0
    ;;
  test)
    play Glass
    persist_alert "Workplan — step forward · v0.0-test" "smoke test: forward notification (click to dismiss)"
    play Sosumi
    persist_alert "Workplan — BLOCKED · v0.0-test" "smoke test: blocked notification (click to dismiss)" critical
    ;;
  *)
    echo "usage: memory-plan-notify.sh {closed|blocked|skipped|test} [args]" >&2
    exit 1
    ;;
esac

exit 0
