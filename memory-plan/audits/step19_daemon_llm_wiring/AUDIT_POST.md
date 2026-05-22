# AUDIT_POST — Step 3.3: Wire LLM extraction into daemon + new entity/theme/decision/mention tables in SQLite

**Version:** v3.3-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create extraction store: 4 SQLite tables, storeExtractionResult, generateMemoryContent, getExtractionStats | `lib/extraction-store.mjs:28` (createExtractionStore) | yes | `grep -n 'export function createExtractionStore' lib/extraction-store.mjs` → `28` |
| 2 | Add LLM extraction path in runFlush: USE_LLM_EXTRACTION feature flag, accept llmClient + extractionStore, call extractStructured when enabled, fall back to regex when disabled | `lib/pre-compression-flush.mjs:35` (USE_LLM_EXTRACTION), `:379` (useLlm check) | yes | `grep -n 'USE_LLM_EXTRACTION' lib/pre-compression-flush.mjs` → lines 31, 35, 349, 379, 416 |
| 3 | Initialize LLM client + extraction store at daemon startup, pass to runFlush at both flush sites | `workspace-bin/memory-daemon.mjs:45-46` (imports), `:53-72` (getLlmClient/getExtractionStore), `:864-865` + `:904-905` (pass to runFlush) | yes | `grep -n 'getLlmClient\|getExtractionStore' workspace-bin/memory-daemon.mjs` → lines 53, 61, 864, 865, 904, 905 |
| 4 | Tests: 7 planned, 8 delivered | `test/extraction-store.test.mjs` (8 `it()` blocks) | yes | `grep -c 'it(' test/extraction-store.test.mjs` → `8` |

All 4 rows landed = yes. 4 non-audit non-ledger files in staged diff (lib/extraction-store.mjs, lib/pre-compression-flush.mjs, workspace-bin/memory-daemon.mjs, test/extraction-store.test.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function createExtractionStore' lib/extraction-store.mjs` | `28:export function createExtractionStore(opts = {}) {` |
| 2 | `grep -n 'export const USE_LLM_EXTRACTION' lib/pre-compression-flush.mjs` | `35:export const USE_LLM_EXTRACTION = process.env.USE_LLM_EXTRACTION !== 'false';` |
| 3 | `grep -n 'extractStructured' lib/pre-compression-flush.mjs` | `20:import { extractStructured } from './extraction-prompt.mjs';` |
| 4 | `grep -n 'createLlmClient' workspace-bin/memory-daemon.mjs` | `45:import { createLlmClient } from '../lib/llm-client.mjs';` |
| 5 | `grep -n 'createExtractionStore' workspace-bin/memory-daemon.mjs` | `46:import { createExtractionStore } from '../lib/extraction-store.mjs';` |
| 6 | `grep -c 'it(' test/extraction-store.test.mjs` | `8` |

## §3 — Cross-references still valid

- `createExtractionStore` exported from `lib/extraction-store.mjs:28` — imported by `workspace-bin/memory-daemon.mjs:46` and `test/extraction-store.test.mjs:10`. Zero stale references.
- `USE_LLM_EXTRACTION` exported from `lib/pre-compression-flush.mjs:35` — imported by `workspace-bin/memory-daemon.mjs:41` and `test/extraction-store.test.mjs:11`. Pre-existing reference in `bin/llm-benchmark.mjs:51` (string literal in synthetic session text, not an import — benign).
- `extractStructured` imported from `./extraction-prompt.mjs` into `lib/pre-compression-flush.mjs:20`. Already imported by `test/extraction-schema.test.mjs` (prior step). Zero stale references.
- `createLlmClient` imported from `../lib/llm-client.mjs` into `workspace-bin/memory-daemon.mjs:45`. Already imported by `test/llm-benchmark.test.mjs` (Step 3.1). Zero stale references.
- No pre-existing symbols renamed or deleted.
- `runFlush` signature extended with optional `opts.llmClient`, `opts.extractionStore`, `opts.sessionId` — backward compatible (all are optional). Return type extended with `mode` field — callers that don't read `mode` are unaffected.

## §4 — Findings

- [POSITIVE] Feature flag `USE_LLM_EXTRACTION` defaults `true` per Block 3 frozen decisions. The `!== 'false'` check means any truthy value (or unset) activates LLM extraction — safe default with explicit opt-out.
- [POSITIVE] Graceful degradation: when LLM extraction fails, `runFlush` catches the error, logs to stderr, and falls back to the regex path transparently. The daemon never crashes on LLM failure.
- [POSITIVE] The extraction store uses a transaction for `storeExtractionResult` — all entity/theme/mention/decision inserts for a single extraction are atomic.
- [POSITIVE] Entity upsert uses SQLite's `ON CONFLICT(name) DO UPDATE` for idempotent mention_count tracking. Re-extracting the same entities increments count and updates `last_seen`.
- [POSITIVE] `generateMemoryContent` produces a clean, budgeted markdown document with three sections (Active Entities, Recent Decisions, Active Themes) — structurally superior to the flat regex-based bullet list.
- [POSITIVE] The daemon's LLM client and extraction store are initialized lazily (`getLlmClient()` / `getExtractionStore()`) — no startup cost when `USE_LLM_EXTRACTION=false` or when the daemon never reaches a flush call.
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 planned 7 tests, delivered 8 (added table-creation API check and budget-respect test). Phase-4-correction streak resets to 0.

6 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 3.4

- Test baseline is now 578 tests (505 pass, 73 fail pre-existing). +8 tests added this step (planned 7, delivered 8).
- `lib/extraction-store.mjs` exports `createExtractionStore({ dbPath })` returning `{ storeExtractionResult, generateMemoryContent, getExtractionStats, close }`. Tables: `entities`, `themes`, `mentions`, `decisions`.
- `lib/pre-compression-flush.mjs` exports `USE_LLM_EXTRACTION` (feature flag). `runFlush` now accepts optional `opts.llmClient`, `opts.extractionStore`, `opts.sessionId` and returns an additional `mode` field (`'llm'`, `'regex'`, or `'none'`).
- `workspace-bin/memory-daemon.mjs` initializes LLM client + extraction store lazily and passes them to both flush call sites (pre-compression and end-of-session).
- For Step 3.4 validation: run both extractors on 10 sessions, compare MEMORY.md output quality. The regex path can be tested by setting `USE_LLM_EXTRACTION=false`; the LLM path requires a running Ollama server.
- Phase-4-correction streak: 0 (reset — test count underestimate: planned 7, delivered 8).
- Phase-8-patch streak: 8 (Steps 2.1–3.3, zero patches).
