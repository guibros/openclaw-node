#!/usr/bin/env bash
# build-notifier-app.sh — create the branded macOS notifier app bundle.
#
# The LEFT icon of a macOS notification banner is the sending app's bundle
# icon; no terminal-notifier flag can change it (the old -appIcon is ignored
# since 10.14). So we ship our own sender: a copy of terminal-notifier.app
# with the OpenClaw icns, its own bundle id, ad-hoc re-signed. lib/notify.mjs
# prefers this bundle when it exists.
#
# Usage: build-notifier-app.sh [dest-app-path]
# Default dest: ~/.openclaw/share/OpenClawNotifier.app
# Exit 0 = bundle ready · 1 = cannot build (not macOS / no terminal-notifier)

set -euo pipefail

[ "$(uname -s)" = "Darwin" ] || { echo "not macOS — skipping notifier app build" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ICNS="${HERE}/openclaw.icns"
[ -f "${ICNS}" ] || { echo "missing ${ICNS} — run generate-icons.mjs first" >&2; exit 1; }

TN="$(command -v terminal-notifier 2>/dev/null || true)"
[ -z "${TN}" ] && [ -x /opt/homebrew/bin/terminal-notifier ] && TN=/opt/homebrew/bin/terminal-notifier
[ -z "${TN}" ] && [ -x /usr/local/bin/terminal-notifier ]   && TN=/usr/local/bin/terminal-notifier
[ -n "${TN}" ] || { echo "terminal-notifier not installed — skipping (brew install terminal-notifier)" >&2; exit 1; }

# The brew bin is a shim/symlink into the Cellar app bundle — find the .app.
REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${TN}")"
SRC_APP="${REAL%/Contents/MacOS/*}"
if [ ! -d "${SRC_APP}/Contents" ]; then
  SRC_APP="$(dirname "$(dirname "${REAL}")")/terminal-notifier.app"
fi
[ -d "${SRC_APP}/Contents" ] || { echo "cannot locate terminal-notifier.app from ${TN}" >&2; exit 1; }

DEST="${1:-$HOME/.openclaw/share/OpenClawNotifier.app}"
mkdir -p "$(dirname "${DEST}")"
rm -rf "${DEST}"
cp -R "${SRC_APP}" "${DEST}"

PLIST="${DEST}/Contents/Info.plist"
ICON_NAME="$(/usr/libexec/PlistBuddy -c "Print CFBundleIconFile" "${PLIST}" 2>/dev/null || echo Terminal.icns)"
case "${ICON_NAME}" in *.icns) ;; *) ICON_NAME="${ICON_NAME}.icns" ;; esac
cp "${ICNS}" "${DEST}/Contents/Resources/${ICON_NAME}"

/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ai.openclaw.notifier" "${PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleName OpenClaw" "${PLIST}" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string OpenClaw" "${PLIST}"

codesign --force --deep --sign - "${DEST}" >/dev/null 2>&1

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "${DEST}" >/dev/null 2>&1 || true

echo "OpenClaw notifier bundle ready: ${DEST}"
echo "First banner may ask for notification permission (System Settings → Notifications → OpenClaw)."
