#!/usr/bin/env bash
# install.sh — OpenClaw Node Installer
# Installs the full OpenClaw infrastructure on Ubuntu (or any Linux with systemd).
# Also works on macOS for fresh installs.
#
# Usage:
#   bash install.sh              # Full install
#   bash install.sh --dry-run    # Show what would happen
#   bash install.sh --update     # Re-copy scripts/configs, skip deps

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

for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=true ;;
    --update)   UPDATE_ONLY=true ;;
    --help|-h)
      echo "Usage: bash install.sh [--dry-run] [--update]"
      echo "  --dry-run   Show what would happen without making changes"
      echo "  --update    Re-copy scripts/configs only (skip system deps)"
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
  else
    "$@"
  fi
}

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
        info "Installing Node.js 20 LTS..."
        run curl -fsSL https://deb.nodesource.com/setup_20.x | run sudo -E bash -
        run sudo apt-get install -y nodejs
      else
        error "Please install Node.js 18+ manually: https://nodejs.org"
        exit 1
      fi
    fi
  else
    warn "Node.js not found"
    if [ "$OS" = "linux" ]; then
      info "Installing Node.js 20 LTS..."
      run curl -fsSL https://deb.nodesource.com/setup_20.x | run sudo -E bash -
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
fi

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

step "Step 3: Install Scripts"

run rsync -av --exclude='*.bak' --exclude='*.bak.*' --exclude='routing-eval-tests.json' \
  "$REPO_DIR/bin/" "$WORKSPACE/bin/"
run chmod +x "$WORKSPACE/bin/"*
run chmod +x "$WORKSPACE/bin/hooks/"* 2>/dev/null || true
info "Scripts installed to $WORKSPACE/bin/"

# ============================================================
# Step 4: Copy Identity Files
# ============================================================

step "Step 4: Identity Files"

for f in CLAUDE.md SOUL.md PRINCIPLES.md AGENTS.md DELEGATION.md HEARTBEAT.md MEMORY_SPEC.md TOOLS.md; do
  if [ -f "$REPO_DIR/identity/$f" ]; then
    run cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f"
    info "Installed $f"
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

run rsync -av "$REPO_DIR/skills/" "$WORKSPACE/skills/"
info "Skills installed to $WORKSPACE/skills/ ($(ls "$REPO_DIR/skills/" | wc -l | tr -d ' ') skills)"

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

# Source env file for config generation
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

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
      -e "s|\${OPENCLAW_NODE_ID}|$OPENCLAW_NODE_ID|g" \
      -e "s|\${OPENCLAW_TIMEZONE}|$OPENCLAW_TIMEZONE|g" \
      -e "s|\${OPENAI_API_KEY}|${OPENAI_API_KEY:-}|g" \
      -e "s|\${GOOGLE_API_KEY}|${GOOGLE_API_KEY:-}|g" \
      -e "s|\${ANTHROPIC_API_KEY}|${ANTHROPIC_API_KEY:-}|g" \
      -e "s|\${DISCORD_BOT_TOKEN}|${DISCORD_BOT_TOKEN:-}|g" \
      -e "s|\${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN:-}|g" \
      -e "s|\${WEB_SEARCH_API_KEY}|${WEB_SEARCH_API_KEY:-}|g" \
      -e "s|\${OBSIDIAN_API_KEY}|${OBSIDIAN_API_KEY:-}|g" \
      "$template" > "$output"
  fi
  info "Generated $basename"
}

generate_config "$REPO_DIR/config/daemon.json.template" "$OPENCLAW_ROOT/config/daemon.json"
generate_config "$REPO_DIR/config/transcript-sources.json.template" "$OPENCLAW_ROOT/config/transcript-sources.json"
generate_config "$REPO_DIR/config/obsidian-sync.json.template" "$OPENCLAW_ROOT/config/obsidian-sync.json"
generate_config "$REPO_DIR/config/openclaw.json.template" "$OPENCLAW_ROOT/openclaw.json"

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
# Step 10: Mission Control
# ============================================================

step "Step 10: Mission Control"

MC_DIR="$WORKSPACE/projects/mission-control"
if [ ! -d "$MC_DIR/src" ]; then
  run mkdir -p "$MC_DIR"
  run rsync -av "$REPO_DIR/mission-control/" "$MC_DIR/"
  info "Mission Control source copied"
else
  info "Mission Control already exists, updating source..."
  run rsync -av --exclude='node_modules' --exclude='.next' --exclude='*.db' \
    "$REPO_DIR/mission-control/" "$MC_DIR/"
fi

if [ ! -d "$MC_DIR/node_modules" ]; then
  info "Installing Mission Control dependencies (this may take a minute)..."
  (cd "$MC_DIR" && run npm install)
else
  info "Mission Control dependencies already installed"
fi

# Create .env.local for MC if not exists
if [ ! -f "$MC_DIR/.env.local" ]; then
  cat > "$MC_DIR/.env.local" << MCENV
WORKSPACE_PATH=$WORKSPACE
DATABASE_URL=file:./mc.db
MCENV
  info "Created Mission Control .env.local"
fi

# ============================================================
# Step 11: ClawVault
# ============================================================

step "Step 11: ClawVault"

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
# Step 12: Initialize Memory
# ============================================================

step "Step 12: Initialize Memory"

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
# Step 13: Install Daemon Service
# ============================================================

step "Step 13: Memory Daemon Service"

if [ -f "$WORKSPACE/bin/install-daemon" ]; then
  info "Installing memory daemon as system service..."
  run bash "$WORKSPACE/bin/install-daemon"
else
  error "install-daemon script not found"
fi

# ============================================================
# Done!
# ============================================================

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Installation Complete!             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
info "Workspace: $WORKSPACE"
info "Config:    $OPENCLAW_ROOT/config/"
info "Env file:  $ENV_FILE"
echo ""

if [ "$OS" = "linux" ]; then
  echo "Next steps:"
  echo "  1. Edit your env file:  nano $ENV_FILE"
  echo "  2. Re-run config gen:   bash $0 --update"
  echo "  3. Check daemon status: systemctl --user status openclaw-memory-daemon"
  echo "  4. Start Mission Control: cd $MC_DIR && npm run dev"
  echo "  5. View MC dashboard:   http://localhost:3000"
else
  echo "Next steps:"
  echo "  1. Edit your env file:  nano $ENV_FILE"
  echo "  2. Re-run config gen:   bash $0 --update"
  echo "  3. Check daemon status: bin/install-daemon --status"
  echo "  4. Start Mission Control: cd $MC_DIR && npm run dev"
fi
echo ""
