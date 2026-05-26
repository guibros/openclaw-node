# OpenClaw Memory Plan — Deep Code Review

**Date:** 2026-05-26
**Reviewers:** 4 parallel general-purpose audit agents
**Scope:** Block 6-10 modules + supporting infrastructure (federation, retrieval/injection, storage/migrations, LLM bridge/queue)
**Methodology:** Each agent read assigned files end-to-end, traced happy/sad/edge/concurrent paths, looked for specific bug classes (security, race conditions, lifecycle, correctness, error propagation, integration). Findings cite `file:line` and ship with suggested fixes.

**Headline:** ~80 findings total. 17 critical (federation auth fully disabled; queue lifecycle deadlock; recall scoring data path broken; privacy filter has bypass paths). The codebase functions in dev/single-node mode but should not be deployed as multi-node until critical clusters are fixed.

The critical bugs cluster into 4 coherent groups, each one PR's worth of work:

- **Cluster A (4 bugs):** Federation runs unsigned — `verifyEvent` returns true on missing signature, `signer_pubkey` is unbound from `node_id`, no replay window. Any peer can impersonate.
- **Cluster B (3 bugs):** Queue lifecycle — `shutdown` deadlocks pending callers, wait-timeout leaks in-flight Ollama calls, `pending` is unbounded.
- **Cluster C (4 bugs):** Recall scoring data-path — `id`/`mention_count`/`salience`/`last_recalled`/`rrf_score` all dropped or misnamed; "biological recall" is theatrically present but mathematically inert.
- **Cluster D (2 bugs):** Privacy filter is leaky — `queryRelevantConcepts/Decisions` bypass private filter entirely; `filterPrivateResults` works at session granularity but retrieval is chunk-grain.

Plus 3 standalone criticals: wrong module name silently disables Channel 5 globally; privacy migration default doesn't apply to existing rows; consolidation archival throws `FOREIGN_KEY` and has never worked (no tests caught it because mentions table was empty).

---

## CRITICAL (17)

### F-C1 — Federation emitter never signs events
**File:** `lib/broadcast-emitter.mjs:202-222`
**Type:** Security / signing
**Description:** `publishBroadcast` builds the event envelope, validates against the Zod schema, publishes — but never calls `signEvent`. Same defect in `broadcast-offerer.mjs:328-354` (offers) and `broadcast-acceptor.mjs:309-346` (accepted events).
**Fix:** Take `identity` as a constructor option, call `signEvent(validated, identity.privateKey)` before publish in all three publishers.

### F-C2 — `verifyEvent` returns true when signature/pubkey missing
**File:** `lib/node-identity.mjs:165-169`
**Type:** Security / auth bypass
**Description:** Early-returns `true` when `signature`/`signer_pubkey` are missing. Combined with receivers' `if (broadcastData.signature)` gate, an attacker simply omits signature to bypass auth.
**Fix:** Add `OPENCLAW_REQUIRE_SIGNED=1` env (default ON for new deployments); make `verifyEvent` return `false` on missing fields when set; receivers always invoke `verifyEvent` unconditionally.

### F-C3 — `signer_pubkey` unbound from `node_id` (impersonation)
**File:** `lib/node-identity.mjs:165-193`
**Type:** Security / impersonation
**Description:** `verifyEvent` reconstructs the pubkey from whatever `signer_pubkey` the event ships with. No check that this matches the node's registered key. Attacker signs with their own key, sets `node_id: "alice-node"`, verification passes. They can suppress alice's offers (spoof self-broadcasts), publish forged offers as alice.
**Fix:** Maintain a `nodeId → trustedPubkey` registry (loaded at startup or grown via signed introductions). Reject when `signer_pubkey` doesn't match registered key.

### F-C4 — No nonce / freshness check (replay attack)
**File:** `lib/node-identity.mjs:165-193`
**Type:** Security / replay
**Description:** Signed payload includes timestamp + event_id, but verify doesn't enforce timestamp recency. No seen-event LRU. Captured signed broadcasts replay indefinitely.
**Fix:** In `verifyEvent`, reject events with timestamp older than 24h or future by >5min. Maintain bounded recent-event-id LRU at receive time.

### F-C5 — Queue `shutdown()` silently abandons pending promises
**File:** `lib/ollama-queue.mjs:312-324`
**Type:** Lifecycle / deadlock
**Description:** `state.pending = []` clears the queue without resolving the pending promises. Every queued `await requestExtraction(...)` hangs forever. Process refuses to exit cleanly on SIGTERM.
**Fix:** Capture `resolve`/`reject` on each pending entry; reject all with "queue shutdown" before clearing.

