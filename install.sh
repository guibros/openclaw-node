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

# Install skill-specific dependencies (npm/pip where needed)
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
# Mission Control Environment
WORKSPACE_ROOT=$WORKSPACE
OPENCLAW_HOME=$OPENCLAW_ROOT
DB_PATH=./data/mission-control.db

# TTS (optional — falls back to Edge TTS if missing)
GEMINI_API_KEY=${GOOGLE_API_KEY:-}
MCENV
  info "Created Mission Control .env.local"
fi

# Ensure data directory exists for SQLite
run mkdir -p "$MC_DIR/data"

# ============================================================
# Step 12: ClawVault
# ============================================================

step "Step 12: ClawVault"

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
# Step 13: Initialize Memory
# ============================================================

step "Step 13: Initialize Memory"

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
# Step 14: Install Daemon Service
# ============================================================

step "Step 14: Memory Daemon Service"

if [ -f "$WORKSPACE/bin/install-daemon" ]; then
  info "Installing memory daemon as system service..."
  run bash "$WORKSPACE/bin/install-daemon"
else
  error "install-daemon script not found"
fi

# ============================================================
# Step 15: Lane Watchdog Service (optional — if gateway installed)
# ============================================================

step "Step 15: Lane Watchdog"

WATCHDOG_SCRIPT="$WORKSPACE/bin/lane-watchdog.js"
if [ -f "$WATCHDOG_SCRIPT" ]; then
  # Only install if the openclaw gateway is present (npm global package)
  if command -v openclaw >/dev/null 2>&1 || [ -f "$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist" ] || [ -f "$HOME/.config/systemd/user/openclaw-gateway.service" ]; then
    info "Gateway detected — installing lane watchdog service..."
    WATCHDOG_SERVICE="ai.openclaw.lane-watchdog"

    if [ "$OS" = "macos" ]; then
      WATCHDOG_PLIST="$HOME/Library/LaunchAgents/${WATCHDOG_SERVICE}.plist"
      cat > "$WATCHDOG_PLIST" << WDEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${WATCHDOG_SERVICE}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${NODE_BIN}</string>
      <string>${WATCHDOG_SCRIPT}</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/.openclaw/logs/lane-watchdog.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.openclaw/logs/lane-watchdog.err</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key>
      <string>${HOME}</string>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
  </dict>
</plist>
WDEOF
      launchctl unload "$WATCHDOG_PLIST" 2>/dev/null || true
      launchctl load "$WATCHDOG_PLIST"
      info "Lane watchdog installed: $WATCHDOG_PLIST"

    elif [ "$OS" = "linux" ]; then
      WATCHDOG_UNIT="$SYSTEMD_DIR/openclaw-lane-watchdog.service"
      cat > "$WATCHDOG_UNIT" << WDEOF
[Unit]
Description=OpenClaw Lane Watchdog — Gateway deadlock recovery
After=network.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${WATCHDOG_SCRIPT}
Restart=always
RestartSec=10
Environment=HOME=${HOME}
WorkingDirectory=${WORKSPACE}

[Install]
WantedBy=default.target
WDEOF
      systemctl --user daemon-reload
      systemctl --user enable openclaw-lane-watchdog
      systemctl --user start openclaw-lane-watchdog
      info "Lane watchdog installed: $WATCHDOG_UNIT"
    fi
  else
    info "Gateway not detected — skipping lane watchdog (not needed for standalone nodes)"
  fi
else
  warn "lane-watchdog.js not found in bin/"
fi

# ============================================================
# Step 16: Mesh Network (optional — if Tailscale detected)
# ============================================================

step "Step 16: Mesh Network"

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
  if $MESH_AVAILABLE; then
    echo ""
    echo "  Mesh commands:"
    echo "    mesh status          # online nodes"
    echo "    mesh health --all    # check all nodes"
    echo "    mesh repair --all    # fix broken services"
  fi
else
  echo "Next steps:"
  echo "  1. Edit your env file:  nano $ENV_FILE"
  echo "  2. Re-run config gen:   bash $0 --update"
  echo "  3. Check daemon status: bin/install-daemon --status"
  echo "  4. Start Mission Control: cd $MC_DIR && npm run dev"
fi
echo ""
