#!/usr/bin/env bash
# install.sh — OpenClaw Node Installer
# Installs the full OpenClaw infrastructure on Ubuntu (or any Linux with systemd).
# Also works on macOS for fresh installs.
#
# Usage:
#   bash install.sh              # Full install
#   bash install.sh --dry-run    # Show what would happen
#   bash install.sh --update     # Re-copy scripts/configs, skip deps
#
# --dry-run behavior:
#   Echoes every command that would execute (prefixed with [DRY-RUN]) without
#   modifying the filesystem. Also verifies that all source paths exist —
#   a missing source prints [DRY-RUN ERROR] so path bugs (like SCRIPT_DIR)
#   are caught without running the install. Does NOT check destination
#   writability (that requires actual fs calls). Exit code 0 on success,
#   1 if any source path is missing.

set -euo pipefail

# ============================================================
# Configuration
# ============================================================

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
WORKSPACE="$OPENCLAW_ROOT/workspace"
ENV_FILE="$OPENCLAW_ROOT/openclaw.env"
DRY_RUN=false
UPDATE_ONLY=false
SKIP_MESH=false
ENABLE_SERVICES=false
SKIP_LLM=false
SKIP_VERIFY=false
SKIP_FRONTEND=false
VERIFY_FRONTEND=false
SANDBOX=false
NODE_ROLE=""
CLUSTER_PEERS=""
CLUSTER_BIND=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)           DRY_RUN=true ;;
    --update)            UPDATE_ONLY=true ;;
    --skip-mesh)         SKIP_MESH=true ;;
    --enable-services)   ENABLE_SERVICES=true ;;
    --skip-llm)          SKIP_LLM=true ;;
    --skip-verify)       SKIP_VERIFY=true ;;
    --skip-frontend)     SKIP_FRONTEND=true ;;
    --verify-frontend)   VERIFY_FRONTEND=true ;;
    --sandbox)           SANDBOX=true; SKIP_LLM=true; SKIP_MESH=true; SKIP_FRONTEND=true ;;
    --role=*)            NODE_ROLE="${arg#--role=}" ;;
    --cluster-peers=*)   CLUSTER_PEERS="${arg#--cluster-peers=}" ;;
    --cluster-bind=*)    CLUSTER_BIND="${arg#--cluster-bind=}" ;;
    --help|-h)
      echo "Usage: bash install.sh [--dry-run] [--update] [--skip-mesh] [--skip-llm] [--skip-verify] [--role=lead|worker] [--enable-services]"
      echo "  --dry-run           Show what would happen without making changes"
      echo "  --update            Re-copy scripts/configs only (skip system deps)"
      echo "  --skip-mesh         Skip mesh network setup (used by meta-installer)"
      echo "  --skip-llm          Skip ollama install + model pull + embedder prefetch (extraction degrades to regex)"
      echo "  --skip-verify       Skip the final acceptance gate"
      echo "  --skip-frontend     Skip agent-frontend (Claude Code) detection/install"
      echo "  --verify-frontend   Verify frontend auth with one small live call"
      echo "  --sandbox           Wiring-test mode: skip network-heavy installs (implies --skip-llm --skip-mesh)"
      echo "  --role=lead|worker  Set node role (default: macOS=lead, Linux=worker)"
      echo "  --cluster-peers=A,B Join a multi-MACHINE NATS cluster: A,B are the OTHER"
      echo "                      machines' addresses (Tailscale/LAN IPs). Renders THIS"
      echo "                      machine's nats.conf to cluster with them (R=3 failsafe)."
      echo "  --cluster-bind=IP   THIS machine's own tailnet/LAN address to bind (never"
      echo "                      0.0.0.0). Auto-detected from 'tailscale ip -4' if omitted."
      echo "  --enable-services   Also enable and start services after installing"
      exit 0
      ;;
  esac
done

source "$REPO_DIR/scripts/install/helpers.sh"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       OpenClaw Node Installer            ║"
echo "║       Platform: $OS                       "
echo "╚══════════════════════════════════════════╝"
echo ""

source "$REPO_DIR/scripts/install/system-deps.sh"
source "$REPO_DIR/scripts/install/env.sh"
source "$REPO_DIR/scripts/install/workspace.sh"
source "$REPO_DIR/scripts/install/config.sh"
source "$REPO_DIR/scripts/install/components.sh"
source "$REPO_DIR/scripts/install/services.sh"
source "$REPO_DIR/scripts/install/integrations.sh"
source "$REPO_DIR/scripts/install/verify.sh"

# ============================================================
# Done!
# ============================================================

echo ""
echo "╔══════════════════════════════════════════╗"
if [ "$GATE_STATE" = "accepted" ]; then
  echo "║   Installation Complete — VERIFIED       ║"
else
  echo "║   Installation Complete — NOT VERIFIED   ║"
fi
echo "╚══════════════════════════════════════════╝"
echo ""
info "Workspace: $WORKSPACE"
info "Config:    $OPENCLAW_ROOT/config/"
info "Env file:  $ENV_FILE"
info "Spec:      docs/NODE_SPEC.md · Test protocol: docs/INSTALL_TEST_PROTOCOL.md"
echo ""

info "Role: $NODE_ROLE | Services installed: $INSTALLED_COUNT"
echo ""

if [ "$GATE_STATE" = "accepted" ]; then
  echo "The node is running. Useful next:"
  echo "  Watch it:            $NODE_BIN $WORKSPACE/bin/node-watch.mjs --once"
  echo "  Dashboard:           http://localhost:3000"
  echo "  Grappe quickstart:   docs/NODE_SPEC.md §6 (3 local agents + one circling task)"
else
  echo "Next steps:"
  echo "  1. Review the env file:            nano $ENV_FILE"
  echo "  2. Start + verify the node:        bash $0 --update --enable-services"
  if [ "$OS" = "linux" ]; then
    echo "  3. Check services:                 systemctl --user list-units 'openclaw-*'"
  else
    echo "  3. Check services:                 launchctl list | grep openclaw"
  fi
  echo "  4. Re-verify any time:             $NODE_BIN $WORKSPACE/bin/node-acceptance.mjs"
fi
echo ""