### F-C6 — Analysis wait-timeout leaks in-flight Ollama call
**File:** `lib/ollama-queue.mjs:182-210` + `lib/llm-client.mjs:202-238`
**Type:** Lifecycle / resource leak
**Description:** When `Promise.race` wait-timeout fires, the actual `runFetch` keeps running. Queue slot held; new analyses get stuck behind the orphan. Counter `consecutiveTimeouts.analysis` ticks despite user already seeing fallback.
**Fix:** Expose AbortController to queue; abort the in-flight fetch when wait-timeout fires.

### F-C7 — `state.pending` unbounded under stuck Ollama
**File:** `lib/ollama-queue.mjs:43-53, 132-151`
**Type:** Lifecycle / memory leak
**Description:** Stuck extraction + multiple subscribers (memory-subscriber, summarizer, backfill, broadcast-offerer routing through `generate`) accumulate pending entries each holding prompt closure → OOM kill.
**Fix:** Add `MAX_PENDING` (e.g. 50). On enqueue, reject with "queue full" if cap exceeded.

### F-C8 — Reconsolidation write-back is a no-op
**File:** `lib/memory-injector.mjs:283-284 + 96-100 + 126-130`
**Type:** Correctness / data path
**Description:** `queryRelevantConcepts/Decisions` don't `SELECT id`. `recalled.entityIds = concepts.map(c => c.id).filter(Boolean) === []`. `writeBackReconsolidation` runs an empty transaction. The "biological forgetting loop" never updates `last_recalled` or bumps salience.
**Fix:** Select `e.id` and `d.id`, propagate through return objects.

### F-C9 — `mention_count` field-name mismatch breaks frequency scoring
**File:** `lib/memory-injector.mjs:215 + 96-99`
**Type:** Correctness / data path
**Description:** `recallScore` reads `item.mention_count`, but query maps to `mentionCount`. `?? 1` fallback hides it. Every concept scores frequency = log1p(1) ≈ 0.693 regardless of actual mention count.
**Fix:** Keep snake_case (matches schema) or rename one side.

### F-C10 — `salience` and `last_recalled` never reach scorer
**File:** `lib/memory-injector.mjs:96-100 + 215-218 + 209`
**Type:** Correctness / data path
**Description:** Query selects `AVG(salience) AS avg_salience` but drops it in row→object map. `last_recalled` never selected. Every concept scores ~0.347 → ties everywhere → curation step is effectively a passthrough.
**Fix:** Select `id, salience, last_recalled, last_seen`; propagate to objects.

### F-C11 — Pipeline RRF score never feeds back into curation
**File:** `lib/memory-injector.mjs:464-468 + 217-218`
**Type:** Correctness / data path
**Description:** `recallScore` looks for `item.rrf_score`, but snippets are `{sessionId, snippet, score}`. `(1 + rrf) = (1 + 0) = 1` for every snippet — 5-channel ranking discarded by curator.
**Fix:** Rename snippet field to `rrf_score` or read `item.score ?? item.rrf_score` in `recallScore`.

### F-C12 — Privacy bypass in injection helpers
**File:** `lib/memory-injector.mjs:86-95`
**Type:** Privacy / security
**Description:** `queryRelevantConcepts` and `queryRelevantDecisions` JOIN entities/decisions with NO `private` filter. `filterPrivateResults` only operates session-grain. These helpers return entity names + decisions directly — they leak private items even when `respect_privacy: true`.
**Fix:** Thread `respectPrivacy` into both helpers; add `AND COALESCE(e.private, 1) = 0` / `AND COALESCE(d.private, 1) = 0`.

### F-C13 — Privacy filter session-grain but retrieval chunk-grain
**File:** `lib/retrieval-pipeline.mjs:489 + 366-409`
**Type:** Privacy / correctness
**Description:** `filterPrivateResults` excludes session if "at least one public entity". But a session whose chunks were retrieved via PRIVATE entity match still leaks the chunk if some other public entity exists. Themes and decisions never filtered. Spreading activation walks private nodes freely. `catch { return results }` at line 184/192 fails OPEN on errors.
**Fix:** Push privacy down to SQL JOIN level (`WHERE e.private = 0`) inside `findMatchingEntities` / `findMatchingThemes` / `entitySearch` / `themeEntitySearch` / `activationSearch`. Fail closed.

