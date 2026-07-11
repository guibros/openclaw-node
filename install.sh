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
SANDBOX=false
NODE_ROLE=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)           DRY_RUN=true ;;
    --update)            UPDATE_ONLY=true ;;
    --skip-mesh)         SKIP_MESH=true ;;
    --enable-services)   ENABLE_SERVICES=true ;;
    --skip-llm)          SKIP_LLM=true ;;
    --skip-verify)       SKIP_VERIFY=true ;;
    --sandbox)           SANDBOX=true; SKIP_LLM=true; SKIP_MESH=true ;;
    --role=*)            NODE_ROLE="${arg#--role=}" ;;
    --help|-h)
      echo "Usage: bash install.sh [--dry-run] [--update] [--skip-mesh] [--skip-llm] [--skip-verify] [--role=lead|worker] [--enable-services]"
      echo "  --dry-run           Show what would happen without making changes"
      echo "  --update            Re-copy scripts/configs only (skip system deps)"
      echo "  --skip-mesh         Skip mesh network setup (used by meta-installer)"
      echo "  --skip-llm          Skip ollama install + model pull + embedder prefetch (extraction degrades to regex)"
      echo "  --skip-verify       Skip the final acceptance gate"
      echo "  --sandbox           Wiring-test mode: skip network-heavy installs (implies --skip-llm --skip-mesh)"
      echo "  --role=lead|worker  Set node role (default: macOS=lead, Linux=worker)"
      echo "  --enable-services   Also enable and start services after installing"
      exit 0
      ;;
  esac
done

# ============================================================
# Helpers
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
    # Verify source paths exist for cp/rsync commands (catches path bugs)
    case "$1" in
      cp)
        if [ ! -e "$2" ]; then
          error "[dry-run] SOURCE MISSING: $2"
          DRY_RUN_ERRORS=$((${DRY_RUN_ERRORS:-0} + 1))
        fi
        ;;
      rsync)
        # rsync source is the last arg before the destination
        local src="${@:(-2):1}"
        if [ ! -e "${src%/}" ] && [ ! -d "${src%/}" ]; then
          error "[dry-run] SOURCE MISSING: ${src}"
          DRY_RUN_ERRORS=$((${DRY_RUN_ERRORS:-0} + 1))
        fi
        ;;
    esac
  else
    "$@"
  fi
}
DRY_RUN_ERRORS=0

detect_os() {
  case "$(uname -s)" in
    Darwin)  echo "macos" ;;
    Linux)   echo "linux" ;;
    *)       echo "unknown" ;;
  esac
}

OS=$(detect_os)

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       OpenClaw Node Installer            ║"
echo "║       Platform: $OS                       "
echo "╚══════════════════════════════════════════╝"
echo ""

# ============================================================
# Step 1: System Dependencies
# ============================================================

if ! $UPDATE_ONLY; then
  step "Step 1: System Dependencies"

  # Node.js
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
    if [ "$NODE_VERSION" -ge 18 ]; then
      info "Node.js v$(node -v | tr -d 'v') found"
    else
      warn "Node.js v$NODE_VERSION found but v18+ required"
      if [ "$OS" = "linux" ]; then
        info "Installing Node.js 22 LTS..."
        run sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
        run sudo apt-get update
        run sudo apt-get install -y nodejs
      else
        error "Please install Node.js 18+ manually: https://nodejs.org"
        exit 1
      fi
    fi
  else
    warn "Node.js not found"
    if [ "$OS" = "linux" ]; then
      info "Installing Node.js 22 LTS..."
      run sudo mkdir -p /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
      run sudo apt-get update
      run sudo apt-get install -y nodejs
    else
      error "Please install Node.js 18+: https://nodejs.org"
      exit 1
    fi
  fi

  # Python 3
  if command -v python3 >/dev/null 2>&1; then
    info "Python 3 found: $(python3 --version)"
  else
    warn "Python 3 not found"
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y python3
    else
      error "Please install Python 3"
      exit 1
    fi
  fi

  # Git
  if command -v git >/dev/null 2>&1; then
    info "Git found: $(git --version | head -1)"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y git
    fi
  fi

  # SQLite3
  if command -v sqlite3 >/dev/null 2>&1; then
    info "SQLite3 found"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y sqlite3
    fi
  fi

  # build-essential (needed for better-sqlite3 native compilation)
  if [ "$OS" = "linux" ]; then
    if dpkg -s build-essential >/dev/null 2>&1; then
      info "build-essential found"
    else
      info "Installing build-essential (needed for native modules)..."
      run sudo apt-get install -y build-essential
    fi
  fi

  # curl
  if command -v curl >/dev/null 2>&1; then
    info "curl found"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y curl
    fi
  fi

  # jq (used by test scripts and JSON processing)
  if command -v jq >/dev/null 2>&1; then
    info "jq found"
  else
    if [ "$OS" = "linux" ]; then
      run sudo apt-get install -y jq
    else
      warn "jq not found — install with: brew install jq (optional, used by test scripts)"
    fi
  fi

  # Python pip (needed for pyyaml)
  if [ "$OS" = "linux" ]; then
    if ! command -v pip3 >/dev/null 2>&1; then
      info "Installing python3-pip..."
      run sudo apt-get install -y python3-pip
    fi
  fi

  # PyYAML (required by compile-boot)
  if python3 -c "import yaml" 2>/dev/null; then
    info "PyYAML found"
  else
    info "Installing PyYAML (required by compile-boot)..."
    run pip3 install --user pyyaml 2>/dev/null || run pip install --user pyyaml 2>/dev/null || warn "Could not install pyyaml — compile-boot will not work"
  fi

  # Screenshot tool (Linux only)
  if [ "$OS" = "linux" ]; then
    if command -v scrot >/dev/null 2>&1 || command -v gnome-screenshot >/dev/null 2>&1 || command -v flameshot >/dev/null 2>&1; then
      info "Screenshot tool found"
    else
      info "Installing scrot (screenshot capture)..."
      run sudo apt-get install -y scrot || warn "Could not install scrot — screenshots will not work"
    fi
  fi

  # nats-server — the bus. Every subsystem talks through it; without it the node
  # is a pile of crash-looping clients (2026-07-11 fresh-install audit).
  if command -v nats-server >/dev/null 2>&1 || [ -x /opt/homebrew/bin/nats-server ] || [ -x /usr/local/bin/nats-server ]; then
    info "nats-server found"
  else
    warn "nats-server not found"
    if [ "$OS" = "macos" ]; then
      if command -v brew >/dev/null 2>&1; then
        run brew install nats-server || { error "brew install nats-server failed — install it and re-run"; exit 1; }
      else
        error "Install nats-server first: brew install nats-server (or https://github.com/nats-io/nats-server/releases)"
        exit 1
      fi
    else
      NATS_VER="${OPENCLAW_NATS_SERVER_VERSION:-2.12.6}"
      case "$(uname -m)" in
        x86_64) NATS_ARCH="amd64" ;;
        aarch64|arm64) NATS_ARCH="arm64" ;;
        *) NATS_ARCH="amd64" ;;
      esac
      info "Installing nats-server v${NATS_VER} (linux-${NATS_ARCH})..."
      if curl -fsSL "https://github.com/nats-io/nats-server/releases/download/v${NATS_VER}/nats-server-v${NATS_VER}-linux-${NATS_ARCH}.tar.gz" | tar xz -C /tmp; then
        run sudo install "/tmp/nats-server-v${NATS_VER}-linux-${NATS_ARCH}/nats-server" /usr/local/bin/nats-server
        info "nats-server installed to /usr/local/bin"
      else
        error "nats-server download failed — install it manually and re-run"
        exit 1
      fi
    fi
  fi

  # ollama — the local LLM runtime (extraction + local mesh agents).
  if ! $SKIP_LLM; then
    if command -v ollama >/dev/null 2>&1; then
      info "ollama found"
    else
      warn "ollama not found"
      if [ "$OS" = "macos" ]; then
        if command -v brew >/dev/null 2>&1; then
          run brew install ollama || warn "brew install ollama failed — extraction degrades to regex until installed"
        else
          warn "Install ollama for local extraction: https://ollama.com/download (node still installs; extraction degrades to regex)"
        fi
      else
        info "Installing ollama (official script)..."
        curl -fsSL https://ollama.com/install.sh | sh || warn "ollama install failed — extraction degrades to regex until installed"
      fi
    fi
  fi
fi

# ── Resolve NODE_BIN (used by service templates) ──
NODE_BIN="$(command -v node 2>/dev/null || echo "")"
if [ -z "$NODE_BIN" ]; then
  error "Node.js not found after dependency install — cannot continue"
  exit 1
fi
export NODE_BIN

