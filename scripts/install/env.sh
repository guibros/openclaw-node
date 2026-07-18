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
# Claude encodes a project path by replacing / and . with - INCLUDING the leading
# slash: /Users/x/repo → -Users-x-repo (leading dash kept). An earlier version
# stripped the leading / first, so every rendered source path matched nothing on
# disk and _detectActivity silently skipped them — memory ingest ran dark for 39h
# after the 2026-07-14 re-render (memory_ingest_remediation audit).
claude_project_path() {
  echo "$1" | sed 's|[/.]|-|g'
}
export CLAUDE_PROJECT_WORKSPACE="$(claude_project_path "$WORKSPACE")"
export CLAUDE_PROJECT_HOME="$(claude_project_path "$HOME")"
export CLAUDE_PROJECT_REPO="$(claude_project_path "$REPO_DIR")"

# ── Resolve paths for service templates ──
export OPENCLAW_WORKSPACE="$WORKSPACE"
export OPENCLAW_REPO_DIR="$REPO_DIR"
export NPM_BIN="$(command -v npm 2>/dev/null || echo "$HOME/.openclaw/workspace/.npm-global/bin/npm")"