### F-C14 — `obsidian-graph-cache.mjs` import path wrong; Channel 5 globally disabled
**File:** `lib/memory-inject-server.mjs:221`
**Type:** Module wiring / silent failure
**Description:** Imports `./obsidian-graph-cache.mjs` (lib/) but the file lives at `bin/obsidian-graph-cache.mjs`. `try/catch` swallows `ERR_MODULE_NOT_FOUND`. Spreading activation permanently disabled when started via this server. No log emitted.
**Fix:** Correct the import path, or move the graph cache to `lib/`, or at minimum log the import failure.

### F-C15 — Privacy migration default doesn't apply to NULL rows
**File:** `lib/extraction-store.mjs:141`
**Type:** Migration safety / privacy
**Description:** `ALTER TABLE ... ADD COLUMN private INTEGER DEFAULT 1` — SQLite default applies on read, but rows inserted with explicit `NULL` are invisible to both `WHERE private = 0` AND `WHERE private = 1` filters.
**Fix:** After ALTER, run `UPDATE <table> SET private = 1 WHERE private IS NULL`. Or change to `NOT NULL DEFAULT 1`.

### F-C16 — Consolidation archival throws FOREIGN_KEY, has never worked
**File:** `lib/consolidation.mjs:84, 92-118`
**Type:** Data integrity / transaction failure
**Description:** `decayWeights` deletes entities below salience threshold. With `foreign_keys = ON`, `DELETE FROM entities` throws `SQLITE_CONSTRAINT_FOREIGNKEY` because mentions reference them. Transaction rolls back. Archival never happens. No error surfaces because no try/catch around the step. Tests passed because mentions table was empty.
**Fix:** Soft-delete (set `archived_at` column) or delete mentions first inside the same transaction.

### F-C17 — Graph edges table has no UNIQUE constraint
**File:** `bin/obsidian-graph-cache.mjs:46-51, 84-86, 114-115`
**Type:** Data integrity
**Description:** `concept_graph_edges` has no PK and no unique index. `insertEdge` is plain INSERT. If `buildGraph` returns duplicates (two wikilinks in same note pointing at `[[X]]`), they accumulate. Downstream weight-aggregating queries double-count.
**Fix:** `CREATE UNIQUE INDEX idx_edges_unique ON concept_graph_edges(source_id, target_id, edge_type);` + switch to `INSERT OR REPLACE`.

---

## HIGH (25)

### F-H1 — `msg.ack()` runs on processing failures
**File:** `lib/broadcast-offerer.mjs:404-411`
**Description:** Inner try/catch swallows errors, then `if (msg.ack) msg.ack()` outside the try. Malformed messages get ack'd and removed from JetStream redelivery queue. DOS via repeated malformed messages.
**Fix:** Only ack on success; nak with backoff on transient processing errors.

### F-H2 — Incoming events not schema-validated
**File:** `lib/broadcast-offerer.mjs:241-364` + `lib/broadcast-acceptor.mjs:182-239`
**Description:** Reads `broadcastData.data?.themes`, etc. without `ContextBroadcastSchema.parse`. Peer publishing `ttl_minutes: -1` or `themes: "not array"` causes unbounded behavior or swallowed TypeError.
**Fix:** Validate at boundary; reject events not matching schema.

### F-H3 — `generateRelevanceSummary` blocks consumer
**File:** `lib/broadcast-offerer.mjs:317-325`
**Description:** Sequential await on 3s LLM calls × 3 artifacts → 9s head-of-line blocking. Single slow message stalls entire consumer.
**Fix:** `Promise.all` over summaries; consider bounded async work queue.

### F-H4 — Pending offers Map race
**File:** `lib/broadcast-acceptor.mjs:226-230`
**Description:** Array `pendingOffers` mutated from subscription handler + concurrent `cleanupExpiredOffers` interval. Reverse-index splice while another tick splices in `checkAcceptance` → index skips.
**Fix:** Replace array with `Map<event_id, offer>`. Key all operations by event_id.

### F-H5 — `acceptedIds` Set unbounded
**File:** `lib/broadcast-acceptor.mjs:160`
**Description:** Every accepted offer's event_id stays forever. Memory leak; cross-restart dedup doesn't work (in-memory only).
**Fix:** LRU cap (e.g. 10,000) or persist to SQLite.

### F-H6 — Privacy filter whole-session, not per-item
**File:** `lib/broadcast-offerer.mjs:160-195`
**Description:** Excludes session if ANY entity private — but a non-private session containing a private mention leaks the chunk. Snippet text not filtered. `catch { return results }` fails OPEN.
**Fix:** Filter at chunk level (mentions on specific chunk_id). Fail closed.

