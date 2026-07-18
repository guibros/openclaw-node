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

      # F4 (security review 2): the raw redirects below bypassed run()'s dry-run
      # guard — --dry-run was overwriting real LaunchAgents/systemd units.
      if $DRY_RUN; then
        info "  [dry-run] would render $TEMPLATE -> $DEST"
        continue
      fi

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
          -e "s|\${OPENCLAW_DEPLOY_TRUSTED_KEYS}|${OPENCLAW_DEPLOY_TRUSTED_KEYS:-}|g" \
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
          if $DRY_RUN; then
            info "  [dry-run] would render $TEMPLATE -> $DEST"
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
          -e "s|\${OPENCLAW_DEPLOY_TRUSTED_KEYS}|${OPENCLAW_DEPLOY_TRUSTED_KEYS:-}|g" \
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
        if $DRY_RUN; then
          info "  [dry-run] would render $TEMPLATE -> $DEST"
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
          -e "s|\${OPENCLAW_DEPLOY_TRUSTED_KEYS}|${OPENCLAW_DEPLOY_TRUSTED_KEYS:-}|g" \
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
