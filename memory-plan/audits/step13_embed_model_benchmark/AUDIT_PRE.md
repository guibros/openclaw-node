# AUDIT_PRE — Step 2.2: Choose embedding model + benchmark on real session data (latency target <100ms/turn)

**Version:** v2.2-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Confirm the embedding model choice (pre-decided in RESUME.md §0 frozen decisions) and validate it meets the <100ms/turn latency target on representative session data. The model is Xenova/all-MiniLM-L6-v2 (384-dim), already loaded in mcp-knowledge via `@huggingface/transformers`. REFERENCE_PLAN §2.2 calls for installing Ollama + BGE-M3; this is overridden by the Block 2 frozen decision — no Ollama, no BGE-M3, one embedding stack via mcp-knowledge.

The benchmark validates the frozen choice against representative session turn data: synthetic turns modeled on real conversation patterns (NATS configuration, code review, architecture discussion, debugging). The test suite asserts the latency target and validates model output dimensions and normalization.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.2 | v2.2 | [A] | Choose embedding model + benchmark on real session data (latency target <100ms/turn) |

## §3 — Design decisions (carry-forwards from Step 2.1 AUDIT_POST §6)

- Test baseline is now 535 tests (462 pass, 73 fail pre-existing). +7 tests added last step.
- `lib/mcp-knowledge/core.mjs` exports `chunkSessionTurns`, `indexSessionTurns`, `searchSessions` — available for use by benchmark.
- `createKnowledgeEngine` returns `searchSessions` and `indexSessionTurns` methods.
- Session tables (`session_documents`, `session_chunks`, `session_chunk_vectors`) use parallel schema to document tables.
- `chunkSessionTurns` uses simple turn-aligned strategy.
- `lib/mcp-knowledge/server.mjs` was NOT updated to expose session search as MCP tool (intentional).
- Phase-4-correction streak: 0 (reset in Step 2.1 due to test count underestimate).

**Block 2 frozen decisions consumed:**
- Embedding model = Xenova/all-MiniLM-L6-v2 (384-dim). No Ollama, no BGE-M3.
- One embedding stack via mcp-knowledge. No parallel vec table in session-store.
- If Step 2.5 evaluation shows poor quality, upgrade to BGE-M3 can be made in a follow-on step.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Model warm-up (first embed call loads ONNX weights) inflates benchmark timings | LOW | Warm up model before measurement loop; report cold vs warm latency separately |
| 2 | Synthetic turns don't represent real session patterns well | LOW | Use diverse synthetic turns (config, code, architecture, debugging) matching patterns seen in existing test fixtures |
| 3 | CI environment may have different latency than M4 dev machine | LOW | Test asserts generous 100ms/turn threshold; real latency on M4 is expected to be much lower |

## §5 — Deferrals

- Benchmark against real JSONL session files from `~/.openclaw/state.db` deferred — the test uses synthetic turns representative of real patterns. Step 2.3 (bulk migration) will exercise real data.
- Comparison benchmark of alternative models (BGE-M3, nomic-embed-text) deferred to after Step 2.5 evaluation, per frozen decisions.

## §6 — Phase 4 implementation outline

| # | File | Action | Detail |
|---|------|--------|--------|
| 1 | `test/embed-benchmark.test.mjs` | new | 5 `it()` blocks across 2 `describe` blocks: (1) "embedding model identity" — 3 tests: model name matches frozen decision, embedding dimension is 384, output is normalized; (2) "embedding latency benchmark" — 2 tests: per-turn mean latency <100ms after warm-up on 50 synthetic turns, batch of 100 turns completes in <10s. Uses `embed`, `chunkSessionTurns`, `MODEL_NAME`, `EMBEDDING_DIM` from core.mjs. |
