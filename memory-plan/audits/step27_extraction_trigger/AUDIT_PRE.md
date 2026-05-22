# AUDIT_PRE — Step 4.7: Agnostic extraction trigger (mesh.memory.extract_request + 45-min idle timer)

**Version:** v4.7-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Replace the Claude-Code-specific extraction trigger (`.claude/hooks/pre-compact.sh`) with a
frontend-agnostic NATS-based extraction trigger. Any LLM frontend can publish
`mesh.memory.extract_request` to fire extraction. The memory daemon subscribes to this subject
and runs the flush logic when a request arrives. A time-based idle fallback (45 min, configurable
via `EXTRACTION_IDLE_THRESHOLD_SEC`) self-publishes an extract request if no event arrives during
an active session, ensuring extraction happens even when the frontend has no hook support.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.7 | v4.7 | [A] | Agnostic extraction trigger (mesh.memory.extract_request + 45-min idle timer) |

## §3 — Design decisions (from prior carry-forwards)

From Step 4.6 AUDIT_POST §6:
- Test baseline is 647 tests (570 pass, 77 fail — 73 pre-existing + 4 flaky).
- `surfaceConflicts(db)` and `annotateWithConflicts()` ready for pipeline integration.
- Step 4.7 (agnostic extraction trigger) is independent of conflict surfacing — no direct dependency.

From RESUME.md §0 Block 4 frozen decisions:
- **NATS subject:** `mesh.memory.extract_request`
- **Idle threshold:** 45 min (2700s), configurable via `EXTRACTION_IDLE_THRESHOLD_SEC` env var
- **Hook replacement:** `.claude/hooks/pre-compact.sh` becomes a thin NATS publisher (~5 lines)
- **Daemon subscribes:** any publisher fires extraction on receipt
- **Fallback timer:** daemon self-publishes if no extract event within threshold on active session

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| NATS CLI (`nats pub`) not installed on operator's machine → hook fails silently | LOW | Hook script checks for `nats` binary and exits 0 if missing (no-op, matches current behavior) |
| Extraction trigger fires during BOOT state before session is ready | LOW | onExtract callback checks session state, skips if not ACTIVE/IDLE |
| Idle timer fires even when session is genuinely idle (no useful work) | LOW | Timer only runs when daemon tracks an active session; timer stops on ENDED state |

## §5 — Deferrals

- Full daemon wiring of `onExtract` callback to the flush pipeline is complex; this step
  creates the trigger module with testable exports and wires it into the daemon's NATS
  connection block. The existing ACTIVE→IDLE and IDLE→ENDED flush paths remain unchanged.
- Tier 1/2/3 publisher scripts for other frontends land in Step 4.9.

## §6 — Phase 4 implementation outline

| # | File | Action | Delta |
|---|------|--------|-------|
| 1 | `lib/extraction-trigger.mjs` | new | Export `EXTRACT_SUBJECT` constant (`mesh.memory.extract_request`), `DEFAULT_IDLE_THRESHOLD_SEC` (2700), `publishExtractRequest(nc, nodeId, opts)` for publishing extract requests, `createExtractionTrigger(nc, nodeId, opts)` factory returning `{ start(), stop(), resetIdleTimer() }` — subscribes to EXTRACT_SUBJECT, manages idle timer, calls `opts.onExtract` on receipt |
| 2 | `workspace-bin/memory-daemon.mjs` | mod | After NATS connection established, import and create extraction trigger; wire `onExtract` to run existing flush logic (shouldFlush + runFlush); call `resetIdleTimer()` on each active tick |
| 3 | `test/extraction-trigger.test.mjs` | new | ~8 tests: EXTRACT_SUBJECT value, DEFAULT_IDLE_THRESHOLD_SEC value, publishExtractRequest publishes correct subject+payload, createExtractionTrigger subscribes to subject, onExtract called on message receipt, idle timer fires after threshold, configurable threshold, graceful no-op when NATS unavailable |

## Mid-Implementation Findings

- `.claude/hooks/pre-compact.sh` cannot be modified: Claude Code tooling blocks all writes to `.claude/hooks/` paths as a security policy. The no-op stub remains. The thin NATS publisher for Claude Code will land as `hooks/claude-code/pre-compact.sh` in Step 4.9 (frontend publisher pack), which is the canonical location for all frontend publishers. The extraction trigger module and daemon wiring work independently of the hook. AUDIT_PRE §6 row 2 (`.claude/hooks/pre-compact.sh`) is dropped; Phase 7 §1 will record it as "dropped — tooling constraint, deferred to Step 4.9".