# ── Resolve nats-server binary (service templates exec ${NATS_SERVER_BIN}) ──
NATS_SERVER_BIN="$(command -v nats-server 2>/dev/null || echo "")"
if [ -z "$NATS_SERVER_BIN" ]; then
  for p in /opt/homebrew/bin/nats-server /usr/local/bin/nats-server; do
    if [ -x "$p" ]; then NATS_SERVER_BIN="$p"; break; fi
  done
fi
if [ -z "$NATS_SERVER_BIN" ]; then
  error "nats-server not found after dependency install — the bus cannot exist"
  $DRY_RUN || exit 1
  NATS_SERVER_BIN="/usr/local/bin/nats-server"
fi
export NATS_SERVER_BIN
info "nats-server: $NATS_SERVER_BIN"

# ── Repo runtime dependencies ──
# The mesh daemons exec from the repo tree and require the repo's node_modules
# (`nats` above all). The npx path ships them; the git-clone path does not.
if [ ! -d "$REPO_DIR/node_modules/nats" ]; then
  info "Installing repo runtime dependencies (npm install --omit=dev)..."
  (cd "$REPO_DIR" && run npm install --omit=dev) || { error "repo npm install failed — mesh daemons cannot run"; exit 1; }
else
  info "Repo node_modules present"
fi

# ── Resolve node role ──
if [ -z "$NODE_ROLE" ]; then
  NODE_ROLE="${OPENCLAW_NODE_ROLE:-}"
fi
if [ -z "$NODE_ROLE" ]; then
  if [ "$OS" = "macos" ]; then
    NODE_ROLE="lead"
  else
    NODE_ROLE="worker"
  fi
fi
if [ "$NODE_ROLE" != "lead" ] && [ "$NODE_ROLE" != "worker" ]; then
  error "Invalid role: $NODE_ROLE (must be 'lead' or 'worker')"
  exit 1
fi
export OPENCLAW_NODE_ROLE="$NODE_ROLE"
info "Node role: $NODE_ROLE"

# ── Resolve node ID ──
export OPENCLAW_NODE_ID="${OPENCLAW_NODE_ID:-$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')}"
info "Node ID: $OPENCLAW_NODE_ID"

# ── Resolve NATS URL + auth (for service templates) ──
export OPENCLAW_NATS="${OPENCLAW_NATS:-nats://127.0.0.1:4222}"
export OPENCLAW_NATS_TOKEN="${OPENCLAW_NATS_TOKEN:-}"

# ── Claude Code project path encoding (for transcript-sources.json) ──
# Claude encodes workspace paths as: strip leading /, replace / and . with -
claude_project_path() {
  echo "$1" | sed 's|^/||; s|[/.]|-|g'
}
export CLAUDE_PROJECT_WORKSPACE="$(claude_project_path "$WORKSPACE")"
export CLAUDE_PROJECT_HOME="$(claude_project_path "$HOME")"

# ── Resolve paths for service templates ──
export OPENCLAW_WORKSPACE="$WORKSPACE"
export OPENCLAW_REPO_DIR="$REPO_DIR"
export NPM_BIN="$(command -v npm 2>/dev/null || echo "$HOME/.openclaw/workspace/.npm-global/bin/npm")"

# ============================================================
# Step 2: Directory Structure
# ============================================================

step "Step 2: Directory Structure"

DIRS=(
  "$OPENCLAW_ROOT"
  "$OPENCLAW_ROOT/config"
  "$OPENCLAW_ROOT/services"
  "$OPENCLAW_ROOT/souls"
  "$OPENCLAW_ROOT/cron"
  "$OPENCLAW_ROOT/devices"
  "$OPENCLAW_ROOT/logs"
  "$OPENCLAW_ROOT/agents/main/sessions"
  "$WORKSPACE"
  "$WORKSPACE/.tmp"
  "$WORKSPACE/.tmp/active-sessions"
  "$WORKSPACE/memory"
  "$WORKSPACE/memory/archive"
  "$WORKSPACE/.learnings"
  "$WORKSPACE/.boot"
  "$WORKSPACE/bin"
  "$WORKSPACE/bin/hooks"
  "$WORKSPACE/bin/lib"
  "$WORKSPACE/skills"
  "$WORKSPACE/projects"
  "$WORKSPACE/memory-vault"
)

for dir in "${DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    run mkdir -p "$dir"
    info "Created $dir"
  fi
done
info "Directory structure ready"

# ============================================================
# Step 3: Copy bin/ scripts
# ============================================================

step "Step 3: Install Workspace Scripts"

run rsync -av --exclude='*.bak' --exclude='*.bak.*' --exclude='routing-eval-tests.json' \
  "$REPO_DIR/workspace-bin/" "$WORKSPACE/bin/"
# The node-watch/acceptance service units exec ${OPENCLAW_WORKSPACE}/bin/node-watch.mjs —
# these live in repo bin/ (not workspace-bin/) and must land at that path too.
# openclaw-notify.mjs rides along: the viewer, the notify shim, and node-watch
# all resolve it next to themselves (or at ../bin/) in the deployed tree.
run cp "$REPO_DIR/bin/node-watch.mjs" "$REPO_DIR/bin/node-acceptance.mjs" \
  "$REPO_DIR/bin/openclaw-notify.mjs" \
  "$REPO_DIR/bin/obsidian-graph-cache.mjs" "$REPO_DIR/bin/observer.mjs" \
  "$REPO_DIR/bin/consolidation-scheduler.mjs" "$WORKSPACE/bin/"
run chmod +x "$WORKSPACE/bin/"*
run chmod +x "$WORKSPACE/bin/hooks/"* 2>/dev/null || true
info "Workspace scripts installed to $WORKSPACE/bin/"

# Shared libs → ~/.openclaw/workspace/lib/  (workspace daemons import from ../lib/)
# mcp-knowledge MUST be included — memory-daemon.mjs statically imports it;
# excluding it killed every fresh install (2026-07-11 audit).
run mkdir -p "$WORKSPACE/lib"
run rsync -av --exclude='node_modules' \
  "$REPO_DIR/lib/" "$WORKSPACE/lib/"
info "Shared libraries installed to $WORKSPACE/lib/ (incl. mcp-knowledge)"

# mcp-knowledge (the embedder) carries its own deps — install them for the copy
# the workspace daemons actually import
if [ -f "$WORKSPACE/lib/mcp-knowledge/package.json" ] && [ ! -d "$WORKSPACE/lib/mcp-knowledge/node_modules" ]; then
  info "Installing mcp-knowledge dependencies (workspace copy)..."
  (cd "$WORKSPACE/lib/mcp-knowledge" && run npm install --production 2>/dev/null) || warn "mcp-knowledge deps failed — embeddings/semantic search will not work"
fi

# Event schemas — local-event-log.mjs imports ../packages/event-schemas/dist;
# without it the daemon's event spine silently degrades off (2026-07-11 boot test)
if [ -d "$REPO_DIR/packages" ]; then
  run rsync -av --exclude='node_modules' "$REPO_DIR/packages/" "$WORKSPACE/packages/"
  info "Event schemas installed to $WORKSPACE/packages/"
fi

# Symlink shared deps from repo/mesh node_modules → workspace node_modules
# (ESM static imports don't resolve via NODE_PATH alone). `nats` and `js-yaml`
# are required by the workspace daemons' import graph (2026-07-11 audit).
OPENCLAW_MESH_HOME="${OPENCLAW_MESH_HOME:-$HOME/openclaw}"
MESH_NM="$REPO_DIR/node_modules"
if [ ! -d "$MESH_NM/better-sqlite3" ]; then
  MESH_NM="$OPENCLAW_MESH_HOME/node_modules"
fi

# If native deps still missing, install them at the mesh home
if [ ! -d "$MESH_NM/better-sqlite3" ]; then
  info "Installing native dependencies at $OPENCLAW_MESH_HOME/..."
  run mkdir -p "$OPENCLAW_MESH_HOME"
  (cd "$OPENCLAW_MESH_HOME" && [ ! -f package.json ] && npm init -y >/dev/null 2>&1; npm install --no-save better-sqlite3 bindings 2>/dev/null) || warn "Native dep install failed — SQLite features may not work"
  MESH_NM="$OPENCLAW_MESH_HOME/node_modules"
fi

