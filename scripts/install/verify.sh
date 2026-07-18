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