### F-H7 — Theme history polluted by failed publishes
**File:** `lib/broadcast-emitter.mjs:294-298`
**Description:** `recentThemeSets.push(...)` BEFORE publish. Failed/skipped publish still consumes passive-skip budget. After 5 failed attempts, legitimate broadcast gets passive-skipped.
**Fix:** Only push after successful publish.

### F-H8 — Dedup window race between concurrent publishes
**File:** `lib/broadcast-emitter.mjs:168-234`
**Description:** Two concurrent `maybeBroadcast` with same themes both pass `dedupMap.get` check before either calls `dedupMap.set`. Both publish → duplicate event.
**Fix:** Set dedup entry + `lastBroadcastTs` eagerly before any await; roll back on failure. Or serialize through queue.

### F-H9 — FK declared but no CASCADE; orphans possible
**File:** `lib/session-store.mjs:78` + `lib/extraction-store.mjs`
**Description:** `messages.session_id REFERENCES sessions(id)` no `ON DELETE CASCADE`. Same for `mentions.entity_id`. Combined with F-C16 archival breakage, consolidation will fail FK enforcement if it ever ran.
**Fix:** Add `ON DELETE CASCADE` to FK constraints. Verify with insert-then-delete test.

### F-H10 — FTS5 triggers guarded only by `messages_ai` presence
**File:** `lib/session-store.mjs:105-128`
**Description:** Check if `messages_ai` exists, if so SKIP creating all three triggers. If anyone drops `messages_au`, it never re-creates. Also no rebuild of FTS on upgrade from empty.
**Fix:** Check each trigger by name independently; use `CREATE TRIGGER IF NOT EXISTS`; run `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` on count mismatch.

### F-H11 — FTS5 query sanitizer allows operators
**File:** `lib/session-store.mjs:404-422`
**Description:** Only strips `[*(){}^]` and escapes `"`. Allows `NEAR`, `OR`, `NOT`, `:` column filter. `cat NEAR/9999 dog` valid syntax → runaway scan on large FTS index.
**Fix:** Strip `:`; reject or quote keyword tokens; cap query word count.

### F-H12 — `ON CONFLICT(name) DO UPDATE` overwrites `type`
**File:** `lib/extraction-store.mjs:178-182`
**Description:** Entity flips between `project`/`system`/etc across extractions. Downstream code reads inconsistent type. Race depends on extraction order.
**Fix:** Keep original type (`type = COALESCE(entities.type, @type)`) or track history.

### F-H13 — `decayWeights` `DELETE` throws FK constraint
**File:** `lib/consolidation.mjs:84, 92-118`
**Description:** Cross-reference with F-C16. Already covered.

### F-H14 — Self-joins on mentions are O(N²) uncapped
**File:** `lib/consolidation.mjs:171-183, 235-247`
**Description:** `mentions m1 JOIN m2 ON session_id` without composite index `(session_id, entity_id)`. Hundreds of mentions per session = quadratic. Doesn't filter by recency despite docstring claim.
**Fix:** `CREATE INDEX idx_mentions_session_entity ON mentions(session_id, entity_id)`. Add `WHERE created_at >= ...` filter.

### F-H15 — `isTransient` misses Node-fetch undici errors
**File:** `lib/ollama-queue.mjs:242-256`
**Description:** Undici wraps errors in `TypeError: fetch failed` with real cause in `err.cause.code`. Current code checks `err.code` only. Real network blips classified as persistent.
**Fix:** `const code = err.code ?? err.cause?.code;` Match on either. Permissively retry `fetch failed`.

### F-H16 — Auto-restart loop has no rate limit
**File:** `lib/ollama-queue.mjs:299-304` + `bin/health-watch.mjs:123-143`
**Description:** Deeper Ollama failure (disk full, corrupted model file) → 3 timeouts → `isStuck` true → restart → counter resets → 3 more timeouts → restart loop every 3-5 min indefinitely.
**Fix:** In `recordAutoRestart`, reject if N restarts occurred in last M minutes.

### F-H17 — `isStuck` triggered by 1s analysis timeouts
**File:** `lib/ollama-queue.mjs:291-294`
**Description:** Analysis defaults to 1s wait timeout. Cold model load takes 5-15s. Three analyses in that window → stuck → auto-restart → evicts loading model → cycle.
**Fix:** Separate thresholds per type; or only count `extraction` for stuck detection.