WS_NM="$WORKSPACE/node_modules"
run mkdir -p "$WS_NM"
# The workspace daemons ARE repo code copied out — their import graph is a
# subset of the repo's dependency set by construction. Symlink every package
# (a fixed allow-list rots: zod was missed on 2026-07-11, nats before it).
WS_LINKED=0
for pkgdir in "$MESH_NM"/*/; do
  pkg=$(basename "$pkgdir")
  [ "$pkg" = ".bin" ] && continue
  if [ ! -e "$WS_NM/$pkg" ]; then
    run ln -sfn "$MESH_NM/$pkg" "$WS_NM/$pkg"
    WS_LINKED=$((WS_LINKED + 1))
  fi
done
info "Shared dependencies symlinked to $WS_NM/ ($WS_LINKED new links from $MESH_NM)"

# Mesh daemons and CLI tools → mesh home bin/
MESH_BIN="$OPENCLAW_MESH_HOME/bin"
MESH_LIB="$OPENCLAW_MESH_HOME/lib"
run mkdir -p "$MESH_BIN" "$MESH_LIB"
run rsync -av "$REPO_DIR/bin/" "$MESH_BIN/"
run rsync -av "$REPO_DIR/lib/" "$MESH_LIB/"
run chmod +x "$MESH_BIN/"*.sh 2>/dev/null || true
info "Mesh daemons installed to $MESH_BIN/ ($(ls -1 "$REPO_DIR/bin/" | wc -l | tr -d ' ') files)"
info "Shared libraries installed to $MESH_LIB/"

# Install mcp-knowledge dependencies if it has its own package.json
if [ -f "$MESH_LIB/mcp-knowledge/package.json" ] && [ ! -d "$MESH_LIB/mcp-knowledge/node_modules" ]; then
  info "Installing MCP knowledge server dependencies..."
  (cd "$MESH_LIB/mcp-knowledge" && npm install --production 2>/dev/null) || warn "mcp-knowledge deps failed — semantic search may not work"
fi

# ============================================================
# Step 4: Copy Identity Files
# ============================================================

step "Step 4: Identity Files"

for f in CLAUDE.md SOUL.md PRINCIPLES.md AGENTS.md DELEGATION.md HEARTBEAT.md MEMORY_SPEC.md TOOLS.md; do
  if [ -f "$REPO_DIR/identity/$f" ]; then
    if [ ! -f "$WORKSPACE/$f" ]; then
      run cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f"
      info "Installed $f"
    elif ! diff -q "$WORKSPACE/$f" "$REPO_DIR/identity/$f" >/dev/null 2>&1; then
      run cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f.repo"
      warn "$f differs from repo — saved repo version as $f.repo (merge manually)"
    else
      info "$f up to date"
    fi
  fi
done

# ============================================================
# Step 5: Copy Souls
# ============================================================

step "Step 5: Soul Definitions"

run rsync -av "$REPO_DIR/souls/" "$OPENCLAW_ROOT/souls/"
info "Souls installed to $OPENCLAW_ROOT/souls/"

# ============================================================
# Step 6: Copy Skills
# ============================================================

step "Step 6: Skills"

run rsync -av --exclude='dist/' --exclude='scripts/' "$REPO_DIR/skills/" "$WORKSPACE/skills/"
info "Skills installed to $WORKSPACE/skills/ ($(ls -d "$REPO_DIR/skills"/*/ 2>/dev/null | grep -v dist | grep -v scripts | wc -l | tr -d ' ') skills)"

# Install skill-specific dependencies (npm/pip where needed)
if $SANDBOX; then
  info "Sandbox: skipping skill dependencies"
