# AUDIT_POST — Step 3.4: Validate LLM vs regex extraction on 10 sessions; document quality delta

**Version:** v3.4-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create validation tool: readSessions, runRegexExtraction, runLlmExtraction, aggregateMetrics, formatComparison, runValidation, CLI entry | `bin/run-block3-validation.mjs:52` (readSessions), `:89` (runRegexExtraction), `:124` (runLlmExtraction), `:164` (aggregateMetrics), `:230` (formatComparison), `:361` (runValidation) | yes | `grep -n 'export function readSessions' bin/run-block3-validation.mjs` → `52` |
| 2 | Tests: ~6 planned, 9 delivered | `test/block3-validation.test.mjs` (9 `it()` blocks) | yes | `grep -c 'it(' test/block3-validation.test.mjs` → `9` |

All 2 rows landed = yes. 2 non-audit non-ledger files in staged diff (bin/run-block3-validation.mjs, test/block3-validation.test.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export function readSessions' bin/run-block3-validation.mjs` | `52:export function readSessions(dbPath, limit = DEFAULT_LIMIT) {` |
| 2 | `grep -n 'export function runRegexExtraction' bin/run-block3-validation.mjs` | `89:export function runRegexExtraction(messages) {` |
| 3 | `grep -n 'export async function runLlmExtraction' bin/run-block3-validation.mjs` | `124:export async function runLlmExtraction(client, messages, sessionId) {` |
| 4 | `grep -n 'export function aggregateMetrics' bin/run-block3-validation.mjs` | `164:export function aggregateMetrics(results) {` |
| 5 | `grep -n 'export function formatComparison' bin/run-block3-validation.mjs` | `230:export function formatComparison(results) {` |
| 6 | `grep -n 'export async function runValidation' bin/run-block3-validation.mjs` | `361:export async function runValidation(opts = {}) {` |
| 7 | `grep -c 'it(' test/block3-validation.test.mjs` | `9` |

## §3 — Cross-references still valid

- `readSessions` exported from `bin/run-block3-validation.mjs:52` — imported by `test/block3-validation.test.mjs:11`. Zero stale references.
- `runRegexExtraction` exported from `bin/run-block3-validation.mjs:89` — imported by `test/block3-validation.test.mjs:12`. Zero stale references.
- `runLlmExtraction` exported from `bin/run-block3-validation.mjs:124` — imported by `test/block3-validation.test.mjs:13`. Zero stale references.
- `aggregateMetrics` exported from `bin/run-block3-validation.mjs:164` — imported by `test/block3-validation.test.mjs:15`. Zero stale references.
- `formatComparison` exported from `bin/run-block3-validation.mjs:230` — imported by `test/block3-validation.test.mjs:14`. Zero stale references.
- `runValidation` exported from `bin/run-block3-validation.mjs:361` — not imported by tests (CLI-only entry point). No stale references.
- Imports from existing modules: `extractFacts`, `mergeFacts` from `lib/pre-compression-flush.mjs`, `extractStructured` from `lib/extraction-prompt.mjs`, `createLlmClient` from `lib/llm-client.mjs`, `createExtractionStore` from `lib/extraction-store.mjs` — all verified as existing exports at their declared lines.
- No pre-existing symbols renamed or deleted.

## §4 — Findings

- [POSITIVE] The validation tool follows the same architectural pattern as `bin/run-gulf1-eval.mjs` (Step 2.5) — CLI tool with exported functions for programmatic use, structured markdown output with manual scoring columns, and go/no-go decision checklist.
- [POSITIVE] LLM extraction uses a temporary in-memory SQLite database (`:memory:`) for each session — ensuring isolation between sessions and no contamination of the live extraction store.
- [POSITIVE] The tool handles LLM unavailability gracefully — runs regex extraction unconditionally, skips LLM extraction with a message if Ollama health check fails, and produces a comparison document with empty LLM columns.
- [POSITIVE] Sessions are read from the same session store schema used by `bin/embed-existing-sessions.mjs`, using the same query pattern (`SELECT id, source, start_time, message_count FROM sessions` + `SELECT role, content FROM messages WHERE session_id = ?`), ensuring compatibility.
- [POSITIVE] The comparison document includes both raw MEMORY.md output (in collapsible `<details>` blocks) and computed metrics, allowing the operator to evaluate both quantitative and qualitative differences.
- [POSITIVE] Per-session manual scoring table with 5 criteria (semantic coherence, signal-to-noise ratio, coverage, actionable information, fragment quality) on a 0-2 scale — consistent with the Gulf 1 evaluation scoring approach.
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 planned ~6 tests, delivered 9 (readSessions got 3 tests instead of 1, aggregateMetrics got 2 instead of 1). Phase-4-correction streak resets to 0.

6 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Block 4

- Test baseline is now 587 tests (514 pass, 73 fail pre-existing). +9 tests added this step (planned ~6, delivered 9).
- `bin/run-block3-validation.mjs` is a standalone CLI tool. Operator must run it against the live session store with a running Ollama server to produce the comparison document. Command: `node bin/run-block3-validation.mjs --session-db ~/.openclaw/state.db --out memory-plan/eval/block-3-validation.md`.
- The operator must review the output, score each session, and write the go/no-go decision in `memory-plan/eval/block-3-validation.md` before Block 4 can begin.
- Phase-4-correction streak: 0 (reset — test count underestimate: planned ~6, delivered 9).
- Phase-8-patch streak: 9 (Steps 2.1–3.4, zero patches).
- **Block 3 is now complete (4/4).** Block-close ceremony is due at Phase 9.
