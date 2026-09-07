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
  # --skip-llm installs no model on purpose: tell the gate so the LLM axis is
  # N/A (covered) instead of a FAIL that would reject every documented install.
  GATE_ARGS=""
  if $SKIP_LLM; then
    warn "LLM axis skipped (--skip-llm) — the gate will not prove model-backed extraction"
    GATE_ARGS="--skip-axis llm"
  fi
  set +e
  # shellcheck disable=SC2086
  "$NODE_BIN" "$WORKSPACE/bin/node-acceptance.mjs" $GATE_ARGS --report "$OPENCLAW_ROOT/.install-acceptance.md"
  GATE_RC=$?
  set -e
  if [ "$GATE_RC" -eq 0 ]; then
    GATE_STATE="accepted"
    info "ACCEPTED — the node is functionally running (evidence: $OPENCLAW_ROOT/.install-acceptance.md)"
  elif [ "$GATE_RC" -eq 2 ] && $SKIP_LLM; then
    # INCOMPLETE (not REJECTED): nothing FAILED, but a required check could not
    # be observed — on a model-less first wave the memory store is empty, so
    # retrieval has nothing to prove. The install proceeds UNPROVEN on that
    # axis and says so; the second wave (--update --enable-services) re-gates.
    GATE_STATE="incomplete"
    warn "INCOMPLETE — no check failed, but the node is UNPROVEN on the skipped/empty axes (evidence: $OPENCLAW_ROOT/.install-acceptance.md)"
    warn "Pull models, then re-gate: bash $0 --update --enable-services"
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