else
info "Installing skill dependencies..."
for skill_dir in "$WORKSPACE/skills"/*/; do
  skill_name=$(basename "$skill_dir")
  # npm-based skills
  if [ -f "$skill_dir/package.json" ] && [ ! -d "$skill_dir/node_modules" ]; then
    (cd "$skill_dir" && run npm install --production 2>/dev/null) && info "  npm: $skill_name" || warn "  npm failed: $skill_name"
  fi
  # pip-based skills
  if [ -f "$skill_dir/requirements.txt" ]; then
    run pip3 install --user -r "$skill_dir/requirements.txt" 2>/dev/null || warn "  pip failed: $skill_name"
    info "  pip: $skill_name"
  fi
done
fi

# ============================================================
# Step 7: Environment File
# ============================================================

step "Step 7: Environment Configuration"

if [ ! -f "$ENV_FILE" ]; then
  run cp "$REPO_DIR/openclaw.env.example" "$ENV_FILE"
  warn "Created $ENV_FILE — EDIT THIS FILE with your API keys before proceeding!"
  warn "Run: nano $ENV_FILE"
else
  info "Environment file already exists at $ENV_FILE"
fi

# Source env file for config generation (safe key=value parsing — no shell execution)
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Split only on the first '=' to preserve base64 padding etc.
    key="${line%%=*}"
    value="${line#*=}"
    # Trim whitespace
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | xargs)"
    # Only export valid variable names
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && export "$key=$value"
  done < "$ENV_FILE"
fi

# Generate OPENCLAW_NATS_TOKEN if not set — server-side auth token (D2, federation step 1.1).
# Clients already resolve+send it via lib/nats-resolve.js; this closes the server-side gap.
if [ -z "${OPENCLAW_NATS_TOKEN:-}" ]; then
  OPENCLAW_NATS_TOKEN="$(openssl rand -hex 32)"
  export OPENCLAW_NATS_TOKEN
  if [ -f "$ENV_FILE" ]; then
    echo "OPENCLAW_NATS_TOKEN=$OPENCLAW_NATS_TOKEN" >> "$ENV_FILE"
    info "Generated OPENCLAW_NATS_TOKEN and persisted to $ENV_FILE"
  fi
fi

# LLM backend defaults (docs/NODE_SPEC.md §3) — local-first. Pre-existing env
# files may predate these keys; append them so units render with a real brain.
if [ -f "$ENV_FILE" ] && ! grep -q '^MESH_LLM_PROVIDER=' "$ENV_FILE"; then
  {
    echo ""
    echo "# LLM backend (appended by install.sh — docs/NODE_SPEC.md §3)"
    echo "MESH_LLM_PROVIDER=ollama"
  } >> "$ENV_FILE"
  info "Appended MESH_LLM_PROVIDER=ollama to $ENV_FILE"
fi
if [ -f "$ENV_FILE" ] && ! grep -q '^LLM_MODEL=' "$ENV_FILE"; then
  echo "LLM_MODEL=qwen3:8b" >> "$ENV_FILE"
fi
if [ -f "$ENV_FILE" ] && ! grep -q '^LLM_BASE_URL=' "$ENV_FILE"; then
  echo "LLM_BASE_URL=http://localhost:11434" >> "$ENV_FILE"
fi
export MESH_LLM_PROVIDER="${MESH_LLM_PROVIDER:-ollama}"
export LLM_MODEL="${LLM_MODEL:-qwen3:8b}"
export LLM_BASE_URL="${LLM_BASE_URL:-http://localhost:11434}"

# Set defaults for template substitution
export OPENCLAW_NODE_ID="${OPENCLAW_NODE_ID:-$(hostname -s)}"
export OPENCLAW_TIMEZONE="${OPENCLAW_TIMEZONE:-America/Montreal}"
export OPENCLAW_WORKSPACE="$WORKSPACE"

# ============================================================
# Step 8: Generate Configs from Templates
# ============================================================

step "Step 8: Configuration Files"

generate_config() {
  local template="$1"
  local output="$2"
  local basename
  basename=$(basename "$output")

  if [ -f "$output" ] && ! $UPDATE_ONLY; then
    info "Config $basename already exists, skipping (use --update to overwrite)"
    return
  fi

  if command -v envsubst >/dev/null 2>&1; then
    envsubst < "$template" > "$output"
  else
    # Fallback: manual sed substitution
    sed \
      -e "s|\${HOME}|$HOME|g" \
      -e "s|\${OPENCLAW_WORKSPACE}|$WORKSPACE|g" \
      -e "s|\${OPENCLAW_REPO_DIR}|$REPO_DIR|g" \
      -e "s|\${OPENCLAW_NODE_ID}|$OPENCLAW_NODE_ID|g" \
      -e "s|\${OPENCLAW_TIMEZONE}|$OPENCLAW_TIMEZONE|g" \
      -e "s|\${OPENAI_API_KEY}|${OPENAI_API_KEY:-}|g" \
      -e "s|\${GOOGLE_API_KEY}|${GOOGLE_API_KEY:-}|g" \
      -e "s|\${ANTHROPIC_API_KEY}|${ANTHROPIC_API_KEY:-}|g" \
      -e "s|\${DISCORD_BOT_TOKEN}|${DISCORD_BOT_TOKEN:-}|g" \
      -e "s|\${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN:-}|g" \
      -e "s|\${WEB_SEARCH_API_KEY}|${WEB_SEARCH_API_KEY:-}|g" \
      -e "s|\${OBSIDIAN_API_KEY}|${OBSIDIAN_API_KEY:-}|g" \
      -e "s|\${OPENCLAW_NATS}|${OPENCLAW_NATS:-}|g" \
      -e "s|\${OPENCLAW_NATS_TOKEN}|${OPENCLAW_NATS_TOKEN:-}|g" \
      -e "s|\${CLAUDE_PROJECT_WORKSPACE}|${CLAUDE_PROJECT_WORKSPACE}|g" \
      -e "s|\${CLAUDE_PROJECT_HOME}|${CLAUDE_PROJECT_HOME}|g" \
      "$template" > "$output"
  fi
  chmod 600 "$output"
  info "Generated $basename (mode 600)"
}

generate_config "$REPO_DIR/config/daemon.json.template" "$OPENCLAW_ROOT/config/daemon.json"
generate_config "$REPO_DIR/config/transcript-sources.json.template" "$OPENCLAW_ROOT/config/transcript-sources.json"

# NATS config rendering — templates → ~/.openclaw/config/ (token embedded).
# nats.conf is the DEFAULT single-node bus every fresh node runs; nats-{1,2,3}
# are the R=3 cluster (operator-gated upgrade, federation step 1.5).
run mkdir -p "$OPENCLAW_ROOT/nats"
generate_config "$REPO_DIR/services/nats/nats-single.conf" "$OPENCLAW_ROOT/config/nats.conf"
generate_config "$REPO_DIR/services/nats/nats-1.conf" "$OPENCLAW_ROOT/config/nats-1.conf"
generate_config "$REPO_DIR/services/nats/nats-2.conf" "$OPENCLAW_ROOT/config/nats-2.conf"
generate_config "$REPO_DIR/services/nats/nats-3.conf" "$OPENCLAW_ROOT/config/nats-3.conf"
generate_config "$REPO_DIR/config/obsidian-sync.json.template" "$OPENCLAW_ROOT/config/obsidian-sync.json"
generate_config "$REPO_DIR/config/openclaw.json.template" "$OPENCLAW_ROOT/openclaw.json"

# ============================================================
# Step 8.5: Node Identity (ed25519 — grappe signing, federation 1.4)
# ============================================================

step "Step 8.5: Node Identity"

if $DRY_RUN; then
  info "[dry-run] would provision ed25519 identity at $OPENCLAW_ROOT"
elif OPENCLAW_IDENTITY_DIR="$OPENCLAW_ROOT" OPENCLAW_REPO_LIB="$REPO_DIR/lib" "$NODE_BIN" --input-type=module -e '
    const { getOrCreateIdentity } = await import(process.env.OPENCLAW_REPO_LIB + "/node-identity.mjs");
    const id = getOrCreateIdentity(process.env.OPENCLAW_IDENTITY_DIR);
    const pub = String(id.publicKey || id.public_key || "");
    console.log("  identity:", pub ? pub.slice(0, 24) + "…" : "(created)");
  '; then
  info "Node identity provisioned"
else
  warn "Identity provisioning failed — signed grappe membership unavailable until fixed"
fi

# ============================================================
# Step 8.6: LLM Backend (the node's local-first brain)
# ============================================================

step "Step 8.6: LLM Backend"

if $SKIP_LLM; then
  info "Skipped (--skip-llm) — extraction degrades to regex; local agents have no provider"
elif $DRY_RUN; then
  info "[dry-run] would ensure ollama up, RAM-tier LLM_MODEL, model pulled, embedder prefetched"
else
  if ! curl -fsS --max-time 3 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1; then
    if command -v ollama >/dev/null 2>&1; then
      info "Starting ollama..."
      if [ "$OS" = "macos" ]; then
        brew services start ollama >/dev/null 2>&1 || { nohup ollama serve >"$OPENCLAW_ROOT/logs/ollama.log" 2>&1 & }
      else
        sudo systemctl start ollama 2>/dev/null || { nohup ollama serve >"$OPENCLAW_ROOT/logs/ollama.log" 2>&1 & }
      fi
      for _ in $(seq 1 15); do
        curl -fsS --max-time 2 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1 && break
        sleep 2
      done
    fi
  fi

  if curl -fsS --max-time 3 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1; then
    # RAM-tier model pick — upgrades only the shipped floor default, never an
    # operator-customized value
    TIER_MODEL=$("$NODE_BIN" "$REPO_DIR/bin/check-llm-baseline.mjs" --json 2>/dev/null | "$NODE_BIN" -e '
      let s = "";
      process.stdin.on("data", (d) => s += d).on("end", () => {
        try { console.log(JSON.parse(s).recommendation?.model || ""); } catch { console.log(""); }
      });
    ' 2>/dev/null || echo "")
    if [ -n "$TIER_MODEL" ] && [ "$LLM_MODEL" = "qwen3:8b" ] && [ "$TIER_MODEL" != "qwen3:8b" ]; then
      sed -i.bak "s|^LLM_MODEL=qwen3:8b$|LLM_MODEL=$TIER_MODEL|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
      export LLM_MODEL="$TIER_MODEL"
      info "RAM-tier upgrade: LLM_MODEL=$TIER_MODEL"
    fi

    if curl -fsS --max-time 5 "$LLM_BASE_URL/api/tags" | grep -q "\"$LLM_MODEL\""; then
      info "$LLM_MODEL present"
    else
      info "Pulling $LLM_MODEL (one-time, several GB — this is the node's brain)..."
      ollama pull "$LLM_MODEL" || warn "ollama pull failed — extraction degrades to regex until pulled"
    fi
  else
    warn "ollama unreachable at $LLM_BASE_URL — extraction degrades to regex; local agents have no provider"
  fi

  # Embedder prefetch (Xenova/bge-m3, ~2GB one-time HuggingFace download) so the
  # first real search doesn't stall on it.
  if [ -d "$WORKSPACE/lib/mcp-knowledge/node_modules" ]; then
    info "Prefetching embedder Xenova/bge-m3 (~2GB one-time; cached afterwards)..."
    if OPENCLAW_WS_LIB="$WORKSPACE/lib" "$NODE_BIN" --input-type=module -e '
        const core = await import(process.env.OPENCLAW_WS_LIB + "/mcp-knowledge/core.mjs");
        const embed = core.embed || core.getEmbedder;
        if (!embed) throw new Error("no embed/getEmbedder export");
        await embed("installation warmup");
        console.log("  embedder ready");
      '; then
      info "Embedder ready"
    else
      warn "Embedder prefetch failed — first semantic-search use downloads it (needs internet)"
    fi
  else
    warn "mcp-knowledge deps missing — embedder not prefetched"
  fi
fi

# ============================================================
# Step 9: Boot Manifest
# ============================================================

step "Step 9: Boot System"

if [ -f "$REPO_DIR/boot/manifest.yaml" ]; then
  run cp "$REPO_DIR/boot/manifest.yaml" "$WORKSPACE/.boot/manifest.yaml"
  info "Boot manifest installed"
fi

# Compile boot profiles
if [ -f "$WORKSPACE/bin/compile-boot" ]; then
  info "Compiling boot profiles..."
  run python3 "$WORKSPACE/bin/compile-boot" --all 2>/dev/null || warn "Boot compilation skipped (may need identity files in place first)"
fi

# ============================================================
# Step 10: Obsidian Vault Scaffold
# ============================================================

step "Step 10: Obsidian Vault"

VAULT_DIR="$WORKSPACE/projects/arcane-vault"
if [ -d "$REPO_DIR/obsidian-vault" ]; then
  if [ ! -d "$VAULT_DIR/.obsidian" ]; then
    run mkdir -p "$VAULT_DIR"
    run rsync -av "$REPO_DIR/obsidian-vault/" "$VAULT_DIR/"
    # Remove .gitkeep files (only needed for git, not for runtime)
    find "$VAULT_DIR" -name '.gitkeep' -delete 2>/dev/null || true
    info "Obsidian vault scaffold installed (22 domain folders + plugins)"
    warn "Obsidian Local REST API plugin included. Set API key in $VAULT_DIR/.obsidian-api-key"
  else
    info "Obsidian vault already exists, skipping"
  fi
fi

# ============================================================
# Step 11: Mission Control
# ============================================================

step "Step 11: Mission Control"

MC_DIR="$WORKSPACE/projects/mission-control"
if [ ! -d "$MC_DIR/src" ]; then
  run mkdir -p "$MC_DIR"
  run rsync -av --exclude='node_modules' --exclude='.next' --exclude='*.db' \
    "$REPO_DIR/mission-control/" "$MC_DIR/"
  info "Mission Control source copied"
else
  info "Mission Control already exists, updating source..."
  run rsync -av --exclude='node_modules' --exclude='.next' --exclude='*.db' \
    "$REPO_DIR/mission-control/" "$MC_DIR/"
fi

if $SANDBOX; then
  info "Sandbox: skipping Mission Control dependencies + build"
elif [ ! -d "$MC_DIR/node_modules" ]; then
  info "Installing Mission Control dependencies (this may take a minute)..."
  (cd "$MC_DIR" && run npm install)
elif $UPDATE_ONLY; then
  info "Updating Mission Control dependencies..."
  (cd "$MC_DIR" && run npm install)
else
  info "Mission Control dependencies already installed"
fi

# Production build — the unit runs `npm start` (= next start), which needs a
# .next build; without one the unit crash-loops (2026-07-11 audit).
if ! $SANDBOX && ! $DRY_RUN && [ -d "$MC_DIR/node_modules" ] && [ ! -d "$MC_DIR/.next" ]; then
  info "Building Mission Control (next build)..."
  if (cd "$MC_DIR" && npm run build); then
    info "Mission Control production build ready"
  else
    warn "Mission Control build FAILED — the unit cannot serve until fixed (known queued tsc errors)."
    warn "Interim: cd $MC_DIR && npm run dev   — the acceptance gate reports MC honestly either way"
  fi
fi

# Create .env.local for MC if not exists
if [ ! -f "$MC_DIR/.env.local" ]; then
  cat > "$MC_DIR/.env.local" << MCENV
# Mission Control Environment
WORKSPACE_ROOT=$WORKSPACE
OPENCLAW_HOME=$OPENCLAW_ROOT
DB_PATH=$MC_DIR/data/mission-control.db

# NATS (mesh connectivity — resolved from openclaw.env if not set here)
OPENCLAW_NATS=${OPENCLAW_NATS:-}
OPENCLAW_NATS_TOKEN=${OPENCLAW_NATS_TOKEN:-}

# TTS (optional — falls back to Edge TTS if missing)
GEMINI_API_KEY=${GOOGLE_API_KEY:-}
MCENV
  info "Created Mission Control .env.local"
fi

# Ensure data directory exists for SQLite
run mkdir -p "$MC_DIR/data"

# ============================================================
# Step 12: Playwright (web-fetch fallback)
# ============================================================

step "Step 12: Playwright Browser"

if $SANDBOX; then
  info "Sandbox: skipping Playwright"
elif [ -f "$WORKSPACE/node_modules/.package-lock.json" ] && grep -q '"playwright"' "$WORKSPACE/node_modules/.package-lock.json" 2>/dev/null; then
  info "Playwright already installed in workspace"
else
  info "Installing Playwright + Chromium (web-fetch fallback for anti-bot sites)..."
  (cd "$WORKSPACE" && run npm install --save playwright 2>/dev/null) || warn "Playwright npm install failed"
  (cd "$WORKSPACE" && run npx playwright install chromium 2>/dev/null) || warn "Chromium browser install failed"
fi

# ============================================================
# Step 13: Companion Bridge (OpenAI-compatible Claude adapter)
# ============================================================

step "Step 13: Companion Bridge"

if $SANDBOX; then
  info "Sandbox: skipping companion-bridge"
elif command -v companion-bridge >/dev/null 2>&1; then
  info "companion-bridge already installed: $(companion-bridge --version 2>/dev/null || echo 'found')"
else
  info "Installing companion-bridge (OpenAI-compatible adapter for Claude Code)..."
  if [ "$OS" = "linux" ]; then
    run sudo npm install -g companion-bridge || warn "companion-bridge install failed"
  else
    run npm install -g companion-bridge || warn "companion-bridge install failed"
  fi
fi

# Deploy harness rules (user-level override for companion-bridge)
HARNESS_SRC="${REPO_DIR}/config/harness-rules.json"
HARNESS_DST="${OPENCLAW_ROOT}/harness-rules.json"
if [ -f "$HARNESS_SRC" ]; then
  if [ ! -f "$HARNESS_DST" ]; then
    info "Deploying default harness rules to $HARNESS_DST"
    mkdir -p "$(dirname "$HARNESS_DST")"
    cp "$HARNESS_SRC" "$HARNESS_DST"
  else
    info "Syncing harness rules (smart merge — user edits preserved)..."
    node "${REPO_DIR}/bin/harness-sync.js" apply
  fi
fi

# ============================================================
# Step 14: ClawVault
# ============================================================

step "Step 14: ClawVault"

if command -v clawvault >/dev/null 2>&1; then
  info "ClawVault already installed: $(which clawvault)"
elif [ -d "$WORKSPACE/.npm-global" ]; then
  info "ClawVault: checking npm-global..."
  if [ -f "$WORKSPACE/.npm-global/bin/clawvault" ]; then
    info "ClawVault found in .npm-global"
  else
    warn "ClawVault not found. Install with: npm install -g clawvault"
  fi
else
  warn "ClawVault not installed. Install with: npm install -g clawvault"
  warn "(Non-critical — memory system works without it)"
fi

# ============================================================
# Step 15: Initialize Memory
# ============================================================

step "Step 15: Initialize Memory"

TODAY=$(date +%Y-%m-%d)
DAILY_FILE="$WORKSPACE/memory/$TODAY.md"

if [ ! -f "$DAILY_FILE" ]; then
  cat > "$DAILY_FILE" << DAILY
# $TODAY

Node initialized on $(hostname) at $(date '+%H:%M %Z').
DAILY
  info "Created daily memory file: $TODAY.md"
fi

if [ ! -f "$WORKSPACE/memory/active-tasks.md" ]; then
  cat > "$WORKSPACE/memory/active-tasks.md" << TASKS
# Active Tasks

Updated: $TODAY $(date '+%H:%M') $OPENCLAW_TIMEZONE

Use this as crash-recovery state.

## Task Template

\`\`\`yaml
task_id: T-YYYYMMDD-001
title: <short title>
status: queued|running|blocked|waiting-user|done|cancelled
owner: main|sub-agent:<sessionKey>
success_criteria:
  - <criterion 1>
artifacts:
  - <path/or/link>
next_action: <single next step>
updated_at: YYYY-MM-DD HH:MM
\`\`\`

## Live Tasks

(none yet)
TASKS
  info "Created active-tasks.md"
fi

if [ ! -f "$WORKSPACE/.companion-state.md" ]; then
  cat > "$WORKSPACE/.companion-state.md" << STATE
## Session Status
status: inactive
started_at:
last_flush: $(date -Iseconds)

## Active Task
(none)

## Current State
0 running, 0 done
STATE
  info "Created .companion-state.md"
fi

if [ ! -f "$WORKSPACE/.learnings/lessons.md" ]; then
  cat > "$WORKSPACE/.learnings/lessons.md" << LESSONS
# Lessons Learned

Accumulated corrections and preferences.

## Format
- **Date** | **Category** | **Lesson** | **Source**
LESSONS
  info "Created lessons.md"
fi

if [ ! -f "$WORKSPACE/MEMORY.md" ]; then
  cat > "$WORKSPACE/MEMORY.md" << MEM
# MEMORY.md — Long-Term Memory

## Active Context (this week)

- Node initialized: $TODAY on $(hostname)

## Recent (this month)

## Stable (long-term preferences & facts)

## Archive Reference
- See memory/archive/ for historical context
MEM
  info "Created MEMORY.md"
fi

# ============================================================
# Step 15.5: HyperAgent Protocol
# ============================================================

step "Step 15.5: HyperAgent Protocol"

if [ -f "$MESH_BIN/hyperagent.mjs" ]; then
  mkdir -p "$OPENCLAW_ROOT/state"
  if node "$MESH_BIN/hyperagent.mjs" status 2>/dev/null; then
    info "HyperAgent store initialized"
  else
    warn "HyperAgent init deferred (will init on first use)"
  fi
else
  warn "hyperagent.mjs not found in $MESH_BIN — skipping"
fi

# ============================================================
# Step 16: Install Services (role-aware, template-based)
# ============================================================

step "Step 16: Install Services (role=$NODE_ROLE)"

MANIFEST="$REPO_DIR/services/service-manifest.json"
LAUNCHD_TEMPLATES="$REPO_DIR/services/launchd"
SYSTEMD_TEMPLATES="$REPO_DIR/services/systemd"
LAUNCHD_DEST="${OPENCLAW_LAUNCHD_DIR:-$HOME/Library/LaunchAgents}"
SYSTEMD_DEST="${OPENCLAW_SYSTEMD_DIR:-$HOME/.config/systemd/user}"
INSTALLED_COUNT=0
SKIPPED_COUNT=0
RENDER_ERRORS=0

# Fail-loud render audit — a unit shipping a live ${VAR} placeholder is broken
# by construction (the silent-unrendered class, 2026-07-11 audit).
check_rendered() {
  local f="$1" left
  left=$(grep -oE '\$\{[A-Za-z_]+\}' "$f" 2>/dev/null | sort -u | tr '\n' ' ' || true)
  if [ -n "${left// /}" ]; then
    error "  UNRENDERED placeholders in $(basename "$f"): $left"
    RENDER_ERRORS=$((RENDER_ERRORS + 1))
  fi
}

# Ensure log directories exist
run mkdir -p "$OPENCLAW_ROOT/logs" "$WORKSPACE/.tmp"

if [ ! -f "$MANIFEST" ]; then
  warn "Service manifest not found at $MANIFEST — skipping service installation"
else
  # Read manifest entries using node (jq may not be available yet)
  SERVICES=$("$NODE_BIN" -e "
    const m = require('$MANIFEST');
    m.forEach(s => console.log([s.name, s.role, s.autostart, s.timer || false].join('|')));
  ")

  while IFS='|' read -r SVC_NAME SVC_ROLE SVC_AUTO SVC_TIMER; do
    # Role filtering: install if role matches or role=both
    if [ "$SVC_ROLE" != "both" ] && [ "$SVC_ROLE" != "$NODE_ROLE" ]; then
      SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
      continue
    fi

    if [ "$OS" = "macos" ]; then
      LAUNCHD_SVC_NAME="${SVC_NAME#openclaw-}"
      TEMPLATE="$LAUNCHD_TEMPLATES/ai.openclaw.${LAUNCHD_SVC_NAME}.plist"
      DEST="$LAUNCHD_DEST/ai.openclaw.${LAUNCHD_SVC_NAME}.plist"

      if [ ! -f "$TEMPLATE" ]; then
        warn "  Template not found: $TEMPLATE"
        continue
      fi

      run mkdir -p "$LAUNCHD_DEST"

      if command -v envsubst >/dev/null 2>&1; then
        envsubst < "$TEMPLATE" > "$DEST"
      else
        # NOTE: sed delimiter is |. If OPENCLAW_NATS_TOKEN ever contains |
        # (unlikely — tokens are hex/base64), this substitution will break.
        # Prefer envsubst (above) when available; it has no delimiter issue.
        sed \
          -e "s|\${HOME}|$HOME|g" \
          -e "s|\${NODE_BIN}|$NODE_BIN|g" \
          -e "s|\${OPENCLAW_WORKSPACE}|$OPENCLAW_WORKSPACE|g" \
          -e "s|\${OPENCLAW_NATS}|$OPENCLAW_NATS|g" \
          -e "s|\${OPENCLAW_NATS_TOKEN}|$OPENCLAW_NATS_TOKEN|g" \
          -e "s|\${OPENCLAW_NODE_ID}|$OPENCLAW_NODE_ID|g" \
          -e "s|\${OPENCLAW_NODE_ROLE}|$OPENCLAW_NODE_ROLE|g" \
          -e "s|\${OPENCLAW_REPO_DIR}|$OPENCLAW_REPO_DIR|g" \
          -e "s|\${NPM_BIN}|$NPM_BIN|g" \
          -e "s|\${NATS_SERVER_BIN}|$NATS_SERVER_BIN|g" \
          -e "s|\${MESH_LLM_PROVIDER}|$MESH_LLM_PROVIDER|g" \
          -e "s|\${LLM_MODEL}|$LLM_MODEL|g" \
          -e "s|\${LLM_BASE_URL}|$LLM_BASE_URL|g" \
          "$TEMPLATE" > "$DEST"
      fi
      check_rendered "$DEST"

      # Refresh only when this run manages the lifecycle — a bare unload
      # without a reload silently downs a running node (2026-07-11 audit).
      if [ "$SVC_AUTO" = "true" ] && $ENABLE_SERVICES; then
        launchctl unload "$DEST" 2>/dev/null || true
        launchctl load "$DEST"
        info "  Installed + loaded: $SVC_NAME"
      else
        info "  Installed: $SVC_NAME (load manually: launchctl load $DEST)"
      fi
      INSTALLED_COUNT=$((INSTALLED_COUNT + 1))

    elif [ "$OS" = "linux" ]; then
      run mkdir -p "$SYSTEMD_DEST"

      # Handle timer-based services (service + timer)
      if [ "$SVC_TIMER" = "true" ]; then
        for ext in service timer; do
          TEMPLATE="$SYSTEMD_TEMPLATES/${SVC_NAME}.${ext}"
          DEST="$SYSTEMD_DEST/${SVC_NAME}.${ext}"
          if [ ! -f "$TEMPLATE" ]; then
            warn "  Template not found: $TEMPLATE"
            continue
          fi
          if command -v envsubst >/dev/null 2>&1; then
            envsubst < "$TEMPLATE" > "$DEST"
          else
            sed \
              -e "s|\${HOME}|$HOME|g" \
              -e "s|\${NODE_BIN}|$NODE_BIN|g" \
              -e "s|\${OPENCLAW_WORKSPACE}|$OPENCLAW_WORKSPACE|g" \
              -e "s|\${OPENCLAW_NATS}|$OPENCLAW_NATS|g" \
              -e "s|\${OPENCLAW_NATS_TOKEN}|$OPENCLAW_NATS_TOKEN|g" \
              -e "s|\${OPENCLAW_NODE_ID}|$OPENCLAW_NODE_ID|g" \
              -e "s|\${OPENCLAW_NODE_ROLE}|$OPENCLAW_NODE_ROLE|g" \
              -e "s|\${OPENCLAW_REPO_DIR}|$OPENCLAW_REPO_DIR|g" \
              -e "s|\${NPM_BIN}|$NPM_BIN|g" \
              -e "s|\${NATS_SERVER_BIN}|$NATS_SERVER_BIN|g" \
              -e "s|\${MESH_LLM_PROVIDER}|$MESH_LLM_PROVIDER|g" \
              -e "s|\${LLM_MODEL}|$LLM_MODEL|g" \
              -e "s|\${LLM_BASE_URL}|$LLM_BASE_URL|g" \
              "$TEMPLATE" > "$DEST"
          fi
          check_rendered "$DEST"
        done
        if $ENABLE_SERVICES; then
          systemctl --user enable "${SVC_NAME}.timer"
          systemctl --user start "${SVC_NAME}.timer"
          info "  Installed + enabled: $SVC_NAME (timer)"
        else
          info "  Installed: $SVC_NAME (timer — enable with: systemctl --user enable --now ${SVC_NAME}.timer)"
        fi
      else
        TEMPLATE="$SYSTEMD_TEMPLATES/${SVC_NAME}.service"
        DEST="$SYSTEMD_DEST/${SVC_NAME}.service"
        if [ ! -f "$TEMPLATE" ]; then
          warn "  Template not found: $TEMPLATE"
          continue
        fi
        if command -v envsubst >/dev/null 2>&1; then
          envsubst < "$TEMPLATE" > "$DEST"
        else
          sed \
            -e "s|\${HOME}|$HOME|g" \
            -e "s|\${NODE_BIN}|$NODE_BIN|g" \
            -e "s|\${OPENCLAW_WORKSPACE}|$OPENCLAW_WORKSPACE|g" \
            -e "s|\${OPENCLAW_NATS}|$OPENCLAW_NATS|g" \
            -e "s|\${OPENCLAW_NATS_TOKEN}|$OPENCLAW_NATS_TOKEN|g" \
            -e "s|\${OPENCLAW_NODE_ID}|$OPENCLAW_NODE_ID|g" \
            -e "s|\${OPENCLAW_NODE_ROLE}|$OPENCLAW_NODE_ROLE|g" \
            -e "s|\${OPENCLAW_REPO_DIR}|$OPENCLAW_REPO_DIR|g" \
            -e "s|\${NPM_BIN}|$NPM_BIN|g" \
            -e "s|\${NATS_SERVER_BIN}|$NATS_SERVER_BIN|g" \
            -e "s|\${MESH_LLM_PROVIDER}|$MESH_LLM_PROVIDER|g" \
            -e "s|\${LLM_MODEL}|$LLM_MODEL|g" \
            -e "s|\${LLM_BASE_URL}|$LLM_BASE_URL|g" \
            "$TEMPLATE" > "$DEST"
        fi
        check_rendered "$DEST"
        if [ "$SVC_AUTO" = "true" ] && $ENABLE_SERVICES; then
          systemctl --user enable "${SVC_NAME}.service"
          systemctl --user start "${SVC_NAME}.service"
          info "  Installed + started: $SVC_NAME"
        else
          info "  Installed: $SVC_NAME"
        fi
      fi
      INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
    fi
  done <<< "$SERVICES"

  # Reload systemd if any units were installed
  if [ "$OS" = "linux" ] && [ "$INSTALLED_COUNT" -gt 0 ]; then
    systemctl --user daemon-reload
    # Enable linger so user services survive logout
    loginctl enable-linger "$(whoami)" 2>/dev/null || warn "loginctl enable-linger failed — services may stop on logout"
  fi

  if [ "$RENDER_ERRORS" -gt 0 ]; then
    error "$RENDER_ERRORS unit(s) rendered with live placeholders — aborting (fix the template/render mapping)"
    exit 1
  fi

  info "Services installed: $INSTALLED_COUNT (skipped $SKIPPED_COUNT — wrong role)"
  if ! $ENABLE_SERVICES; then
    info "Services installed but NOT started. Use --enable-services to also start them."
    if [ "$OS" = "linux" ]; then
      info "Or start individually: systemctl --user enable --now <service-name>"
    else
      info "Or load individually: launchctl load ~/Library/LaunchAgents/ai.openclaw.<name>.plist"
    fi
  fi
fi

# ============================================================
# Step 16.5: Desktop Notifications (ledgered, click-through popups)
# ============================================================

step "Step 16.5: Desktop Notifications"

NOTIFY_ICON_SRC="$REPO_DIR/services/notify-icons"
NOTIFY_ICON_DEST="$OPENCLAW_ROOT/share/notify-icons"
run mkdir -p "$NOTIFY_ICON_DEST" "$OPENCLAW_ROOT/notifications" "$OPENCLAW_ROOT/config"
if ls "$NOTIFY_ICON_SRC"/*.png >/dev/null 2>&1; then
  run cp "$NOTIFY_ICON_SRC"/*.png "$NOTIFY_ICON_DEST/"
  info "Notification icons installed → $NOTIFY_ICON_DEST (swap per-kind via config/notify.json)"
else
  warn "No notification icons found at $NOTIFY_ICON_SRC"
fi

NOTIFY_CONFIG="$OPENCLAW_ROOT/config/notify.json"
if [ -f "$NOTIFY_CONFIG" ] && ! $UPDATE_ONLY; then
  info "Notification config already exists, keeping it"
else
  cat > "$NOTIFY_CONFIG" <<'EOF'
{
  "enabled": true,
  "sources": {},
  "icons": {
    "default": "default.png",
    "info": "info.png",
    "success": "success.png",
    "warn": "warn.png",
    "error": "error.png",
    "block": "block.png"
  }
}
EOF
  info "Default notification config written → $NOTIFY_CONFIG"
fi

if $SANDBOX; then
  info "Sandbox: skipping notifier install + app builds"
elif [ "$OS" = "macos" ]; then
  if command -v terminal-notifier >/dev/null 2>&1 || [ -x /opt/homebrew/bin/terminal-notifier ] || [ -x /usr/local/bin/terminal-notifier ]; then
    info "terminal-notifier present — popups click through to their origin"
  elif command -v brew >/dev/null 2>&1; then
    run brew install terminal-notifier || warn "brew install terminal-notifier failed — osascript fallback active (popups not clickable)"
  else
    warn "terminal-notifier missing — osascript fallback fires popups but they are NOT clickable"
    warn "Install later: brew install terminal-notifier"
  fi
  # Branded sender bundle: the banner's LEFT icon is the sending app's icon, so
  # ship our own (claw-badged) copy — lib/notify.mjs prefers it when present.
  if bash "$REPO_DIR/services/notify-icons/build-notifier-app.sh" >/dev/null 2>&1; then
    info "OpenClaw notifier bundle built → ~/.openclaw/share/OpenClawNotifier.app (branded banner icon)"
  else
    warn "Branded notifier bundle not built (terminal-notifier missing?) — stock icon will show"
  fi
elif [ "$OS" = "linux" ]; then
  if ! command -v notify-send >/dev/null 2>&1; then
    run sudo apt-get install -y libnotify-bin xdg-utils || warn "libnotify-bin install failed — popups disabled (events still ledgered)"
  fi
  if command -v notify-send >/dev/null 2>&1; then
    if notify-send --help 2>/dev/null | grep -Eq '^\s*-A[,\s]'; then
      info "notify-send with action support — popups click through to their origin"
    else
      warn "libnotify < 0.7.10 (no -A flag) — popups fire but are NOT clickable"
    fi
    command -v xdg-open >/dev/null 2>&1 || warn "xdg-open missing — install xdg-utils for click-through"
  fi
fi

info "Smoke test: node $REPO_DIR/bin/openclaw-notify.mjs --test"
info "Ledger (every event, clicked or not): ~/.openclaw/notifications/ledger.jsonl · UI: Mission Control /notifications"

# One-click stack launcher: a claw-icon app/desktop entry that runs
# `openclaw-stack up` (starts every installed unit + companion-bridge, probes,
# reports via ledgered notification).
if $SANDBOX; then
  : # sandbox — no launcher build
elif [ "$OS" = "macos" ]; then
  if bash "$REPO_DIR/services/launcher/build-launcher-app.sh" >/dev/null 2>&1; then
    info "Stack launcher built → ~/Applications/OpenClaw Stack.app (double-click or Dock it)"
  else
    warn "Stack launcher app not built — start manually: node $REPO_DIR/bin/openclaw-stack.mjs up"
  fi
elif [ "$OS" = "linux" ]; then
  DESKTOP_DIR="$HOME/.local/share/applications"
  run mkdir -p "$DESKTOP_DIR"
  if command -v envsubst >/dev/null 2>&1; then
    NODE_BIN="$NODE_BIN" OPENCLAW_REPO_DIR="$REPO_DIR" HOME="$HOME" \
      envsubst < "$REPO_DIR/services/launcher/openclaw-stack.desktop" > "$DESKTOP_DIR/openclaw-stack.desktop"
  else
    sed -e "s|\${NODE_BIN}|$NODE_BIN|g" -e "s|\${OPENCLAW_REPO_DIR}|$REPO_DIR|g" -e "s|\${HOME}|$HOME|g" \
      "$REPO_DIR/services/launcher/openclaw-stack.desktop" > "$DESKTOP_DIR/openclaw-stack.desktop"
  fi
  chmod +x "$DESKTOP_DIR/openclaw-stack.desktop"
  info "Stack launcher installed → $DESKTOP_DIR/openclaw-stack.desktop (app menu: OpenClaw Stack)"
fi

# ============================================================
# Step 17: Mesh Network (optional — if Tailscale detected)
# ============================================================

step "Step 17: Mesh Network"

if $SKIP_MESH; then
  info "Skipped (--skip-mesh flag set by meta-installer)"
  MESH_AVAILABLE=false
else

MESH_AVAILABLE=false
if command -v tailscale >/dev/null 2>&1; then
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
  if [ -n "$TS_IP" ]; then
    info "Tailscale connected: $TS_IP"
    MESH_AVAILABLE=true
  else
    warn "Tailscale installed but not connected — skipping mesh setup"
    warn "Connect Tailscale and re-run with --update to enable mesh"
  fi
else
  info "Tailscale not found — single-node mode (mesh features disabled)"
  info "Install Tailscale + run again to enable multi-node mesh"
fi

if $MESH_AVAILABLE; then
  # Check if mesh is already deployed
  if [ -x "$HOME/openclaw/bin/mesh" ] || command -v mesh >/dev/null 2>&1; then
    info "Mesh CLI already installed"
    # Update the mesh skill in the managed skills dir
    if [ -f "$REPO_DIR/skills/mesh/SKILL.md" ]; then
      run mkdir -p "$HOME/.openclaw/skills/mesh"
      run cp "$REPO_DIR/skills/mesh/SKILL.md" "$HOME/.openclaw/skills/mesh/SKILL.md"
      info "Mesh skill updated in ~/.openclaw/skills/mesh/"
    fi
  else
    info "Setting up mesh network (NATS, agent, shared folder, health/repair)..."
    if command -v npx >/dev/null 2>&1; then
      # npx openclaw-mesh handles sudo internally
      run npx openclaw-mesh 2>&1 || warn "Mesh setup had issues — run 'npx openclaw-mesh' manually to debug"
    else
      warn "npx not found — install mesh manually: npx openclaw-mesh"
    fi
  fi

  # Install mesh skill to managed location (tier 2: visible to all agents)
  if [ -f "$REPO_DIR/skills/mesh/SKILL.md" ]; then
    run mkdir -p "$HOME/.openclaw/skills/mesh"
    run cp "$REPO_DIR/skills/mesh/SKILL.md" "$HOME/.openclaw/skills/mesh/SKILL.md"
    info "Mesh skill installed to ~/.openclaw/skills/mesh/ (all agents)"
  fi
fi

fi  # end SKIP_MESH else block

# ============================================================
# Step 18: Path-Scoped Rules
# ============================================================

step "Step 18: Path-Scoped Rules"

RULES_DIR="${OPENCLAW_ROOT}/rules"
mkdir -p "$RULES_DIR"

# install_rule — version-aware rule deployment.
# Fresh install: copy. Update: compare versions. If source is newer and local
# was modified (hash mismatch), save as .new instead of overwriting.
install_rule() {
  local src="$1" dst="$2" name="$3"
  if [ ! -f "$src" ]; then return; fi

  if [ ! -f "$dst" ]; then
    cp "$src" "$dst"
    info "Installed rule: ${name}"
    return
  fi

  # Both exist — compare version fields
  local src_ver dst_ver
  src_ver=$(grep -m1 '^version:' "$src" 2>/dev/null | sed 's/version:[[:space:]]*//' || echo "0.0.0")
  dst_ver=$(grep -m1 '^version:' "$dst" 2>/dev/null | sed 's/version:[[:space:]]*//' || echo "0.0.0")

  if [ "$src_ver" = "$dst_ver" ]; then
    return  # Same version, nothing to do
  fi

  # Different versions — check if user modified the local copy
  local src_hash dst_hash
  if command -v md5sum &>/dev/null; then
    src_hash=$(md5sum "$src" | cut -d' ' -f1)
    dst_hash=$(md5sum "$dst" | cut -d' ' -f1)
  elif command -v md5 &>/dev/null; then
    src_hash=$(md5 -q "$src")
    dst_hash=$(md5 -q "$dst")
  else
    # Can't compare hashes — save as .new to be safe
    cp "$src" "${dst}.new"
    warn "Rule ${name}: new version ${src_ver} available (saved as ${name}.new)"
    return
  fi

  if [ "$src_hash" = "$dst_hash" ]; then
    # Same content despite different version — just update
    cp "$src" "$dst"
    info "Updated rule: ${name} (${dst_ver} → ${src_ver})"
  else
    # User-modified — don't overwrite, save as .new
    cp "$src" "${dst}.new"
    warn "Rule ${name}: new version ${src_ver} available but local copy modified. Saved as ${name}.new for manual merge."
  fi
}

