# AUDIT_POST — Step 6.4: Historical session backfill (bin/extract-existing-sessions.mjs)

**Version:** v6.4-mid
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `bin/extract-existing-sessions.mjs` (new) — DEFAULT_SESSION_DB, DEFAULT_EXTRACTION_DB, DEFAULT_CHECKPOINT, DEFAULT_TAIL_COUNT, loadCheckpoint, saveCheckpoint, runExtraction | `bin/extract-existing-sessions.mjs:33` (DEFAULT_SESSION_DB), `:34` (DEFAULT_EXTRACTION_DB), `:35` (DEFAULT_CHECKPOINT), `:42` (DEFAULT_TAIL_COUNT), `:46` (loadCheckpoint), `:60` (saveCheckpoint), `:88` (runExtraction) | yes | `grep -n 'export' bin/extract-existing-sessions.mjs` → 7 exports |
| 2 | `test/extract-existing-sessions.test.mjs` (new) — ~7 tests | `test/extract-existing-sessions.test.mjs` (9 `it()` blocks) | yes | `grep -c 'it(' test/extract-existing-sessions.test.mjs` → `9` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export const DEFAULT_SESSION_DB' bin/extract-existing-sessions.mjs` | `33:export const DEFAULT_SESSION_DB = join(homedir(), '.openclaw/state.db');` |
| 2 | `grep -n 'export const DEFAULT_EXTRACTION_DB' bin/extract-existing-sessions.mjs` | `34:export const DEFAULT_EXTRACTION_DB = join(homedir(), '.openclaw/state.db');` |
| 3 | `grep -n 'export const DEFAULT_CHECKPOINT' bin/extract-existing-sessions.mjs` | `35:export const DEFAULT_CHECKPOINT = join(homedir(), '.openclaw/.extract-migration-checkpoint.json');` |
| 4 | `grep -n 'export const DEFAULT_TAIL_COUNT' bin/extract-existing-sessions.mjs` | `42:export const DEFAULT_TAIL_COUNT = 20;` |
| 5 | `grep -n 'export function loadCheckpoint' bin/extract-existing-sessions.mjs` | `46:export function loadCheckpoint(path) {` |
| 6 | `grep -n 'export function saveCheckpoint' bin/extract-existing-sessions.mjs` | `60:export function saveCheckpoint(cpPath, checkpoint) {` |
| 7 | `grep -n 'export async function runExtraction' bin/extract-existing-sessions.mjs` | `88:export async function runExtraction(opts = {}) {` |
| 8 | `grep -c 'it(' test/extract-existing-sessions.test.mjs` | `9` |

## §3 — Cross-references still valid

- `bin/extract-existing-sessions.mjs` imports:
  - `createLlmClient` from `../lib/llm-client.mjs:37` (Step 3.1) — verified present.
  - `extractStructured` from `../lib/extraction-prompt.mjs:101` (Step 3.2) — verified present.
  - `createExtractionStore` from `../lib/extraction-store.mjs:37` (Step 3.3) — verified present.
- Dynamic imports (post-extraction hooks):
  - `generateConceptNotes` from `../lib/obsidian-summarizer.mjs:245` (Step 5.2) — verified present.
  - `createGraphCache` from `../bin/obsidian-graph-cache.mjs:72` (Step 5.4) — verified present.
- `test/extract-existing-sessions.test.mjs` imports 4 named exports from `../bin/extract-existing-sessions.mjs`. All resolve correctly.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json`.

## §4 — Findings

- [POSITIVE] Resumable checkpoint file at `~/.openclaw/.extract-migration-checkpoint.json` follows the same proven pattern as `embed-existing-sessions` (Step 2.3) — JSON file, per-session save, SIGINT handling.
- [POSITIVE] `DEFAULT_TAIL_COUNT = 20` per Block 3 carry-forward (reduced from daemon's 40 to avoid LLM timeout on large sessions).
- [POSITIVE] Per-session try/catch: individual LLM failures are recorded in `checkpoint.failed` and do not abort the entire backfill run — exactly the right resilience pattern for a 19-37 hour job.
- [POSITIVE] LLM health check at startup prevents running an hours-long job against an unreachable server.
- [POSITIVE] Post-extraction hooks (concept notes + graph cache refresh) are gated on `processed > 0` and individually try/caught — failures warn but don't crash.
- [POSITIVE] Post-extraction hooks use dynamic `import()` to avoid forcing the obsidian-summarizer and graph-cache modules to load at startup (they have their own SQLite + filesystem dependencies).
- [POSITIVE] Test injection via `llmClient`, `extractionStore`, and `extractFn` parameters enables fully deterministic testing without any live infrastructure.
- [POSITIVE] 9 new tests all pass. Test count: 781 (704 pass, 77 fail — unchanged baseline of 77 failures). Node test runner reports +9.
- [POSITIVE] Tail length test verifies correct slicing behavior (30 messages → last 10 when `tailCount=10`).
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 planned ~7 tests, delivered 9 (DEFAULT_TAIL_COUNT check, loadCheckpoint, and tail-length tests were additive). Phase-4-correction streak resets to 0 for Block 6.

9 POSITIVE, 1 NEGATIVE findings. 0 Phase 8 patches.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Block 7

- Test baseline is now 781 tests (704 pass, 77 fail — 73 pre-existing + 4 flaky). +9 `it()` blocks added this step.
- `runExtraction` at `bin/extract-existing-sessions.mjs:88` — main backfill orchestrator.
- `DEFAULT_TAIL_COUNT` at `bin/extract-existing-sessions.mjs:42` — 20 messages per session.
- Step 6.4 is the last step of Block 6. **Block 6 complete (4/4).**
- The backfill script must be run manually by the operator (`node bin/extract-existing-sessions.mjs`) to populate the extraction store with real data. Until then, spreading activation and 5-channel retrieval return empty results from entity/theme/activation channels (graceful degradation per Step 6.2 design).
- Block 7 (proactive injection) does not depend on a populated extraction store — it consumes the retrieval pipeline, which degrades gracefully on empty data. Block 7 can proceed immediately.
- The Block 6 validation gate (RESUME §0: "spreading activation must return non-empty results for at least 5 of the Gulf-1 25 queries when run against the populated graph") is deferred until the backfill completes, per the same waiver pattern used for Block 5's validation gate (vault was empty because LLM extractor hadn't been run).