### F-H18 — Shutdown / drainPending race
**File:** `lib/ollama-queue.mjs:118-130, 312-324`
**Description:** `executeJob`'s finally calls `drainPending()`. If shutdown started mid-job, `drainPending` still `_fire()`s next entry against a tearing-down process.
**Fix:** `drainPending` returns early if `state.shuttingDown`.

### F-H19 — `HARD_CAP_MS` AbortController not propagated
**File:** `bin/consolidation-scheduler.mjs:142-174`
**Description:** Cap fires → `Promise.race` rejects → function returns, but consolidation continues running in background. Overlapping cycles possible if launchd interval shorter than cycle.
**Fix:** Thread `ac.signal` into `runCycle({ signal })` and downstream HTTP/queue.

### F-H20 — `@memory only:X` silently ignored
**File:** `lib/memory-inject-server.mjs:159-162` + `lib/memory-injector.mjs:411-414`
**Description:** Server sets `retrieveOpts.themeFilter` but neither injector nor pipeline reads it. User typing `@memory only:nonexistent` gets full unfiltered retrieval.
**Fix:** Implement (filter `findMatchingThemes` results) or return 400/clear warning if unimplemented.

### F-H21 — `@memory none` treated same as `off`
**File:** `lib/memory-inject-server.mjs:141-148`
**Description:** Docs say `none` is "hard disable for entire session until restart". Server one-shots it identically to `off`. Either docs wrong or feature unimplemented.
**Fix:** Document accurately or implement session-scoped blocklist keyed by `session_id`.

### F-H22 — Entity/theme matching O(N) per query, substring-fragile
**File:** `lib/retrieval-pipeline.mjs:61-71 + 80-90`
**Description:** `findMatchingEntities/Themes` `SELECT *` (no LIMIT), JS-filter with `lowerQuery.includes(name.toLowerCase())`. Empty names match every prompt. Single-letter entities ("R") match anything with that letter. Each call loads full table — 3× per `retrieve`.
**Fix:** Word-boundary regex; drop empties (`AND length(name) >= 2`); memoize within one retrieve call.

### F-H23 — Theme→decision lookup is full table scan
**File:** `lib/retrieval-pipeline.mjs:202-216`
**Description:** `SELECT DISTINCT session_id, decision, rationale FROM decisions` returns every row, nested-loop substring match against themes. O(themes × decisions).
**Fix:** Indexed FTS or per-theme LIKE with LIMIT.

### F-H24 — Channels sequential, not parallel
**File:** `lib/retrieval-pipeline.mjs:433-493`
**Description:** Handler awaits channels 1→2→3→4→5 in series. Channel 2 (semantic embedding) blocks channels 3/4/5 even though they're synchronous SQLite reads.
**Fix:** `Promise.all([ch1, ch2, ch3, ch4, ch5])` then combine.

### F-H25 — LLM analysis + embedding work discarded
**File:** `lib/memory-injector.mjs:451 + query-analysis.mjs:217`
**Description:** Spends full LLM call + embedding generating intent/entities/themes, then passes only raw text to `pipeline.retrieve`. Pipeline re-embeds inside `searchSessions` — double cost. LLM-extracted entities/themes never injected as seeds.
**Fix:** Pass `analysis.embedding` to `searchSessions`. Feed extracted entities/themes as seed sources or weight boosts.

---

## MEDIUM (~22)

### F-M1 — IIFE consumer loop not awaited at stop()
**File:** `lib/broadcast-offerer.mjs:399-417` + `broadcast-acceptor.mjs:400`
**Description:** Detached IIFE; `stop()` calls `unsubscribe()` but doesn't await loop. Tests calling `await stop()` don't know when processing actually ends.
**Fix:** Capture promise; await in `stop()` with small timeout.

### F-M2 — Top-K offer selection non-deterministic on ties
**File:** `lib/broadcast-acceptor.mjs:255-280`
**Description:** Strict `>`, first-equal-wins. Peer score scales aren't comparable. Only one offer ever surfaced.
**Fix:** Tie-break by peer trust or recency; consider top-N.

### F-M3 — Self-skip matches empty/spoofed `node_id`
**File:** `lib/broadcast-offerer.mjs:253-259`
**Description:** `node_id === nodeId`. Empty `nodeId` collides with peer empty/missing.
**Fix:** Validate non-empty at constructor, throw.

### F-M4 — Passive-unchanged window off-by-one
**File:** `lib/broadcast-emitter.mjs:294-295`
**Description:** `push` happens before unchanged check. The 5th identical broadcast always slips through.
**Fix:** Move push after check.

