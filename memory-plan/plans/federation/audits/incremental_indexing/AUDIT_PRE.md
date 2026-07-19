# AUDIT_PRE — incremental knowledge-indexing (operator "1." 2026-07-19)

**Written:** before code. The root-cause load fix behind yesterday's residual noise.

## Problem (measured)
indexSessionTurns is delete-everything + re-embed-everything whenever a session's content hash
changes. An active session changes every few minutes; the indexer wakes every 10; this session is
~850 chunks ≈ 21–28 min of full-CPU embedding PER CYCLE (observed twice). Consequences observed
2026-07-18: load 30+, inject worst-case 19s, one extraction degradation under embed load,
embed-benchmark flakes.

## Why incremental is provably safe here
`chunkSessionTurns` is strictly per-turn (each turn → its own chunk(s), keyed by turn_index; no
cross-turn windowing — read at core.mjs:563). Appending turns cannot alter earlier chunks.
Pure-append is verifiable: stored `content_hash` was computed over ALL turns at last index
(= the current prefix). If `hash(turns[0..stored.turn_count)) === stored.content_hash`, the
prefix is byte-identical and only turns[stored.turn_count..] need chunk+embed+insert.

## Plan
1. `chunkSessionTurns(turns, baseIndex = 0)` — turn_index becomes baseIndex + i (default
   preserves today's behavior).
2. indexSessionTurns paths: (a) full hash equal → skip (today's); (b) turn_count grew AND prefix
   hash proves pure-append → chunk/embed ONLY the new turns, INSERT-only, UPDATE
   session_documents (new full hash + turn_count), return {indexed:true, chunks:N,
   mode:'incremental'}; (c) anything else (prefix mismatch = edited/shrunk history) → today's
   full rebuild, mode:'full'.
3. Tests in test/mcp-knowledge-sessions.test.mjs (census-skipped without embedder, runs on this
   box): append → incremental with exact new-chunk count; earlier chunk rows byte-unchanged
   (rowids + vectors intact); prefix-mutation → full rebuild; search still finds both old and new
   content after an incremental pass.
4. Live verify: standalone job run on the real DB (first pass embeds only the delta since
   yesterday 17:06), then two daemon cycles observed — second cycle completes in seconds, box
   load stays sane, inject stays fast.

## Non-goals
Chunk-level dedup within a turn, re-chunking policy changes, the job/daemon wiring (untouched —
the job already passes full turn arrays).
