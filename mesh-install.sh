#!/usr/bin/env bash
# mesh-install.sh — One-command mesh node bootstrapper.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/moltyguibros-design/openclaw-node/main/mesh-install.sh | MESH_JOIN_TOKEN=<token> sh
#   MESH_JOIN_TOKEN=<token> bash mesh-install.sh
#   bash mesh-install.sh --token <token>
#
# This script:
#   1. Detects OS (macOS/Linux)
#   2. Ensures Node.js 18+ and git are available
#   3. Clones the openclaw mesh code (or updates if exists)
#   4. Runs openclaw-node-init.js with the join token
#
# The Node.js provisioner handles everything else (NATS config, services, health).

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
CYAN='\033[36m'
RESET='\033[0m'

log()  { echo -e "${CYAN}[mesh-install]${RESET} $1"; }
ok()   { echo -e "${GREEN}  ✓${RESET} $1"; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $1"; }
fail() { echo -e "${RED}  ✗${RESET} $1"; }
die()  { fail "$1"; exit 1; }

# ── Token ──────────────────────────────────────────────

TOKEN="${MESH_JOIN_TOKEN:-}"

# Parse --token from args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) shift ;;
  esac
done

DRY_RUN="${DRY_RUN:-0}"

if [ -z "$TOKEN" ]; then
  die "No join token. Set MESH_JOIN_TOKEN or use --token <token>"
fi

# ── OS Detection ──────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      die "Unsupported OS: $(uname -s). Need macOS or Linux." ;;
  esac
}

OS=$(detect_os)
log "Detected OS: $OS ($(uname -m))"

# ── Node.js Check / Install ──────────────────────────

ensure_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$ver" -ge 18 ]; then
      ok "Node.js $(node --version)"
      return
    fi
    warn "Node.js $(node --version) is too old (need 18+)"
  else
    warn "Node.js not found"
  fi

  log "Installing Node.js..."
  if [ "$OS" = "macos" ]; then
    if command -v brew &>/dev/null; then
      brew install node@22
    else
      die "Homebrew not found. Install Node.js 18+ manually or install Homebrew first."
    fi
  else
    # Linux: NodeSource
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo dnf install -y nodejs
    elif command -v yum &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo yum install -y nodejs
    else
      die "No supported package manager. Install Node.js 18+ manually."
    fi
  fi

  ok "Node.js installed: $(node --version)"
}

ensure_git() {
  if command -v git &>/dev/null; then
    ok "Git $(git --version | cut -d' ' -f3)"
    return
  fi

  log "Installing git..."
  if [ "$OS" = "macos" ]; then
    xcode-select --install 2>/dev/null || brew install git
  else
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y git
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y git
    elif command -v yum &>/dev/null; then
      sudo yum install -y git
    fi
  fi
  ok "Git installed"
}

# ── Repo URL Extraction ────────────────────────────────
# Extract repo URL from token payload. Token is base64url-encoded JSON.
# Falls back to default if token is v1 (no repo field) or parsing fails.

DEFAULT_REPO="https://github.com/moltyguibros-design/openclaw-node.git"

extract_repo_url() {
  # base64url decode (handle both GNU and BSD base64)
  local decoded
  # Convert base64url to base64 standard
  local b64std
  b64std=$(echo "$TOKEN" | tr '_-' '/+')
  # Add padding if needed
  local pad=$(( 4 - ${#b64std} % 4 ))
  [ "$pad" -lt 4 ] && b64std="${b64std}$(printf '=%.0s' $(seq 1 "$pad"))"

  decoded=$(echo "$b64std" | base64 -d 2>/dev/null || echo "")
  if [ -z "$decoded" ]; then
    echo "$DEFAULT_REPO"
    return
  fi

  # Extract repo field from JSON (minimal parsing — no jq dependency)
  local repo
  repo=$(echo "$decoded" | grep -o '"repo":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$repo" ]; then
    echo "$repo"
  else
    echo "$DEFAULT_REPO"
  fi
}

REPO_URL=$(extract_repo_url)

# ── Mesh Code ─────────────────────────────────────────

MESH_DIR="$HOME/openclaw"

ensure_mesh_code() {
  if [ -f "$MESH_DIR/package.json" ]; then
    ok "Mesh code exists at $MESH_DIR"
    log "Updating..."
    cd "$MESH_DIR"
    git pull --ff-only 2>/dev/null || warn "Git pull failed (local changes?) — continuing with existing code"
    npm install --production 2>/dev/null
    ok "Dependencies updated"
    return
  fi

  log "Cloning mesh code from $REPO_URL..."
  git clone "$REPO_URL" "$MESH_DIR"
  cd "$MESH_DIR"
  npm install --production
  ok "Mesh code installed at $MESH_DIR"
}

# ── Main ──────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   OpenClaw Mesh — Quick Install      ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}"
echo ""

ensure_node
ensure_git
ensure_mesh_code

# Hand off to the Node.js provisioner
log "Running provisioner..."
echo ""

EXTRA_ARGS=""
if [ "$DRY_RUN" = "1" ]; then
  EXTRA_ARGS="--dry-run"
fi

cd "$MESH_DIR"
MESH_JOIN_TOKEN="$TOKEN" node bin/openclaw-node-init.js $EXTRA_ARGS
