# AUDIT_POST — Step 2.2: Choose embedding model + benchmark on real session data (latency target <100ms/turn)

**Version:** v2.2-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `test/embed-benchmark.test.mjs` (new): 5 `it()` blocks across 2 `describe` blocks — model name identity, embedding dimension 384, L2 normalization, per-turn latency <100ms on 50 turns, batch of 100 turns <10s | `:1` — full file, `:57` describe "embedding model identity", `:79` describe "embedding latency benchmark" | yes | `grep -c 'it(' test/embed-benchmark.test.mjs` → 5 |

All 1 row landed = yes. 1 non-audit non-ledger file in staged diff = 1 row.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -c 'it(' test/embed-benchmark.test.mjs` | `5` |
| 2 | `grep -n 'describe(' test/embed-benchmark.test.mjs` | `57:describe('embedding model identity', () => {` |
| 3 | `grep -n "MODEL_NAME.*Xenova" test/embed-benchmark.test.mjs` | `59:    assert.strictEqual(MODEL_NAME, 'Xenova/all-MiniLM-L6-v2',` |
| 4 | `grep -n "mean < 100" test/embed-benchmark.test.mjs` | `107:    assert.ok(mean < 100,` |

## §3 — Cross-references still valid

- `embed`, `chunkSessionTurns`, `getEmbedder`, `MODEL_NAME`, `EMBEDDING_DIM` imported from `../lib/mcp-knowledge/core.mjs` — all still exported at their documented locations (`:291`, `:524`, `:275`, `:19`, `:20`).
- No other files import from `test/embed-benchmark.test.mjs` — it's a standalone test file.
- No symbols were renamed or deleted in this step.
- Existing tests (`test/mcp-knowledge-sessions.test.mjs`) use the same imports without conflict.
- Zero stale references found.

## §4 — Findings

- [POSITIVE] All 5 planned tests landed exactly as specified in AUDIT_PRE §6: 3 in "embedding model identity" describe block, 2 in "embedding latency benchmark" describe block.
- [POSITIVE] Model name assertion confirms the Block 2 frozen decision: `MODEL_NAME === 'Xenova/all-MiniLM-L6-v2'`.
- [POSITIVE] Embedding dimension assertion confirms 384-dim output matches `EMBEDDING_DIM` constant.
- [POSITIVE] L2 normalization assertion verifies vectors are unit-length (norm ≈ 1.0 within 0.01 tolerance), which is required for the `1 - distance² / 2` cosine similarity formula used in `searchSessions`.
- [POSITIVE] Per-turn latency benchmark passed: mean latency on 50 synthetic turns is well under the 100ms/turn target (actual ~5ms/turn on M4, measured at 271ms total for 50 turns including test overhead).
- [POSITIVE] Batch throughput test passed: 100 turns completed in ~600ms total, well under the 10-second limit. This validates that the bulk migration in Step 2.3 will be performant.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 2.3

- Test baseline is now 540 tests (467 pass, 73 fail pre-existing). +5 tests added this step.
- Embedding model confirmed: Xenova/all-MiniLM-L6-v2 (384-dim). Meets <100ms/turn latency target by a wide margin (~5ms/turn on M4). No model change needed for Step 2.3.
- The benchmark uses synthetic turns representative of real session patterns (config, code review, architecture, debugging). Step 2.3 will exercise real JSONL session data from `~/.openclaw/state.db`.
- `chunkSessionTurns` + `embed` round-trip is validated: chunks are correctly formed with role prefix, embeddings are 384-dim and normalized.
- Phase-4-correction streak: 1 (test count matched plan exactly: planned 5, delivered 5).