# Copy universal rules (always)
for rule in security test-standards design-docs git-hygiene; do
  install_rule "${REPO_DIR}/config/rules/universal/${rule}.md" "${RULES_DIR}/${rule}.md" "${rule}.md"
done

# Detect frameworks and install matching rules
if [ -f "package.json" ] || [ -f "${WORKSPACE}/../../package.json" ]; then
  PKG_FILE="package.json"
  [ ! -f "$PKG_FILE" ] && PKG_FILE="${WORKSPACE}/../../package.json"

  if [ -f "$PKG_FILE" ]; then
    # Solidity detection
    if grep -q '"hardhat"' "$PKG_FILE" 2>/dev/null || [ -f "hardhat.config.js" ] || [ -f "hardhat.config.ts" ] || [ -f "foundry.toml" ]; then
      install_rule "${REPO_DIR}/config/rules/framework/solidity.md" "${RULES_DIR}/solidity.md" "solidity.md"
      [ ! -f "${RULES_DIR}/solidity.md.new" ] || true  # install_rule handles logging
    fi

    # TypeScript detection
    if [ -f "tsconfig.json" ] || [ -f "${WORKSPACE}/../../tsconfig.json" ]; then
      install_rule "${REPO_DIR}/config/rules/framework/typescript.md" "${RULES_DIR}/typescript.md" "typescript.md"
    fi

    # Unity detection
    if [ -d "ProjectSettings" ] || [ -d "Assets" ]; then
      install_rule "${REPO_DIR}/config/rules/framework/unity.md" "${RULES_DIR}/unity.md" "unity.md"
    fi
  fi
