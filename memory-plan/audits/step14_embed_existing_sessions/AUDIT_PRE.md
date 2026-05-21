# AUDIT_PRE — Step 2.3: Chunk and embed existing sessions (resumable migration with checkpoint file)

**Version:** v2.3-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Write a standalone migration script (`bin/embed-existing-sessions.mjs`) that reads all sessions
from the session-store SQLite database (`~/.openclaw/state.db`), extracts their messages as
turns, and indexes them into the mcp-knowledge database via the existing `indexSessionTurns()`
infrastructure from Step 2.1. The migration must be resumable via a checkpoint file so it can
survive crashes and be re-run safely.

This step bridges the gap between the episodic session store (FTS5-only) and the semantic
layer (sqlite-vec embeddings in mcp-knowledge). After this migration runs, all existing
sessions will be searchable via `searchSessions()` — the semantic search path built in Step 2.1.

## §2 — Inventory excerpt

```
| 2 | 2.3 | v2.3 | [ ] | Chunk and embed existing sessions (resumable migration with checkpoint file) |
```

## §3 — Design decisions (consume prior AUDIT_POST §6)

**From Step 2.2 AUDIT_POST §6:**
- Test baseline: 540 tests (467 pass, 73 fail pre-existing). +5 tests added in Step 2.2.
- Embedding model confirmed: Xenova/all-MiniLM-L6-v2 (384-dim). Meets <100ms/turn latency
  target by wide margin (~5ms/turn on M4). No model change needed.
- `chunkSessionTurns` + `embed` round-trip validated: chunks correctly formed with role
  prefix, embeddings are 384-dim and normalized.
- Phase-4-correction streak: 1.

**Block 2 frozen decisions (from RESUME.md §0):**
- Extend `lib/mcp-knowledge/core.mjs` — one embedding stack (Xenova/all-MiniLM-L6-v2),
  two data sources (markdown + sessions). No Ollama.
- Session tables: `session_documents`, `session_chunks`, `session_chunk_vectors` — already
  created in Step 2.1.

**REFERENCE_PLAN §2.3 deviation:**
- REFERENCE_PLAN says "Embed the text via Ollama" — overridden by Block 2 frozen decisions.
  We use the existing `indexSessionTurns()` which calls `embedBatch()` using
  `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2). No Ollama involvement.
- REFERENCE_PLAN says "Insert into a new vec_chunks table" — overridden. Step 2.1 already
  created `session_chunks` + `session_chunk_vectors` tables and `indexSessionTurns()` writes
  to them. The migration script reuses this infrastructure directly.

**Architecture:**
- The migration script opens the session-store DB directly via `better-sqlite3` (read-only)
  to query sessions and messages. It does NOT go through the `SessionStore` class (which has
  a private `#db` field and no `getMessages()` method). Direct DB access is appropriate for
  a one-time migration tool.
- The knowledge DB is opened via `initDatabase()` from `lib/mcp-knowledge/core.mjs`, which
  also loads sqlite-vec.
- `indexSessionTurns()` is already idempotent (content-hash check). The checkpoint file is
  an optimization layer on top — it avoids re-scanning sessions that are known-indexed.
- Checkpoint file location: `~/.openclaw/.embed-migration-checkpoint.json`.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Session store DB locked by running daemon | LOW | Open read-only (`{ readonly: true }` flag in better-sqlite3). WAL mode allows concurrent reads. |
| 2 | Large number of sessions causes OOM | LOW | Process sessions one at a time. `indexSessionTurns` embeds in batch per session but sessions are bounded in size. |
| 3 | Knowledge DB path differs from mcp-knowledge server's | LOW | Use same `KNOWLEDGE_DB` / `KNOWLEDGE_ROOT` env vars as core.mjs. Default to `~/.openclaw/workspace/.knowledge.db` if no env var. Script documents expected paths. |
| 4 | Embedding model first-load latency | LOW | First call to `embed()` downloads/caches the model. Documented in script output. Benchmark (Step 2.2) shows warm-up is one-time. |

No HIGH-severity risks.

## §5 — Deferrals

- CLI flags for filtering by source or date range — not needed for the one-time migration.
- Parallel session processing — sequential is sufficient given ~5ms/turn latency.
- Automatic trigger from daemon boot — future work; this is a standalone migration script.

## §6 — Phase 4 implementation outline

| # | File | Action | Detail |
|---|------|--------|--------|
| 1 | `bin/embed-existing-sessions.mjs` | NEW | Migration script. Opens session-store DB (read-only) and knowledge DB. Queries all sessions + messages from session store. For each un-indexed session: forms turns array `[{role, content}]`, calls `indexSessionTurns(db, sessionId, sourcePath, turns)`. Writes/updates checkpoint file after each session. Reports progress to stderr. Handles SIGINT for graceful stop. ~80-120 lines. |
| 2 | `test/embed-existing-sessions.test.mjs` | NEW | 5 tests: (1) migrates 2 sessions from test session store to knowledge DB — verifies session_documents count and chunk counts; (2) second run is idempotent — skips already-indexed sessions; (3) checkpoint file is written and updated with progress; (4) empty session store → zero sessions processed, no error; (5) session with zero messages is skipped gracefully. |

2 new files. 5 new tests. Zero modifications to existing files.
