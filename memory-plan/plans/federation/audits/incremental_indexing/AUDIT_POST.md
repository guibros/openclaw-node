# AUDIT_POST — incremental knowledge-indexing LIVE (operator "1.")

**Closed:** 2026-07-19 ~14:00 EDT. Live before/after on the production DB:
- Grown-session re-index: 21–28 min (~850 chunks, observed twice 07-18) → **6.6 s for a real
  2-turn append** (739→741, `{"indexed":1,"chunks":2}`, turn_count advanced).
- Nothing-new run: **0.35 s** (`{"indexed":0,"chunks":0}`) — was identical-cost to a full pass.

## What shipped
`indexSessionTurns` gains a pure-append fast path: if `turns.length > stored.turn_count` AND
`hash(prefix) === stored.content_hash` (the stored hash covered exactly that prefix), only the
tail turns are chunked (via `chunkSessionTurns(tail, baseIndex)` — new offset param, default
preserves old behavior), embedded, and inserted; session_documents updates in the same
transaction. Any prefix mismatch (edited/rewritten/shrunk history — session-store re-imports can
do this) falls back to the existing full delete+rebuild. Returns gain `mode:
'incremental'|'full'`. Safe because chunking is strictly per-turn (no cross-turn windows), so
appends provably cannot alter earlier chunks.

## Evidence
- test/mcp-knowledge-sessions.test.mjs 10/10 (3 new: append→incremental with exact chunk count +
  pre-existing rows byte-identical by rowid + absolute turn_index on new chunks + old-and-new
  content searchable; mutated-prefix→full rebuild with no orphaned vectors; growth-past-count
  guard asserted dynamically).
- The 17-min first run post-deploy was legitimate: it gave the 1,282-message session 81168613 its
  first-ever index (it was never in session_documents), not a failed increment — verified by
  querying the row afterward.
- No wiring changes: the job and daemon pass full turn arrays as before; workspace lib symlink
  made the fix live without redeploy.

## Expected effect (verify over the next day)
10-min cycles on active sessions drop from ~25 min full-burn to seconds → load spikes, inject
tail latency, embed-benchmark flakes, and extraction-under-load degradation should all subside.
The load-skip in embed-benchmark and the 20s inject probe budget stay as calibrated safety nets.
