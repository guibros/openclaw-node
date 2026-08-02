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
# -ef guard: when the workspace copy is a symlink/same inode as the repo file
# (live-dev setups), macOS cp exits 1 ("are identical") and set -e kills the
# install (observed 2026-07-14 on the VM). Same file = already deployed = skip.
for _wsbin in node-watch.mjs node-acceptance.mjs openclaw-notify.mjs \
              obsidian-graph-cache.mjs observer.mjs consolidation-scheduler.mjs \
              hyperagent.mjs embed-probe.mjs; do
  if [ ! "$REPO_DIR/bin/$_wsbin" -ef "$WORKSPACE/bin/$_wsbin" ]; then
    run cp "$REPO_DIR/bin/$_wsbin" "$WORKSPACE/bin/$_wsbin"
  fi
done
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
link_dependency_tree() {
  local src="$1" dest="$2" pkgdir pkg scoped_dir scoped
  LINKED_COUNT=0
  run mkdir -p "$dest"
  for pkgdir in "$src"/*/; do
    [ -d "$pkgdir" ] || continue
    pkg=$(basename "$pkgdir")
    [ "$pkg" = ".bin" ] && continue
    if [[ "$pkg" == @* ]]; then
      run mkdir -p "$dest/$pkg"
      for scoped_dir in "$pkgdir"*/; do
        [ -d "$scoped_dir" ] || continue
        scoped=$(basename "$scoped_dir")
        if [ ! -e "$dest/$pkg/$scoped" ]; then
          run ln -sfn "$pkgdir$scoped" "$dest/$pkg/$scoped"
          LINKED_COUNT=$((LINKED_COUNT + 1))
        fi
      done
    elif [ ! -e "$dest/$pkg" ]; then
      run ln -sfn "$src/$pkg" "$dest/$pkg"
      LINKED_COUNT=$((LINKED_COUNT + 1))
    fi
  done
}

# The copied daemons and mesh libraries are the root package's runtime code.
# Their parent node_modules trees resolve to this one installed dependency set.
link_dependency_tree "$MESH_NM" "$WS_NM"
info "Shared dependencies symlinked to $WS_NM/ ($LINKED_COUNT new links from $MESH_NM)"

# Mesh daemons and CLI tools → mesh home bin/
MESH_BIN="$OPENCLAW_MESH_HOME/bin"
MESH_LIB="$OPENCLAW_MESH_HOME/lib"
run mkdir -p "$MESH_BIN" "$MESH_LIB"
run rsync -av "$REPO_DIR/bin/" "$MESH_BIN/"
run rsync -av --exclude='node_modules' "$REPO_DIR/lib/" "$MESH_LIB/"
run chmod +x "$MESH_BIN/"*.sh 2>/dev/null || true
info "Mesh daemons installed to $MESH_BIN/ ($(ls -1 "$REPO_DIR/bin/" | wc -l | tr -d ' ') files)"
info "Shared libraries installed to $MESH_LIB/"

MESH_HOME_NM="$OPENCLAW_MESH_HOME/node_modules"
if [ "$MESH_NM" != "$MESH_HOME_NM" ]; then
  link_dependency_tree "$MESH_NM" "$MESH_HOME_NM"
  info "Shared dependencies symlinked to $MESH_HOME_NM/ ($LINKED_COUNT new links from $MESH_NM)"
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
