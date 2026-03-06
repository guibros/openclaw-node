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
    info "Removed $OPENCLAW_ROOT"
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
  info "Removed scripts, skills, and build artifacts"
  info "Memory data preserved at $WORKSPACE/memory/"
  info "Run with --purge to remove everything"
fi

echo ""
info "Uninstall complete."
