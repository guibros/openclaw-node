# AUDIT_PRE — Step 5.1: knowledge.db incremental indexing in daemon Phase 2

**Started:** 2026-06-01 · **Version:** v4.9 → v5.1-pre

## §0 Re-orient

- Where am I: Block 5 (L5 retrieval freshness), step 1/3, 29/40 overall.
- Last step changed: 4.9 retired the lossy daily-log writer, closing Block 4 (synthesis/wiki).
- This step contributes: makes Channel 2 (vec) and FTS retrieval fresh — currently stale since May 22 because knowledge.db never auto-indexes.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy layer-3 index) — without fresh embeddings, retrieval returns stale results and injection quality degrades.
- Still the right next step? Yes — Block 5 is next per INVENTORY; 5.1 (indexing) must precede 5.2 (graph-cache) and 5.3 (5-channel verification).

## 1. Intent

Wire incremental session embedding into the daemon's Phase 2 throttled work so that knowledge.db stays fresh without manual CLI runs. After a session is ingested into state.db, the next Phase 2 cycle (≤10 min) picks it up, chunks its turns, embeds them via BGE-M3, and stores them in knowledge.db's `session_documents` / `session_chunks` / `session_chunk_vectors` tables.

## 2. Design

**What already exists:**
- `lib/mcp-knowledge/core.mjs` exports `initDatabase(dbPath)` and `indexSessionTurns(db, sessionId, sourcePath, turns)` — the complete indexing pipeline (chunk + embed + store), idempotent via content hash.
- `bin/embed-existing-sessions.mjs` demonstrates the pattern: read sessions from state.db, form turns arrays, call `indexSessionTurns()`.
- The daemon's Phase 2 already runs session-store import on a 10-min interval; knowledge indexing should follow the same cadence.

**Changes — one file: `workspace-bin/memory-daemon.mjs`:**

1. **Lazy knowledge DB accessor** (same pattern as `getSessionStore()`, `getExtractionStore()`):
   - Import `initDatabase` and `indexSessionTurns` from `../lib/mcp-knowledge/core.mjs`.
   - `getKnowledgeDb()` — lazy-opens `~/.openclaw/workspace/.knowledge.db` via `initDatabase()`. Returns null on failure (native deps missing = graceful degrade, not crash).

2. **Phase 2 job: knowledge indexing** (in Stage 1, every 10 min, co-scheduled with session-import):
   - Add `lastKnowledgeIndex` to throttle state defaults.
   - Query state.db for sessions not yet in knowledge.db: `SELECT s.id, s.source FROM sessions s WHERE s.id NOT IN (SELECT session_id FROM knowledge.session_documents)`. This is a cross-DB query — use the state.db session list and check knowledge.db per-session (or use ATTACH DATABASE).
   - Actually simpler: query knowledge.db for `MAX(last_indexed)` to get the high-water mark, then query state.db for sessions with `start_time` after that. But content-hash idempotency in `indexSessionTurns` handles duplicates anyway, so even a full scan is safe — just inefficient. Better: iterate state.db sessions, check knowledge.db for each session_id, skip if present with same hash.
   - **Simplest correct approach:** use the pattern from `embed-existing-sessions.mjs` — iterate all state.db sessions, call `indexSessionTurns()` which internally skips unchanged sessions (content hash check). Cap at N sessions per tick to avoid blocking.
   - **Batch limit:** 5 sessions per tick (each session can have many chunks; embedding is CPU-bound). This keeps Phase 2 bounded.
   - Log: `Phase 2: knowledge-index: N sessions indexed (M chunks)`.
   - Error: catch, log, emit `emitErrorEvent('knowledge_index', e)`.

3. **No new event schema.** The INVENTORY done-evidence is about max-time freshness, not event emission. Logging is sufficient.

## 3. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| BGE-M3 model not cached on first run | Low (already cached from prior CLI runs) | Blocks indexing until downloaded (~17MB) | `getEmbedder()` throws descriptive error; catch logs it; next tick retries |
| Native dep load failure (sqlite-vec, better-sqlite3 in mcp-knowledge) | Low (already working in inject server) | Knowledge indexing disabled (graceful) | `getKnowledgeDb()` catches, returns null, logs warning; daemon continues |
| Embedding CPU blocks event loop for large sessions | Medium | Other Phase 2 jobs delayed | Batch limit (5 sessions/tick); embedding is sequential within `embedBatch()` but runs in `Promise.allSettled` alongside other jobs |
| state.db concurrent read | Low | SQLite handles concurrent readers | state.db opened readonly for the session query |

## 4. File-delta outline

| File | Change |
|---|---|
| `workspace-bin/memory-daemon.mjs` | +import initDatabase/indexSessionTurns; +getKnowledgeDb() lazy accessor; +lastKnowledgeIndex in throttle defaults; +knowledge indexing job in Phase 2 Stage 1 |
