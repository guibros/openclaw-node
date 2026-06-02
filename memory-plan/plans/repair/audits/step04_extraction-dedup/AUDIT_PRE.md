# AUDIT_PRE — Step 1.4: Extraction dedup at flush boundaries (R4)

## §0 Re-orient
- Where am I: Block 1, step 4/8, 4/48 overall. Autonomous chain.
- Last step changed: 1.3 — reinforcement credited-evidence (v1.3).
- This step contributes: kills the third mention-count inflator — identical tails re-extracted at every flush boundary (interval / idle / session-end / NATS), each insert duplicating mention rows and burning minutes of LLM time.
- Block serves the north star via: extraction output must be a function of content, not of how many triggers fired.
- Still the right next step? Yes.

## Intent
`runFlush` has no memory of what it already extracted (FINDINGS R4). Fix: per-session content-hash state; unchanged tail → recorded noop, no LLM call, no synthesis re-run.

## Design decisions
- `extraction_state(session_id PK, content_hash, message_count, extracted_at)` in state.db, created lazily in pre-compression-flush (same pattern as 1.3's lazy table) via the store's `.db` handle — the dedup belongs to the flush boundary, not the store API.
- Hash = sha256 over `[role, content]` pairs of the tail (the exact extraction input). Recorded only after a successful `storeExtractionResult` — a failed LLM run leaves no hash, so the next flush retries.
- Skip returns `mode:'llm-dedup'`, `skipped:1`, plus a zero-count `extraction` block → the daemon's existing `result.extraction` emit guard fires a zero-count `memory.extracted` → the watcher classifies it `noop` (the Proof's observable). Synthesis is skipped too: unchanged tables regenerate identical artifacts, and concept notes cost ~10 LLM calls.
- Growth re-extracts the full tail (hash differs); with 1.5's stamp, new mentions reference the new last turn. Delta-input extraction (feeding only new messages) deliberately NOT attempted — bigger semantic change, capture if needed later.

## Risk register
- Two sessions with byte-identical 4-message tails would cross-dedup only within the same session_id (keyed per session) — no cross-session risk.
- The regex fallback path stays undeduped (writes no mentions; harmless).

## File-delta outline
- `lib/pre-compression-flush.mjs`: crypto import, 3 small helpers, dedup gate + hash record in the useLlm branch.
- `test/extraction-store.test.mjs`: unchanged-tail second flush → llm-dedup/0 new mentions; appended message → re-extracts.

## Done-evidence contract (INVENTORY 1.4 Proof)
Two flushes over an unchanged session: second inserts 0 mention rows + watcher records noop/skip; grown session extracts with new-turn mentions. Induction: restart daemon, NATS extract_request twice on the repair-11-verify fixture.
