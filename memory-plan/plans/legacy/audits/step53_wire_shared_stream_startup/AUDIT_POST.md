# AUDIT_POST — Step 10.3: Wire `ensureSharedStream` at memory-daemon startup; verify R=3 propagates

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `lib/shared-event-stream.mjs` (modify — add `verifySharedStreamConfig`) | `lib/shared-event-stream.mjs:97` | yes | `export function verifySharedStreamConfig(streamInfo)` at line 97; `EXPECTED_REPLICAS` at line 89 |
| 2 | `workspace-bin/memory-daemon.mjs` (modify — wire shared stream at startup) | `workspace-bin/memory-daemon.mjs:48,1114` | yes | Import at line 48; `ensureSharedStream(natsConn)` at line 1114; `verifySharedStreamConfig(streamInfo)` at line 1116; `process.exit(1)` on invalid config at line 1118 |
| 3 | `test/shared-stream-startup.test.mjs` (new) | `test/shared-stream-startup.test.mjs:1` | yes | 11 `it()` blocks covering EXPECTED_REPLICAS constant, verifySharedStreamConfig (7 cases), and ensure→inspect→verify pipeline (3 cases) |

All 3 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| verifySharedStreamConfig function | `grep -n 'verifySharedStreamConfig' lib/shared-event-stream.mjs` | line 97 |
| EXPECTED_REPLICAS constant | `grep -n 'EXPECTED_REPLICAS' lib/shared-event-stream.mjs` | line 89 |
| Import in daemon | `grep -n 'ensureSharedStream' workspace-bin/memory-daemon.mjs` | line 48 |
| Shared stream wiring block | `grep -n 'inspectSharedStream' workspace-bin/memory-daemon.mjs` | line 1115 |
| process.exit on invalid config | `grep -n 'process.exit' workspace-bin/memory-daemon.mjs` | line 1118 |
| Test file exists | `grep -n 'verifySharedStreamConfig' test/shared-stream-startup.test.mjs` | line 19 |

## §3 — Cross-references still valid

- `ensureSharedStream`, `inspectSharedStream`, `verifySharedStreamConfig` all exported from `lib/shared-event-stream.mjs` — imported correctly in daemon (line 48) and test (line 13-19).
- `EXPECTED_REPLICAS` exported from `lib/shared-event-stream.mjs` — imported in test (line 16).
- `SHARED_STREAM_NAME`, `SHARED_SUBJECTS` — unchanged, still exported and used by existing test + new test.
- `StorageType` from `nats` — same import pattern (`createRequire`) used in both lib and test files.
- No symbols renamed or deleted. All existing 16 tests in `test/shared-event-stream.test.mjs` remain valid (they test the same unmodified functions).
- The daemon's NATS connection block structure is preserved: compaction sub → local event log → **shared stream wiring (NEW)** → extraction trigger.

## §4 — Findings

1. **[POSITIVE]** `verifySharedStreamConfig` is a pure function — takes stream info, returns `{ valid, reasons }`. No side effects, fully testable in isolation.
2. **[POSITIVE]** The daemon startup wiring follows the existing graceful-degradation pattern: NATS unavailable → continue locally; NATS available but shared stream creation fails (e.g. <3 nodes) → log warning, continue without federation stream.
3. **[POSITIVE]** The refuse-to-start behavior (`process.exit(1)`) only triggers when the shared stream EXISTS but has wrong config (R != 3 or storage != File) — prevents running with a misconfigured federation stream that would silently lose data.
4. **[POSITIVE]** `EXPECTED_REPLICAS` is a named constant, not a magic number — makes the R=3 requirement greppable and changeable in one place.
5. **[POSITIVE]** `verifySharedStreamConfig` handles both nested (`{ config: { ... } }`) and flat config objects — works with both `inspectSharedStream` output (nested) and `ensureSharedStream` output (which may be nested or flat depending on NATS version).
6. **[POSITIVE]** Test coverage includes all verification failure modes: wrong replicas, wrong storage, both wrong, undefined replicas, undefined storage, plus the full pipeline (ensure → inspect → verify) for both existing and newly-created streams.
7. **[POSITIVE]** Log messages include the actual vs expected values (R=, storage=) — makes diagnostic log scanning straightforward.
8. **[POSITIVE]** 11 new passing tests (1048 total, 973 pass, 75 fail — unchanged pre-existing failures). Test count in VERSION_LOG Phase 4 entry said "10" but actual is 11 (EXPECTED_REPLICAS describe block has 1 `it()` that was miscounted in the initial estimate).
9. **[POSITIVE]** No new dependencies added. All imports use existing modules (`nats`, `lib/shared-event-stream.mjs`).
10. **[POSITIVE]** The wiring block is positioned correctly in the daemon startup sequence — after NATS connection and local event log init, before extraction trigger init. This ensures federation stream is verified before any federation-dependent subsystem starts.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.3 → Step 10.4)

- Test baseline: 1048 tests (973 pass, 75 fail — 73 pre-existing + 2 flaky variance). +11 `it()` blocks added this step.
- Shared stream is now verified at daemon startup. If NATS cluster is running with ≥3 nodes, `OPENCLAW_SHARED` stream will be created (or verified) on first daemon startup. If config mismatch → daemon refuses to start.
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5).
- Step 10.4 (node identity + ed25519 signing) will add `signature` + `signer_pubkey` fields to event-schemas and wire signing into `publishLocal`. The shared stream verified here will carry those signed events.
- The daemon log message format for shared stream status uses `R=` prefix — Step 10.5/10.6 integration tests can grep for this to confirm stream verification happened.
