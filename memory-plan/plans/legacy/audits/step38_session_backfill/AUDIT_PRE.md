# AUDIT_PRE — Step 6.4: Historical session backfill (bin/extract-existing-sessions.mjs)

**Version:** v6.4-pre
**Date:** 2026-05-23
**Author:** memory-plan-tick

---

## §1 — Intent

Run the LLM extractor (`extractStructured`) over all historical sessions in
`~/.openclaw/state.db`, populating the extraction store (entities, themes,
mentions, decisions), regenerating concept notes in the Obsidian vault, and
refreshing the adjacency cache. This is the final step of Block 6 and provides
the real data that makes spreading activation meaningful on actual queries.

The script follows the same resumable-checkpoint pattern established by
`bin/embed-existing-sessions.mjs` (Step 2.3). It is designed for long-running
background execution (19-37 hours at Qwen3-8B speed on 225 sessions).

---

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 6 | 6.4 | v6.4 | [A] | Historical session backfill (bin/extract-existing-sessions.mjs) |

(Note: Step 6.4 was added by operator decision in Block 6 frozen decisions but
its INVENTORY.md row was not previously created. This tick adds the row.)

---

## §3 — Design decisions (consumed from AUDIT_POST §6 of Step 6.3)

- Test baseline is 772 tests (695 pass, 77 fail — 73 pre-existing + 4 flaky).
- Step 6.4 is independent of the tuning harness — uses entirely different
  infrastructure (extraction-store, LLM client, Ollama).
- Tuning harness results will be meaningful only after this step populates the
  extraction store and concept graph with real data from historical sessions.

From Block 3 carry-forward (RESUME §0):
- LLM extraction timeout on large sessions (557/340/336 messages). Mitigation:
  reduce extraction tail from 40 to 20 messages. This is the recommended approach
  since 40 turns produces redundant content beyond ~20-turn window in practice.

---

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Ollama not running → script fails silently | LOW | Health check at startup; exit with clear message if LLM unavailable |
| 2 | Large session causes extraction timeout | LOW | Use 20-message tail (carry-forward from Block 3); per-session try/catch with skip-on-failure |
| 3 | Checkpoint corruption | LOW | Same proven pattern as embed-existing-sessions (JSON, per-session save) |
| 4 | Session-store schema different from expected | LOW | Same query pattern as embed-existing-sessions (already proven against real state.db) |

No HIGH-severity risks.

---

## §5 — Deferrals

- Streaming extraction for partial JSON parsing — deferred indefinitely (checkpoint-based resumability is sufficient).
- Concept note LLM body generation during backfill — optional (controlled by `--skip-notes` flag); can be run separately later.
- Graph cache daemon start — the script does a one-time refresh, not a daemon start.

---

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `bin/extract-existing-sessions.mjs` | new | Main backfill script. Exports: `DEFAULT_SESSION_DB`, `DEFAULT_EXTRACTION_DB`, `DEFAULT_CHECKPOINT`, `DEFAULT_TAIL_COUNT`, `loadCheckpoint`, `saveCheckpoint`, `runExtraction`. Opens session-store read-only, iterates sessions, forms 20-message tail per session, calls `extractStructured(client, tail)`, stores via `storeExtractionResult(sessionId, result)`. Checkpoint file at `~/.openclaw/.extract-migration-checkpoint.json` tracks completed session IDs. SIGINT handler for graceful shutdown. Post-extraction: optionally regenerates concept notes (`generateConceptNotes`) and refreshes graph cache (`createGraphCache().refreshCache()`). CLI entry with `--session-db`, `--extraction-db`, `--checkpoint`, `--tail`, `--skip-notes`, `--skip-graph` flags. |
| 2 | `test/extract-existing-sessions.test.mjs` | new | ~7 tests: runExtraction with mock LLM client (2 sessions), checkpoint resumability (skips completed), empty session store, zero-message session skip, LLM failure per-session skip (does not abort), extraction result stored correctly, post-extraction hooks skipped when flagged. |