### F-M5 — Dedup key collapses themes ∪ entities into one set
**File:** `lib/broadcast-emitter.mjs:93-99`
**Description:** No namespacing. `themes=['foo']` collides with `entities=['foo']`. No Unicode normalization.
**Fix:** Namespace (`t:foo`, `e:foo`); `.normalize('NFC')` before hash.

### F-M6 — LLM summary errors silently swallowed
**File:** `lib/broadcast-offerer.mjs:60-100`
**Description:** Catches everything, falls back to data-only. No observability into LLM fallback frequency.
**Fix:** Increment stat; bubble unexpected errors.

### F-M7 — Signed canonical form depends on Zod-injected defaults
**File:** `lib/local-event-log.mjs:67-81`
**Description:** Sign post-parse OK; if any path signs pre-parse, signatures won't verify.
**Fix:** Document and enforce sign-post-parse.

### F-M8 — Themes / contradictions budgeted but never populated
**File:** `lib/memory-injector.mjs:253-286 + 463-470`
**Description:** `curateForRecall` reserves budget for `themes` and `contradictions` but caller passes only concepts/decisions/snippets. Formatter doesn't render them either.
**Fix:** Either populate + render, or remove from budget.

### F-M9 — Lazy llmClient thunk race
**File:** `lib/memory-injector.mjs:382-399`
**Description:** Two concurrent cold-call `retrieve()` both see `!this._real`, both create clients.
**Fix:** Memoize the promise, not the result.

### F-M10 — Degraded-warning formatter duplicated
**File:** `lib/memory-formatter.mjs:81-103` vs `lib/memory-injector.mjs:537-563`
**Description:** Two copies of same logic, already diverged.
**Fix:** Single source of truth.

### F-M11 — `getChunksForSessions` returns most-recent only
**File:** `lib/retrieval-pipeline.mjs:103-127`
**Description:** `ORDER BY turn_index DESC LIMIT ?` always returns tail. Misses seed turn that introduced topic. Bias toward chatty sessions (no per-session balancing).
**Fix:** `LIMIT N PER session_id` via window function.

### F-M12 — Empty prompt returns 400 from server, but graceful from library
**File:** `lib/memory-inject-server.mjs:122-124`
**Description:** Inconsistent contract.
**Fix:** Return 200 + empty block.

### F-M13 — Bearer token compared with `!==` not constant-time
**File:** `lib/memory-inject-server.mjs:107-110`
**Description:** Timing side-channel. Mitigated by loopback-only.
**Fix:** `crypto.timingSafeEqual`.

### F-M14 — `coMentioned` JOIN with DISTINCT + ORDER BY non-selected column
**File:** `lib/obsidian-summarizer.mjs:185-193`
**Description:** SQLite tolerates but result is "top 10 distinct names" not "top by mention_count".
**Fix:** `GROUP BY e2.id ORDER BY MAX(e2.mention_count) DESC LIMIT 10`.

### F-M15 — FTS LIMIT 200 cap applied pre-rank
**File:** `lib/session-store.mjs:267, 269`
**Description:** High-frequency word saturates 200 with one chatty session, hides other sessions with fewer-but-relevant matches.
**Fix:** Top-K per session via window function.

### F-M16 — `fs.watch` unthrottled on rename storms
**File:** `bin/obsidian-graph-cache.mjs:225-236`
**Description:** Debounce correct but inner `refreshCache()` not awaited. Two refreshes concurrent → second clears edges mid-iteration. `last_activated_at` wiped on every refresh.
**Fix:** "refresh in progress" boolean. Preserve `last_activated_at` across refresh.

### F-M17 — `addEntry` not transactional over read+write
**File:** `lib/memory-budget.mjs:152-209`
**Description:** `readFile → compute → writeFile`. Concurrent calls lose entries.
**Fix:** Per-process mutex around read+write, or atomic write via temp+rename.

### F-M18 — Salience clamp missing lower bound on entities decay path
**File:** `lib/consolidation.mjs:113`
**Description:** Decisions path wraps `Math.max(newSalience, 0)`. Entities path doesn't.
**Fix:** Wrap entity decay write in `MAX(0, MIN(1, ...))`.

### F-M19 — `ORDER BY mention_count, last_seen DESC` non-deterministic on ties
**File:** `lib/extraction-store.mjs:294-298, 309-313, 324-328`
**Description:** `now = new Date().toISOString()` shared across batch; many entities tie. MEMORY.md content varies run-to-run.
**Fix:** Add `, id ASC` tiebreaker.

