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
run mkdir -p "${CLAUDE_DIR}/hooks"

# Symlink rules directory
RULES_LINK="${CLAUDE_DIR}/rules"
if [ ! -L "$RULES_LINK" ] && [ ! -d "$RULES_LINK" ]; then
  run ln -s "${RULES_DIR}" "$RULES_LINK"
  info "Symlinked .claude/rules → ${RULES_DIR}"
fi

# Deploy settings.json — merge hooks into existing if present, never overwrite permissions
SETTINGS_SRC="${REPO_DIR}/config/claude-settings.json"
SETTINGS_DST="${CLAUDE_DIR}/settings.json"
if [ -f "$SETTINGS_SRC" ]; then
  if [ ! -f "$SETTINGS_DST" ]; then
    # Fresh install — copy wholesale
    run cp "$SETTINGS_SRC" "$SETTINGS_DST"
    info "Deployed Claude Code settings.json"
  elif $DRY_RUN; then
    echo "  [dry-run] jq-merge OpenClaw hooks into $SETTINGS_DST"
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
    run cp "$SETTINGS_SRC" "${SETTINGS_DST}.openclaw-hooks"
    warn "jq not found — hooks config saved to settings.json.openclaw-hooks for manual merge"
  fi
fi

# Deploy hook scripts
for hook in session-start validate-commit validate-push pre-compact session-stop log-agent; do
  HOOK_SRC="${REPO_DIR}/.claude/hooks/${hook}.sh"
  HOOK_DST="${CLAUDE_DIR}/hooks/${hook}.sh"
  if [ -f "$HOOK_SRC" ]; then
    run cp "$HOOK_SRC" "$HOOK_DST"
    run chmod +x "$HOOK_DST"
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
