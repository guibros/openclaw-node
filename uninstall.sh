#!/usr/bin/env bash
# uninstall.sh — Remove OpenClaw Node installation
#
# Usage:
#   bash uninstall.sh              # Remove services and scripts (keep data)
#   bash uninstall.sh --purge      # Remove everything including memory data

set -euo pipefail

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
WORKSPACE="$OPENCLAW_ROOT/workspace"
PURGE=false

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=true ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }

echo ""
echo "OpenClaw Node Uninstaller"
echo ""

# Stop and remove daemon service
if [ -f "$WORKSPACE/bin/install-daemon" ]; then
  info "Stopping memory daemon..."
  bash "$WORKSPACE/bin/install-daemon" --uninstall 2>/dev/null || true
fi

# Stop and remove services
OS="$(uname -s)"
if [ "$OS" = "Linux" ]; then
  # --- Current services: openclaw-*.service under user systemd ---
  SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
  if [ -d "$SYSTEMD_USER_DIR" ]; then
    for unit in "$SYSTEMD_USER_DIR"/openclaw-*.service "$SYSTEMD_USER_DIR"/openclaw-*.timer; do
      [ -f "$unit" ] || continue
      UNIT_NAME="$(basename "$unit")"
      info "Stopping $UNIT_NAME..."
      systemctl --user stop "$UNIT_NAME" 2>/dev/null || true
      systemctl --user disable "$UNIT_NAME" 2>/dev/null || true
      rm -f "$unit"
      info "Removed $UNIT_NAME"
    done
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  # --- Legacy fallback: old system-level openclaw-agent ---
  if systemctl is-active --quiet openclaw-agent 2>/dev/null; then
    info "Stopping legacy mesh agent (openclaw-agent)..."
    sudo systemctl stop openclaw-agent 2>/dev/null || true
    sudo systemctl disable openclaw-agent 2>/dev/null || true
    sudo rm -f /etc/systemd/system/openclaw-agent.service
    sudo systemctl daemon-reload 2>/dev/null || true
    info "Legacy mesh agent service removed"
  fi
elif [ "$OS" = "Darwin" ]; then
  # --- Current services: ai.openclaw.*.plist under ~/Library/LaunchAgents ---
  LAUNCHD_AGENTS_DIR="$HOME/Library/LaunchAgents"
  if [ -d "$LAUNCHD_AGENTS_DIR" ]; then
    for plist in "$LAUNCHD_AGENTS_DIR"/ai.openclaw.*.plist; do
      [ -f "$plist" ] || continue
      PLIST_NAME="$(basename "$plist")"
      info "Unloading $PLIST_NAME..."
      launchctl unload "$plist" 2>/dev/null || true
      rm -f "$plist"
      info "Removed $PLIST_NAME"
    done
  fi
  # --- Legacy fallback: old system-level com.openclaw.agent ---
  LEGACY_PLIST="/Library/LaunchDaemons/com.openclaw.agent.plist"
  if [ -f "$LEGACY_PLIST" ]; then
    info "Stopping legacy mesh agent (com.openclaw.agent)..."
    sudo launchctl unload "$LEGACY_PLIST" 2>/dev/null || true
    sudo rm -f "$LEGACY_PLIST"
    info "Legacy mesh agent LaunchDaemon removed"
  fi
fi
# Remove mesh symlinks
for cmd in mesh mesh-health mesh-repair; do
  [ -L "/usr/local/bin/$cmd" ] && sudo rm -f "/usr/local/bin/$cmd" && info "Removed /usr/local/bin/$cmd"
done
# Remove mesh sudoers
[ -f "/etc/sudoers.d/openclaw-mesh" ] && sudo rm -f "/etc/sudoers.d/openclaw-mesh" && info "Removed mesh sudoers rules"

# Stop Mission Control if running
if command -v lsof >/dev/null 2>&1; then
  MC_PID=$(lsof -ti:3000 2>/dev/null || true)
  if [ -n "$MC_PID" ]; then
    info "Stopping Mission Control (PID $MC_PID)..."
    kill "$MC_PID" 2>/dev/null || true
  fi
fi

if $PURGE; then
  warn "PURGE mode: removing ALL OpenClaw data"
  echo ""
  read -p "Are you sure? This deletes ~/.openclaw entirely. [y/N] " confirm
  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    rm -rf "$OPENCLAW_ROOT"
    rm -rf "$HOME/openclaw"
    info "Removed $OPENCLAW_ROOT"
    info "Removed $HOME/openclaw (mesh shared folder + agent)"
  else
    info "Aborted."
    exit 0
  fi
else
  info "Removing scripts and services (keeping memory data)..."
  rm -rf "$WORKSPACE/bin"
  rm -rf "$WORKSPACE/skills"
  rm -rf "$WORKSPACE/projects/mission-control/node_modules"
  rm -rf "$WORKSPACE/projects/mission-control/.next"
  rm -rf "$WORKSPACE/.boot"
  rm -rf "$HOME/openclaw/bin"
  rm -rf "$HOME/.openclaw/skills/mesh"
  info "Removed scripts, skills, mesh CLI, and build artifacts"
  info "Memory data preserved at $WORKSPACE/memory/"
  info "Run with --purge to remove everything"
fi

echo ""
info "Uninstall complete."