### F-M20 — `obsidian-graph-cache` skips WAL pragma
**File:** `bin/obsidian-graph-cache.mjs:73-78`
**Description:** Two processes (daemon + CLI `--refresh`) on same DB without WAL → block or fail.
**Fix:** `db.pragma('journal_mode = WAL')` after construction.

### F-M21 — `LLM_*` env vars frozen at module load
**File:** `lib/llm-client.mjs:30-34` + `lib/ollama-queue.mjs:33-38`
**Description:** Long-running daemons can't pick up new values without restart. Inconsistent — some checked per call, some at load.
**Fix:** Read inside function or document restart-required.

### F-M22 — Boolean env parsing inconsistent
**File:** `lib/llm-client.mjs:83, 107` + `lib/injection-logger.mjs:41`
**Description:** `LLM_NATIVE_API`: only `'false'` disables. `LLM_FORCE_FREE_FORM`: only `'1'` enables. `INJECTION_LOG_DISABLED`: only `'1'` disables.
**Fix:** Central `parseBool()` accepting `1/true/yes/on` vs `0/false/no/off`.

---

## LOW (~16)

### F-L1 — `getOrCreateIdentity` no file-creation lock
**File:** `lib/node-identity.mjs:51-83`
**Description:** Two processes booting concurrently both write key. Second clobbers first → earlier signatures unverifiable.
**Fix:** `fs.openSync(keyPath, 'wx', 0o600)`.

### F-L2 — `formatPeerMemoryBlock` doesn't escape control chars
**File:** `lib/broadcast-acceptor.mjs:99-121`
**Description:** Peer summary flows into `[peer-memory: ...]` block. Embedded newlines / `[end peer-memory]` confuse injection layer.
**Fix:** Strip/escape control chars + delimiter tokens.

### F-L3 — `consumers.get` always falls through to ephemeral
**File:** `lib/broadcast-offerer.mjs:382-396`
**Description:** Nothing creates durable consumer. Every restart misses broadcasts published while daemon down.
**Fix:** Create durable in start() or document ephemeral behavior.

### F-L4 — `ensureSharedStream` doesn't update subjects on existing stream
**File:** `lib/shared-event-stream.mjs:52-68`
**Description:** New federation subjects in `SHARED_SUBJECTS` won't flow until manual stream update.
**Fix:** Detect mismatch; `jsm.streams.update(...)`.

### F-L5 — Token overlap denominator not deduped
**File:** `lib/broadcast-acceptor.mjs:33`
**Description:** `computeTokenOverlap` doesn't `Set`-dedupe summary tokens. Inflated denominator → underestimated overlap.
**Fix:** `new Set(summaryTokens).size`.

### F-L6 — `checkAcceptance` accepts first match not best
**File:** `lib/broadcast-acceptor.mjs:293-302`
**Description:** Iterates in order, accepts first offer with `overlap >= threshold`. Later higher-overlap offer never seen.
**Fix:** Scan all, accept highest.

### F-L7 — `extractJsonFromText` picks first `{...}` block
**File:** `lib/extraction-prompt.mjs:276-308`
**Description:** Model preamble containing `{notes}` captured instead of real extraction.
**Fix:** Prefer largest balanced block; or detect missing required keys and continue scanning.

### F-L8 — `executeJob` timeout classification regex on `err.message`
**File:** `lib/ollama-queue.mjs:112-115`
**Description:** Any message containing "timeout" — including HTTP 504 — counts toward stuck. Feeds F-H17.
**Fix:** Count only AbortError + `ETIMEDOUT` codes.

### F-L9 — `coerceExtractionResult` alias gaps
**File:** `lib/extraction-prompt.mjs:29-69`
**Description:** Missing aliases: `event`, `meeting`, `location`, `document_name`. Dropped silently. Also `aliases` keyed lowercase but snake transform uses different chars.
**Fix:** Map common types to `concept` catch-all; normalize keys.

### F-L10 — Analysis-priority can starve extraction
**File:** `lib/ollama-queue.mjs:123-130`
**Description:** Sustained drip of analyses always pulled ahead of extractions.
**Fix:** Aging — bump extraction priority after N analyses pass.

### F-L11 — `injection-logger` prompt_excerpt leaks PII
**File:** `lib/injection-logger.mjs:97-103`
**Description:** 200 chars of raw user prompt logged by default. API keys, SSNs, secrets persist in JSONL.
**Fix:** Default opt-out, or scrub common patterns (`sk-`, `AKIA`, `Bearer`, email regex).

