#!/usr/bin/env bash
# build-launcher-app.sh — the double-clickable stack starter (macOS).
#
# Compiles a tiny AppleScript applet that runs `openclaw-stack up` headless,
# gives it the OpenClaw claw icns, ad-hoc signs it, and registers it. Drag it
# to the Dock; one click brings the whole node up and the result arrives as a
# ledgered notification (click-through to Mission Control diagnostics).
#
# Usage: build-launcher-app.sh [dest-app-path]
# Default dest: ~/Applications/OpenClaw Stack.app

set -euo pipefail

[ "$(uname -s)" = "Darwin" ] || { echo "not macOS — skipping launcher app build" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
ICNS="${REPO}/services/notify-icons/openclaw.icns"
STACK="${REPO}/bin/openclaw-stack.mjs"
[ -f "${STACK}" ] || { echo "missing ${STACK}" >&2; exit 1; }

NODE="$(command -v node 2>/dev/null || true)"
[ -z "${NODE}" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
[ -z "${NODE}" ] && [ -x /usr/local/bin/node ]    && NODE=/usr/local/bin/node
[ -n "${NODE}" ] || { echo "node not found" >&2; exit 1; }

DEST="${1:-$HOME/Applications/OpenClaw Stack.app}"
mkdir -p "$(dirname "${DEST}")" "$HOME/.openclaw/logs"
rm -rf "${DEST}"

SCRIPT="do shell script \"'${NODE}' '${STACK}' up >> \" & quoted form of (POSIX path of (path to home folder)) & \".openclaw/logs/stack-launcher.log 2>&1\""
osacompile -o "${DEST}" -e "${SCRIPT}"

if [ -f "${ICNS}" ]; then
  cp "${ICNS}" "${DEST}/Contents/Resources/applet.icns"
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ai.openclaw.stack-launcher" "${DEST}/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string ai.openclaw.stack-launcher" "${DEST}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName OpenClaw Stack" "${DEST}/Contents/Info.plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string OpenClaw Stack" "${DEST}/Contents/Info.plist"

codesign --force --deep --sign - "${DEST}" >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "${DEST}" >/dev/null 2>&1 || true

echo "launcher ready: ${DEST}"
echo "Double-click (or Dock it) → full stack up → ledgered popup with the result."
