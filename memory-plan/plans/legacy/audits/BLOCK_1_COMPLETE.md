# Block 1 Complete — Schema & event foundations

**Closed:** 2026-05-21
**Steps:** 4/4 (v1.1 through v1.4)
**Author:** memory-plan-tick

---

## Exit-gate criteria

All four steps closed with passing tests and Deep Review Gate clearance:

| Step | Version | Tests added | Phase 4 corrections | Phase 8 patches |
|------|---------|-------------|---------------------|-----------------|
| 1.1 | v1.1 | 15 | 0 | 1 (.gitignore) |
| 1.2 | v1.2 | 9 | 1 (test count underestimate) | 0 |
| 1.3 | v1.3 | 6 | 0 | 0 |
| 1.4 | v1.4 | 16 | 1 (StorageType.File assertion) | 0 |
| **Total** | — | **46** | **2** | **1** |

Test baseline at block entry: 482 (409 pass, 73 fail pre-existing).
Test baseline at block exit: 528 (455 pass, 73 fail pre-existing).
Net tests added in Block 1: 46.

## Files touched cumulatively in Block 1

### New files
- `packages/event-schemas/` (15 files: package.json, tsconfig.json, src/envelope.ts, src/memory/*.ts ×8, src/memory/index.ts, src/events.ts, src/index.ts)
- `lib/local-event-log.mjs`
- `lib/artifacts.mjs`
- `lib/shared-event-stream.mjs`
- `test/event-schemas.test.mjs`
- `test/local-event-log.test.mjs`
- `test/artifacts.test.mjs`
- `test/shared-event-stream.test.mjs`

### Modified files
- `package.json` (root — added workspaces, pretest script)
- `.gitignore` (added `packages/*/dist/`)
- `lib/memory-budget.mjs` (dual-write wiring)
- `workspace-bin/memory-daemon.mjs` (event log initialization)

### Audit docs
- `memory-plan/audits/step08_event_schemas/`
- `memory-plan/audits/step09_local_event_log/`
- `memory-plan/audits/step10_artifact_store/`
- `memory-plan/audits/step11_shared_jetstream_cluster/`

## Block 1 deliverables summary

1. **Schema package** (`packages/event-schemas`): Zod-based event envelope + 8 memory event payload schemas + discriminated union + JSON Schema generation. Foundation for all event-sourced work.
2. **Local event log** (`lib/local-event-log.mjs`): Per-node JetStream stream (R=1, file-backed) with validated publishing. Dual-write wired into MemoryBudget for session lifecycle events (shadow mode).
3. **Artifact store** (`lib/artifacts.mjs`): Content-addressed store under `~/.openclaw/artifacts/sha256/<2>/<2>/<hash>` with `.meta.json` sidecars. Standalone, no caller wiring yet.
4. **Shared stream config** (`lib/shared-event-stream.mjs`): `OPENCLAW_SHARED` stream definition with R=3, 7 federation subject patterns. Infrastructure preparation only — idle until Block 4.

## Carry-forwards into Block 2

- **Block 2 gate:** Step 2.1 must begin with a written re-scoping decision: extend `lib/mcp-knowledge/` to embed session JSONL turns, or add a parallel embedding stack in session-store. Block 2 cannot start without this decision recorded in `RESUME.md §0` for Block 2.
- Test baseline: 528 tests (455 pass, 73 fail pre-existing).
- `npm install` may still be blocked. No impact on Block 1 deliverables.
- `docs/STATE_FILES.md` should be updated to document `~/.openclaw/artifacts/` and the shared stream.
- `docs/ARCHITECTURE.md` has stale references to `frontend-activity` and `session-fingerprint.json`.
- `lib/artifacts.mjs` has no caller wiring. Peer NATS RPC `artifacts.fetch.<hash>` is Block 4.
- `ensureSharedStream` has no caller wiring. Promoter/subscriber are Block 4.
- `buildMemoryEvent` and `MemoryEventSchema` are available for future event types.
- The `OPENCLAW_SHARED` stream requires ≥3 NATS cluster nodes for R=3. Infrastructure prerequisite.