### F-L12 — Log rotation race on concurrent appenders
**File:** `lib/injection-logger.mjs:53-63`
**Description:** Two concurrent `logInjection` both see size > threshold, both rename. Silent failures.
**Fix:** Per-process rotation mutex if it becomes a real problem.

### F-L13 — `getQueueHealth` re-imports on failure
**File:** `bin/health-watch.mjs:97-106`
**Description:** Failed import → re-attempt every tick. Module cache deduplicates but adds latency.
**Fix:** `_importFailed = true` sentinel.

### F-L14 — RRF tie-break non-deterministic
**File:** `lib/retrieval-pipeline.mjs:323-351`
**Description:** Tied scores sort by Map insertion order (channel order).
**Fix:** Add `chunk_id` as secondary sort key.

### F-L15 — Token budget read at module load only
**File:** `lib/memory-injector.mjs:30-31`
**Description:** `DEFAULT_TOKEN_BUDGET` frozen at import. Test harnesses setting env after require see stale value.
**Fix:** Read at call time.

### F-L16 — Salience clamp ignores 0 lower bound (can't resurrect)
**File:** `lib/memory-injector.mjs:308-309`
**Description:** `MIN(1.0, COALESCE(salience, 0.5) * ?)`. Decayed to 0 stays 0 forever.
**Fix:** `MIN(1.0, MAX(0.05, COALESCE(salience, 0.5)) * ?)`.

---

## CLEAN sections (passed review)

- **`local-event-log.mjs`** — schema-validates before publish, uses `idempotency_key` as msgID.
- **`shared-event-stream.mjs`** — clean except F-L4.
- **`federation-resilience.mjs`** — reverse-iterate-splice in cleanup is correct.
- **`memory-directives.mjs:42-67`** — directive parser is correct and pure.
- **`memory-formatter.mjs` formatConceptList/formatDecisionList** — straightforward.
- **`spreading-activation.mjs:resolveNum`** — handles 0 correctly (avoids `||` trap).
- **`retrieval-pipeline.mjs:weightedRRF`** — math correct, k=60 canonical, division-by-zero impossible.
- **`memory-inject-server.mjs:getOrCreateToken`** — 0o600 + 32-byte randomBytes, correct.
- **`memory-inject-server.mjs:readJsonBody`** — 64KB cap + `req.destroy()`, correct.

---

## Cross-cutting recommendations

1. **Centralize the privacy filter** — push to SQL JOIN level via a shared helper. Currently 3+ independent paths invent their own.
2. **Add a `schema_version` migrations table** — replaces "check column existence" pattern. Becomes critical when migrations need ordering or data backfills.
3. **Add integration tests for:**
   - Mention + entity → run `decayWeights` archive → must not throw FK
   - Two concurrent `addEntry` calls on memory-budget
   - `filterPrivateResults` actually blocks private names from offerer output
   - SIGTERM during queue burst — verify graceful exit
4. **Identity registry** — `nodeId → trustedPubkey` map persisted with introduction signing for new nodes joining a council.

---

## Top recommendations (by impact)

1. **Cluster A (4 critical signing fixes)** — federation must not be enabled in production until done.
2. **Cluster C (4 recall scoring data-path fixes)** — Block 7C is theatrically present but inert.
3. **Cluster B (3 queue lifecycle)** — daemon won't shut down cleanly, will OOM under stuck Ollama.
4. **Cluster D (2 privacy bypasses)** + F-C15 (NULL migration) + F-C12 (injection helpers) — privacy boundary doesn't hold.
5. **F-C14** — graph cache import path: 1 character fix unlocks Channel 5 globally.
6. **F-C16** — archival has never worked; covered when fixing Cluster B's lifecycle.

---

## Files reviewed

Federation: broadcast-emitter, broadcast-offerer, broadcast-acceptor, node-identity, shared-event-stream, local-event-log, federation-resilience, event-schemas/src/broadcast.

Retrieval/injection: memory-injector, retrieval-pipeline, spreading-activation, query-analysis, memory-formatter, memory-inject-server, memory-directives.

Storage: extraction-store, session-store, obsidian-graph-cache, consolidation, memory-budget, obsidian-summarizer.

LLM bridge: llm-client, ollama-queue, extraction-prompt, injection-logger, consolidation-scheduler, health-watch.

---

*Generated 2026-05-26 by 4 parallel deep-review agents (each spending ~4 min of focused reading per file). All findings cite `file:line` and ship with suggested fixes.*