fi

info "Rules directory: ${RULES_DIR} ($(ls -1 "$RULES_DIR" 2>/dev/null | wc -l | tr -d ' ') rules)"

# ============================================================
# Step 19: Plan Templates
# ============================================================

step "Step 19: Plan Templates"

TEMPLATES_DIR="${OPENCLAW_ROOT}/plan-templates"
mkdir -p "$TEMPLATES_DIR"

for tmpl in team-feature team-bugfix team-deploy; do
  TMPL_SRC="${REPO_DIR}/config/plan-templates/${tmpl}.yaml"
  TMPL_DST="${TEMPLATES_DIR}/${tmpl}.yaml"
  if [ -f "$TMPL_SRC" ] && [ ! -f "$TMPL_DST" ]; then
    cp "$TMPL_SRC" "$TMPL_DST"
    info "Installed plan template: ${tmpl}.yaml"
  fi
done

info "Templates directory: ${TEMPLATES_DIR}"

# ============================================================
# Step 20: Claude Code Integration
# ============================================================

step "Step 20: Claude Code Integration"

# Create .claude directory structure (in workspace root)
CLAUDE_DIR="${WORKSPACE}/.claude"
mkdir -p "${CLAUDE_DIR}/hooks"

# Symlink rules directory
RULES_LINK="${CLAUDE_DIR}/rules"
if [ ! -L "$RULES_LINK" ] && [ ! -d "$RULES_LINK" ]; then
  ln -s "${RULES_DIR}" "$RULES_LINK"
  info "Symlinked .claude/rules → ${RULES_DIR}"
