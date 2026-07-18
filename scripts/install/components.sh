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

if [ -f "$REPO_DIR/boot/manifest.yaml" ] && [ ! "$REPO_DIR/boot/manifest.yaml" -ef "$WORKSPACE/.boot/manifest.yaml" ]; then
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
# Step 13.5: Agent Frontend — the OpenClaw's mind (D10)
# ============================================================

step "Step 13.5: Agent Frontend"

# The node's agent frontend is agnostic (claude / codex / gemini — whatever
# drives this OpenClaw). The harness runs headless without one, but a node
# with no mind seated is just a body: detect, install the default, guide auth.
if $SKIP_FRONTEND; then
  info "Skipped (--skip-frontend)"
else
  FRONTENDS_FOUND=""
  for fe in claude codex gemini; do
    command -v "$fe" >/dev/null 2>&1 && FRONTENDS_FOUND="$FRONTENDS_FOUND $fe"
  done

  if [ -n "$FRONTENDS_FOUND" ]; then
    info "Agent frontend(s) present:$FRONTENDS_FOUND"
  else
    warn "No agent frontend found (claude/codex/gemini) — the node has no mind seated"
    info "Installing the default frontend: Claude Code (@anthropic-ai/claude-code)..."
    if [ "$OS" = "linux" ]; then
      run sudo npm install -g @anthropic-ai/claude-code || warn "Claude Code install failed — install a frontend manually"
    else
      run npm install -g @anthropic-ai/claude-code || warn "Claude Code install failed — install a frontend manually"
    fi
    command -v claude >/dev/null 2>&1 && FRONTENDS_FOUND=" claude"
  fi

  if echo "$FRONTENDS_FOUND" | grep -q claude; then
    # Auth is human-in-the-loop (OAuth) — install can only detect and guide.
    if $DRY_RUN; then
      info "[dry-run] would check Claude Code auth"
    elif $VERIFY_FRONTEND; then
      info "Verifying Claude Code auth with one small live call..."
      # env -u CLAUDECODE: allow the probe even when install.sh itself runs
      # inside a Claude Code session (the CLI refuses nested sessions otherwise)
      if FRONTEND_PROBE=$(env -u CLAUDECODE claude -p 'Reply with exactly: OK' --output-format text --model haiku 2>&1) && echo "$FRONTEND_PROBE" | grep -q "OK"; then
        info "Mind seated: Claude Code authenticated and answering"
      else
        warn "Claude Code present but NOT authenticated (probe failed)"
        warn "Seat the mind: run 'claude' once interactively to sign in, then: bash $0 --update --verify-frontend"
      fi
    else
      info "Claude Code present. Auth is interactive — on a fresh device, run 'claude' once to sign in."
      info "(Optional live auth check: bash $0 --update --verify-frontend)"
    fi
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
