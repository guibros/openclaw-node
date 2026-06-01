# AUDIT_PRE — Step 5.3: Verify all 5 retrieval channels return for a known-good query (integration checkpoint)

**Version:** v5.2 → v5.3 · **Date:** 2026-06-01

## &sect;0 Re-orient

- Where am I: Block 5 (L5 retrieval freshness), step 3/3, 30/36 overall.
- Last step changed: 5.2 — graph-cache refresh wired into daemon Phase 2 maintenance; `last_refresh_at` fresh; channel 5 `queryNeighbors` returns non-empty.
- This step contributes: confirms ALL 5 retrieval channels produce non-empty results end-to-end through the inject server; the integration checkpoint that closes Block 5.
- Block serves the north star via: DESIGN_INPUTS &sect;1 Karpathy wiki layer-3 (index/navigation). Without working retrieval, synthesis/injection are blind.
- Still the right next step? Yes.

## 1. Intent

Verify the full injection pipeline end-to-end: a POST to `:7893/memory/inject` with a known-good query returns non-empty hits from all 5 channels (FTS, vec, entity, theme, spreading-activation).

## 2. Design / prior carry-forwards

**Carry-forward from 5.2 AUDIT_POST &sect;3:** Ollama must be warm or the inject path degrades to embedding-fallback. Channel 5 (spreading activation) was verified directly via `queryNeighbors` API; the full inject-server path hit an Ollama timeout. Step 5.3 must test through the inject server itself.

**Finding 1 (primary — all channels inert):** ALL channels return 0 results for every query. Root cause: the daemon starts the inject server WITHOUT passing `knowledgeDb` or `graphCache`. The inject server's `resolveDeps` fallback tries to resolve `DB_PATH` from `mcp-knowledge/core.mjs`, which uses `process.cwd()` — for a launchd daemon, `process.cwd()` is `/`, so `DB_PATH = '/.knowledge.db'`, which doesn't exist. Result: `knowledgeDb = null`, and ALL 5 channels are gated on `if (knowledgeDb)` → all skipped. Similarly, `graphCache` falls through to its own fallback, which may also fail to resolve.

The daemon already has `getKnowledgeDb()` (line 113, resolved with explicit `path.join(HOME, '.openclaw/workspace/.knowledge.db')`) and `getGraphCache()` (line 128). It just never passes them to `startInjectionServer`.

**Finding 2 (secondary — would also block results):** The extraction store's privacy migration sets `private = 1` (default-private) on all entities (line 150 of `extraction-store.mjs`). The retrieval pipeline's `filterPrivateResults` drops ALL chunks from sessions that have any private entity mention. Since every entity is private, every result is dropped. The inject server is loopback-only (127.0.0.1) — filtering the operator's own data from themselves has no purpose in local-first mode (D4: federation dormant).

## 3. Fix design

**Two changes:**

1. **`workspace-bin/memory-daemon.mjs` (line 1447):** Pass `knowledgeDb: getKnowledgeDb()` and `graphCache: getGraphCache()` to `startInjectionServer()`. This gives the inject server the daemon's correctly-resolved DB handles instead of relying on the broken `process.cwd()` fallback.

2. **`lib/memory-inject-server.mjs` (POST handler, retrieveOpts):** Add `respectPrivacy: false`. The inject server is inherently local (loopback-bound). Privacy filtering is designed for federation; locally it blocks all retrieval results. Does NOT change the privacy infrastructure itself.

## 4. Risk register

| Risk | Mitigation |
|------|------------|
| Inject server shares daemon's DB handle (concurrency) | `knowledgeDb` is opened `readonly: true`; SQLite WAL handles concurrent readers. No mutation risk. |
| Privacy fix too broad | Only the inject server changes; the privacy API in retrieval-pipeline and extraction-store remain intact for future federation use |
| Tests break | Tests run against library APIs, not the daemon → inject server init path |

## 5. File-delta outline

| File | Change |
|------|--------|
| `workspace-bin/memory-daemon.mjs` | Pass `knowledgeDb` and `graphCache` from daemon getters to `startInjectionServer()` |
| `lib/memory-inject-server.mjs` | Add `respectPrivacy: false` to `retrieveOpts` in the POST handler |
