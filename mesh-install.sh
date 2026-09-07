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
REPAIR=0

# Parse --token from args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --repair) REPAIR=1; shift ;;
    *) shift ;;
  esac
done

DRY_RUN="${DRY_RUN:-0}"

if [ "$REPAIR" = "0" ] && [ -z "$TOKEN" ]; then
  die "No join token. Set MESH_JOIN_TOKEN or use --token <token>. For repair: --repair"
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

# ── Token payload ─────────────────────────────────────
# The token is base64url JSON {p: payload, s: hmac}. A fresh machine has no
# mesh secret, so the HMAC cannot be checked here — the installer therefore
# treats the payload as UNTRUSTED input and only lets it steer two things,
# each bounded: the expiry (refused when past) and the repo to clone (refused
# unless it matches the allowlist below or the operator opts in explicitly).
# Without that bound, anyone who can hand a victim a token can make this
# script `git clone` and `npm install` arbitrary code as the victim.

DEFAULT_REPO="https://github.com/moltyguibros-design/openclaw-node.git"
ALLOWED_REPO_PATTERN='^https://github\.com/moltyguibros-design/openclaw-node(\.git)?$'

decode_token_payload() {
  # base64url -> base64 standard (handle both GNU and BSD base64)
  local b64std
  b64std=$(printf '%s' "$TOKEN" | tr '_-' '/+')
  local pad=$(( 4 - ${#b64std} % 4 ))
  [ "$pad" -lt 4 ] && b64std="${b64std}$(printf '=%.0s' $(seq 1 "$pad"))"
  printf '%s' "$b64std" | base64 -d 2>/dev/null || true
}

# Minimal field extraction — no jq dependency. Only simple string/number
# values are read, and each is validated against a strict shape before use.
json_field() { printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
json_number() { printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -1 | cut -d':' -f2; }

check_token_expiry() {
  local payload="$1" expires now
  expires=$(json_number "$payload" expires)
  [ -z "$expires" ] && return 0            # v1 tokens carry no expiry
  now=$(( $(date +%s) * 1000 ))
  if [ "$expires" -lt "$now" ]; then
    die "Join token expired at $(date -u -d "@$(( expires / 1000 ))" 2>/dev/null || date -u -r "$(( expires / 1000 ))" 2>/dev/null || echo "$expires"). Ask the lead for a fresh one: node bin/mesh-join-token.js"
  fi
}

# Sets REPO_URL in the calling shell. Deliberately NOT `$(...)`-style: a `die`
# inside a command substitution only exits the subshell, and the install would
# carry on with an empty URL instead of stopping.
resolve_repo_url() {
  local payload="$1" repo
  repo=$(json_field "$payload" repo)
  if [ -z "$repo" ]; then
    REPO_URL="$DEFAULT_REPO"
    return
  fi
  if printf '%s' "$repo" | grep -Eq "$ALLOWED_REPO_PATTERN"; then
    REPO_URL="$repo"
    return
  fi
  # A fork or mirror is a legitimate operator choice, but never a token's
  # choice: it must be confirmed out-of-band with MESH_ALLOW_REPO=1.
  if [ "${MESH_ALLOW_REPO:-0}" = "1" ]; then
    warn "Cloning NON-DEFAULT repo from token (MESH_ALLOW_REPO=1): $repo"
    REPO_URL="$repo"
    return
  fi
  die "Join token points at an unrecognised repo: $repo — refusing to clone it. Re-run with MESH_ALLOW_REPO=1 only if you verified this URL with the lead operator."
}

REPO_URL="$DEFAULT_REPO"
if [ -n "$TOKEN" ]; then
  TOKEN_PAYLOAD=$(decode_token_payload)
  check_token_expiry "$TOKEN_PAYLOAD"
  resolve_repo_url "$TOKEN_PAYLOAD"
fi

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
if [ "$REPAIR" = "1" ]; then
  EXTRA_ARGS="$EXTRA_ARGS --repair"
fi

cd "$MESH_DIR"
MESH_JOIN_TOKEN="$TOKEN" node bin/openclaw-node-init.js $EXTRA_ARGS