fi

# Deploy settings.json — merge hooks into existing if present, never overwrite permissions
SETTINGS_SRC="${REPO_DIR}/config/claude-settings.json"
SETTINGS_DST="${CLAUDE_DIR}/settings.json"
if [ -f "$SETTINGS_SRC" ]; then
  if [ ! -f "$SETTINGS_DST" ]; then
    # Fresh install — copy wholesale
    cp "$SETTINGS_SRC" "$SETTINGS_DST"
    info "Deployed Claude Code settings.json"
  elif command -v jq &>/dev/null; then
    # Existing settings — merge hooks only, preserve user permissions
    # Strategy: for each hook lifecycle key (SessionStart, PreToolUse, etc.),
    # append our hook entries if they don't already exist (matched by command string)
    MERGED=$(jq -s '
      .[0] as $existing | .[1] as $new |
      $existing * {
        hooks: (
          ($new.hooks // {}) | to_entries | reduce .[] as $entry (
            ($existing.hooks // {});
            .[$entry.key] as $current |
            if $current == null then
              . + {($entry.key): $entry.value}
            else
              # Append hook entries whose command is not already present
              ($current | map(.hooks) | flatten | map(.command)) as $existing_cmds |
              ($entry.value | map(
                .hooks |= [.[] | select(.command as $cmd | $existing_cmds | index($cmd) | not)]
                | select(.hooks | length > 0)
              )) as $new_entries |
              if ($new_entries | length) > 0 then
                . + {($entry.key): ($current + $new_entries)}
              else .
              end
            end
          )
        )
      }
    ' "$SETTINGS_DST" "$SETTINGS_SRC")
    echo "$MERGED" > "$SETTINGS_DST"
    info "Merged OpenClaw hooks into existing settings.json (permissions preserved)"
  else
    # No jq — can't safely merge. Dump patch file for manual merge.
    cp "$SETTINGS_SRC" "${SETTINGS_DST}.openclaw-hooks"
    warn "jq not found — hooks config saved to settings.json.openclaw-hooks for manual merge"
  fi
fi

# Deploy hook scripts
for hook in session-start validate-commit validate-push pre-compact session-stop log-agent; do
  HOOK_SRC="${REPO_DIR}/.claude/hooks/${hook}.sh"
  HOOK_DST="${CLAUDE_DIR}/hooks/${hook}.sh"
  if [ -f "$HOOK_SRC" ]; then
    cp "$HOOK_SRC" "$HOOK_DST"
    chmod +x "$HOOK_DST"
  fi
done
info "Deployed Claude Code hooks"

# Deploy git hooks (LLM-agnostic enforcement)
if [ -d ".git/hooks" ] || [ -d "${WORKSPACE}/../../.git/hooks" ]; then
  GIT_HOOKS_DIR=".git/hooks"
  [ ! -d "$GIT_HOOKS_DIR" ] && GIT_HOOKS_DIR="${WORKSPACE}/../../.git/hooks"

  for ghook in pre-commit pre-push; do
    GHOOK_SRC="${REPO_DIR}/config/git-hooks/${ghook}"
    GHOOK_DST="${GIT_HOOKS_DIR}/${ghook}"
    if [ -f "$GHOOK_SRC" ] && [ ! -f "$GHOOK_DST" ]; then
      cp "$GHOOK_SRC" "$GHOOK_DST"
      chmod +x "$GHOOK_DST"
      info "Installed git hook: ${ghook}"
    fi
  done
fi

# ============================================================
# Step 21: Acceptance Gate — the node proves itself or the install fails
# ============================================================

step "Step 21: Acceptance Gate"

GATE_STATE="skipped"
if $DRY_RUN; then
  info "[dry-run] would run node-acceptance.mjs against the started services"
elif $SKIP_VERIFY; then
  warn "Skipped (--skip-verify) — the node is UNVERIFIED. Run it yourself:"
  warn "  $NODE_BIN $WORKSPACE/bin/node-acceptance.mjs"
elif $ENABLE_SERVICES; then
  info "Letting services settle (10s)..."
  sleep 10
  set +e
  "$NODE_BIN" "$WORKSPACE/bin/node-acceptance.mjs" --report "$OPENCLAW_ROOT/.install-acceptance.md"
  GATE_RC=$?
  set -e
  if [ "$GATE_RC" -eq 0 ]; then
    GATE_STATE="accepted"
    info "ACCEPTED — the node is functionally running (evidence: $OPENCLAW_ROOT/.install-acceptance.md)"
  else
    error "Acceptance gate FAILED (exit $GATE_RC: 1=REJECTED 2=INCOMPLETE 3=harness error)"
    error "The node is NOT fully operational. Evidence: $OPENCLAW_ROOT/.install-acceptance.md"
    error "Fix the failing axes, then re-run: $NODE_BIN $WORKSPACE/bin/node-acceptance.mjs"
    exit 1
  fi
else
  warn "Services not started (no --enable-services) — a stopped node cannot be verified."
  warn "Finish with: bash $0 --update --enable-services   (ends with this gate)"
fi

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
