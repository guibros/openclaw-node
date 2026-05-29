# OpenClaw Memory Plan — Second-Wave Review, Pass 1

**Date:** 2026-05-27
**Reviewers:** 4 general-purpose audit agents (serial — to avoid the rate-limit burst from prior round)
**Scope:** Areas not deeply audited in the 2026-05-26 follow-up review, plus net-new code introduced by that remediation.
**Methodology:** Each reviewer received an exclusive scope and the prior follow-up doc for context. Findings cite `file:line` and ship with suggested fixes.

---

## Headline

The remediation round closed the original 80 findings down to a known 8 (peer-trust integration tests). Pass 1 of the second-wave review uncovered **72 new findings** across areas that were either net-new or thinly covered before. The pattern that dominates:

> **Fix-at-leaf-but-not-wired-at-call-site, again.** Several of the most damaging pass-1 findings are exactly the same shape as the F-N50-class bugs we fixed last round, this time in new code.

Specifically:
- **F-P107/P113** — the daemon's `onIngest` callback is a logging stub. F-N107 said "make onIngest required so subscriber-without-consumer can't silently drop events." The daemon now provides one — but it just logs and returns. Events get permanently `msg.ack()`'d into the void. **F-N107 is satisfied in spirit but the bug is back in fact.**
- **F-P201** — Channel 5 (spreading activation) is silently broken in production because the graph adapter calls `.map()` on `queryNeighbors()`'s return shape `{edges, neighbors}`. Tests pass only because the mock returns an array. **Same silent-disablement pattern as F-C14.**
- **F-P401, F-P408** — `signEvent` silently overwrites existing signatures (F-N12); legacy `verifyEvent(event)` returns true for unsigned events (F-N13). Both were classified as MEDIUM and deferred; this reviewer reclassifies them as CRITICAL/HIGH respectively because the surface area for accidental misuse is larger than we credited.

**Severity distribution:**

| Severity | Count |
|---|---:|
| CRITICAL | 5 |
| HIGH | 17 |
| MEDIUM | 22 |
| LOW | 28 |

**Status of prior findings re-checked:**

| Prior ID | Pass-1 status | Notes |
|---|---|---|
| F-N9 (ttl bound) | PARTIAL | `ttl_minutes` fixed; `expires_at` still unbounded → F-P402 |
| F-N12 (signEvent overwrites) | UNFIXED | Was MEDIUM, now CRITICAL → F-P401 |
| F-N13 (legacy verifyEvent) | UNFIXED | Was MEDIUM, now HIGH → F-P408 |
| F-N14 (forward-compat) | PARTIAL | `event_version` exists but unused; `.strip()` still drops unknowns → F-P403 |
| F-N50/N51 (privacy at HTTP) | HELD | Server doesn't pass `respectPrivacy` but default is true + body allowlist blocks override |
| F-N70 (frontend semantic) | UNFIXED | Wrappers and server still diverge → F-P302 |
| F-N100 (hard-cap signal) | PARTIAL | Between-step works; mid-step abort in `regenerateSummaries` doesn't propagate to `abortInfo` → F-P208 |
| F-N107 (onIngest required) | SATISFIED IN SPIRIT NOT FACT | Daemon supplies a logging stub → F-P107/P113 |
| F-N150 (recency cap) | PARTIAL | `reinforceCoOccurrence` index added but recency missing in BOTH this and `detectClusters` → F-P203 |
| F-N158 (graph rebuild atomic) | PARTIAL | Inside one txn, but no `busy_timeout` → concurrent reader can abort rebuild → F-P206 |

---

## CRITICAL (5)

### F-P107 / F-P113 — Daemon `onIngest` is a no-op logging stub (F-N107 satisfied-in-letter)
**File:** `bin/openclaw-memory-daemon.mjs:75-88`
**Severity:** CRITICAL
**Description:** F-N107 made `onIngest` mandatory specifically so "subscriber-with-no-consumer" couldn't silently evaporate events. The daemon's `onIngest` is `(event, parsed) => log(...)`. The subscriber acks the JetStream message after `onIngest` returns. So events flow in, get logged, and disappear from the durable consumer's redelivery queue. This is the F-N107 evaporation pattern *with* a log line. If the daemon is the only shared-stream consumer (it will be), all federation events for the lifetime of this commit are lost.
**Fix:** Either (a) non-durable JetStream consumer so messages stay redeliverable, (b) defer subscriber start until projection lands, (c) buffer events to disk (extraction.db sidecar) and replay when projection ships. Pick one BEFORE multi-node deploy.

### F-P201 — Channel 5 (spreading activation) silently broken in production
**File:** `lib/spreading-activation.mjs:73-80`
**Severity:** CRITICAL
**Description:** `createGraphAdapter.edgesFrom` calls `graphCache.queryNeighbors(nodeId, {direction:'outgoing'})` and then `rows.map(r => ...)`. The real `createGraphCache.queryNeighbors` returns `{edges, neighbors}` — an object, not an array. Every call throws `TypeError`. Tests pass only because the mock returns an array, masking the real shape. Channel 5 was specifically un-broken by F-C14 (fixing the import path); this re-disables it via a different mechanism. Exception is swallowed upstream so failure is silent.
**Fix:** Use `rows.edges` (or destructure). Update test mock to return `{edges, neighbors}`. Add an integration test that uses a real `createGraphCache` instance.

### F-P202 — `detectContradictions` does not detect contradictions
**File:** `lib/conflict-surfacing.mjs:50-143`
**Severity:** CRITICAL (semantic — misnamed feature)
**Description:** `findEntityConflicts` only flags entities with mentions from BOTH `local` AND `shared` provenance. That's not a contradiction — it's normal federation. `findDecisionConflicts` is weaker: any session that received decisions from both source types. No semantic comparison: two decisions saying the same thing trigger; two decisions saying opposite things from the same source don't. Cycle stats line "Contradictions: N found" is misleading.
**Fix:** Either rename → `detectProvenanceMixing` and document, or build a real contradiction step via `client.generateAnalysis` (analysis queue, see F-P209). Don't ship the misnamed version to production.

### F-P401 — REGRESSION (F-N12): `signEvent` silently overwrites existing signature
**File:** `lib/node-identity.mjs:341-356`
**Severity:** CRITICAL
**Description:** JSDoc says "must not already have signature" but no check exists. A caller that double-signs (e.g. accidentally re-runs `signEvent` in a publish retry path) silently replaces the original signature. `canonicalizeEvent` strips both fields before signing, so the new sig is over an unsigned event — any tampering of the original sig is undetectable at this layer. Combined with F-N5 (signing-error rollback) this is a silent integrity failure.
**Fix:** `if (event.signature || event.signer_pubkey) throw new Error('signEvent: event already signed');` at the top. Accept an explicit `{force:true}` opt for callers that genuinely want to re-sign.

### F-P402 — REGRESSION (F-N9): `expires_at` in context-offer is unbounded
**File:** `packages/event-schemas/src/broadcast/context-offer.ts:18`
**Severity:** CRITICAL
**Description:** F-N9 only fixed `ttl_minutes` on `context-broadcast`. `expires_at: z.string().datetime()` has no max-future bound. An attacker publishes an offer with `expires_at: "9999-12-31T23:59:59Z"`; the acceptor's expiry sweep never reaps it; `cleanupExpiredOffers` (F-N18) won't either. Combined with F-N7 (offerer_node_id unauthenticated) and F-N8 (acceptance race), this is a memory-pressure + offer-pollution DoS vector.
**Fix:** `.refine(s => { const ms = Date.parse(s); return ms - Date.now() < 24*60*60*1000 && ms - Date.now() > 0; }, 'expires_at must be 0–24h in the future')`. Mirror the F-N9 24h cap.

### F-P403 — Default `.strip()` drops `signature`/`signer_pubkey` on parse; sig lost on republish
**File:** `packages/event-schemas/src/envelope.ts:3` + all schemas
**Severity:** CRITICAL (forward-compat)
**Description:** Zod default `.strip()` removes unknown keys on parse. The boundary parse in offerer/acceptor (`broadcast-offerer.mjs:340-341`) runs AFTER sig verify, and silently drops `signature` and `signer_pubkey` from the parsed event. If any downstream code re-verifies (e.g. when re-publishing to local subscribers), the sig is gone — silent revert to "trust the local bus." Same trap for forward-compat: v2 fields silently dropped by v1 parsers with no version dispatch logic.
**Fix:** Use `.passthrough()` on envelope + data schemas, OR explicitly re-attach sig fields after parse at the boundary. Add a one-line `event_version` check in `verifyEvent` that rejects unsupported versions.

---

## HIGH (17)

### F-P101 — Self-trust silently fails on pre-existing mismatched registry entry
**File:** `lib/federation-startup.mjs:72-74`
`registry.trust(nodeId, identity.publicKeyBase64, 'self')` is a no-op when an entry for our `nodeId` already exists with a different pubkey (e.g. operator typo via trust-peer, or a peer's malicious pre-registration). The daemon then signs events that fail verification everywhere (including its own acceptor) as `pubkey-mismatch`. **Fix:** Check `registry.get(nodeId)` first; if exists with different pubkey, fail-CRITICAL at startup. Optionally add `registry.upsert()` for self-trust.

### F-P102 — Daemon startup leaks resources on partial failure
**File:** `bin/openclaw-memory-daemon.mjs:38-114`
If `startFederation` succeeds but `createSubscriber` or `createConsolidationScheduler` throws, the outer catch runs `process.exit(1)` without `federation.stop()`, `nc.drain()`, or DB close. On a systemd auto-restart loop this leaks NATS subscriptions and produces stale WAL/SHM files. **Fix:** Build `cleanup` closure as resources are acquired; call from both catch and signal handlers.

### F-P103 — SIGTERM during startup is unhandled
**File:** `bin/openclaw-memory-daemon.mjs:103-113`
Signal handlers register AFTER all the startup awaits. If SIGTERM arrives mid-startup (typical during `systemctl restart`), Node's default handler runs → immediate exit, no cleanup. **Fix:** Register handlers BEFORE acquiring resources; have them consult a `startupDone` flag to know full vs partial cleanup. Add re-entry guard.

### F-P203 — REGRESSION (F-H14/F-N150): recency filter still missing in BOTH co-occurrence queries
**File:** `lib/consolidation.mjs:186-198`, `:250-262`
F-N150 flagged this on `reinforceCoOccurrence`; the same hole exists verbatim in `detectClusters`. Both self-joins on `mentions` lack `WHERE m1.created_at >= ?`. Cost grows quadratically with history depth. Worse: stale historical co-occurrence keeps driving reinforcement — the "reconsolidation feedback loop" rewards old noise. **Fix:** Add 30-day default recency cap (env override `CONSOLIDATE_RECENCY_WINDOW_DAYS`) to both. Extend `idx_mentions_session_entity` to include `created_at`.

### F-P204 — `decayWeights` entities and decisions are separate transactions
**File:** `lib/consolidation.mjs:102-166`
Power loss / hard-cap between the two leaves entities decayed but decisions un-decayed. Combined with F-P210, decisions whose salience SHOULD have dropped below promotion threshold get promoted anyway. There's no cycle-wide transaction either — partial-cycle restart is undefined. **Fix:** Wrap whole cycle in one `db.transaction()` OR document that each step is independently durable + idempotent.

### F-P205 — `detectClusters` cluster identity unstable across cycles
**File:** `lib/consolidation.mjs:247-315`
Clusters re-derived from scratch every cycle. No persisted `cluster_id`. Downstream consumers (theme-note generation, promotion) can't link "cluster I detected last cycle" → "cluster I detected this cycle." Single new mention 30 minutes later fragments or merges existing clusters. **Fix:** Persist `concept_clusters(id, signature, entities_json, first_seen, last_seen)` keyed by SHA-1 over sorted entity-ids.

### F-P206 — Graph cache rebuild has no `busy_timeout`; concurrent reader can abort it
**File:** `bin/obsidian-graph-cache.mjs:113-134` (regression of F-N158 — partial fix)
Rebuild is wrapped in `db.transaction()` (good), but no `busy_timeout` on the `graph-cache.db` handle. A concurrent reader transaction (the inject server holds one) can cause the rebuild to throw `SQLITE_BUSY` and abort. The catch swallows; cache reflects pre-failure state until next interval. **Fix:** `db.pragma('busy_timeout = 5000')` in `initDb`. Consider shadow-table-swap pattern.

### F-P207 — `reinforceCoOccurrence` salience boost is once-per-cycle disguised as per-pair
**File:** `lib/consolidation.mjs:200-229`
`reinforcedIds` Set caps each entity to one boost per cycle regardless of how many pairs qualify. That's probably the intended hub-protection cap, but the docstring describes per-pair semantics — the SQL and code are working at cross purposes. **Fix:** Document the cap explicitly OR rewrite as single-pass `UPDATE entities SET ... WHERE id IN (...)`.

### F-P208 — Mid-`regenerateSummaries` abort doesn't propagate to cycle's `abortInfo`
**File:** `lib/consolidation.mjs:328-360` + `bin/consolidate.mjs:102-119`
The summarizer's per-concept loop sets `result.aborted = true`; the wrapper propagates into its own return shape; but the cycle's `abortInfo` is only set by `checkpoint()` calls between steps. After `regenerateSummaries` returns aborted, the cycle still runs `detectContradictions` and `evaluatePromotionCandidates`. Cycle reports `aborted: false` while half the summaries are missing. **Fix:** Set `abortInfo = {aborted: true, abortedAt: 'summaries-midloop'}` after the summary step if its result.aborted is set.

### F-P301 — `memoryDisabledForSession` is process-global; cross-tenant leak
**File:** `lib/publishers/{openai,anthropic,gemini,minimax}-wrapper.mjs`
Closure-scoped var, set by `@memory none` from any user, kills memory for ALL subsequent calls on that SDK client (the normal server-side pattern is one client across many users). F-H21 said `@memory none` is per-turn. The wrappers unilaterally upgraded "per-turn" to "kill the client lifetime." **Fix:** Either treat `none` as `off` (per-turn) OR key the disable by `opts.sessionKeyFn(args)`.

### F-P302 — REGRESSION (F-N70): `@memory only:X` semantics still diverge
**File:** Wrappers vs `lib/memory-inject-server.mjs:182-185`
Wrappers do `retrieveQuery = directive.param` (embed on a single token). Server uses `cleanedText` as query + `themeFilter: param` as a post-retrieval filter. Same prompt → wildly different memory blocks depending on which frontend touched it. **Fix:** Wrappers should pass `{themeFilter: directive.param}` and use `directive.cleanedText` as query. Strip the special-case from all four wrappers.

### F-P404 — Envelope strings unbounded (`node_id`, `idempotency_key`, `entity_id`)
**File:** `packages/event-schemas/src/envelope.ts:7,16,17`
A peer sends `node_id` of 10 MB string and schema admits it. `peerTracker` (F-N11) maps unbounded `node_id` strings → unbounded growth. **Fix:** `node_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/)`. Similar bounds on `idempotency_key`, `entity_id`.

### F-P405 — `signature` and `signer_pubkey` not format-validated
**File:** `envelope.ts:18-19`
`z.string().optional()` admits megabyte payloads. `verifyEvent` eventually rejects after base64-decode + length check, but only after the parser already allocated the string. DoS surface. **Fix:** `signer_pubkey: z.string().regex(/^[A-Za-z0-9+/=]+$/).length(44).optional()` (ed25519 pubkey is exactly 44 chars b64). `signature: z.string().regex(...).max(128).optional()`. `actor.id: z.string().min(1).max(256)`.

### F-P406 — Broadcast/Offer arrays unbounded — cheapest DoS
**File:** `context-broadcast.ts:7-8`, `context-offer.ts:9-17`, `context-accepted.ts:8`
A single signed broadcast with 1 million themes is admitted; the offerer's `queryParts.join(' ')` builds a giant query. Combined with F-N19 (no per-block total cap) this is the cheapest DoS in the protocol. **Fix:** `.max(64)` on themes/entities, `.max(50)` on artifacts; `.max(256)` on string elements.

### F-P407 — `relevance_score` unbounded; canonical/parsed divergence on Infinity
**File:** `context-offer.ts:11`
`z.number()` accepts NaN, Infinity, 1e308. `JSON.stringify` coerces NaN/Infinity to `null`, so the signed canonical and the parsed value DIVERGE: peer signs `relevance_score: Infinity` over canonical `null`; recipient parses Infinity; recipient sorts artifacts → attacker controls ranking. **Fix:** `z.number().min(0).max(1).finite()`. Audit every `z.number()` across the schema package; add `.finite()` defensively.

### F-P408 — REGRESSION (F-N13): legacy `verifyEvent(event)` returns `true` for unsigned
**File:** `lib/node-identity.mjs:421-431`
1-arg form returns `true` if no signature present, no sig math run. Any caller using the natural `if (verifyEvent(evt))` API silently trusts unsigned data. The test at line 175 EXPLICITLY asserts unsigned passes — encoding the bug. **Fix:** Remove the legacy 1-arg shape; default `requireSigned: true`. Flip the test assertion.

### F-P409 — `MemoryEventSchema` union excludes broadcast events; `local-event-log` can't accept them
**File:** `packages/event-schemas/src/events.ts:14-32`
`local-event-log.mjs:68` calls `MemoryEventSchema.parse(event)` — broadcast events fail with "Invalid discriminator value." If federation ever wants to log broadcasts locally, the call silently throws. **Fix:** Add `AllEventsSchema = z.discriminatedUnion('event_type', [...memory, ...broadcast])` OR document explicitly that broadcasts live on a different stream.

---

## MEDIUM (22)

### F-P104 — Broadcaster sweep timer never stopped during federation shutdown
**File:** `lib/federation-startup.mjs:133-138`
Comment claims "broadcaster doesn't currently have a stop()" but it does (clears the 5-min dedup sweep timer). Test scenarios constructing/tearing down federation leak `sweepTimer` per iteration. **Fix:** Call `broadcaster.stop()` in federation.stop().

### F-P105 — `peerCount` math wrong when self-trust fails
**File:** `lib/federation-startup.mjs:73-79`
`peerCount = entries().length - 1` understates by 1 when self-trust failed (F-P101). **Fix:** `peerCount = registry.entries().filter(([k]) => k !== nodeId).length`.

### F-P106 — `extractionDb` not threaded into offerer; defense-in-depth lost
**File:** `lib/federation-startup.mjs:109-112`
F-H6 added a SECOND fail-CLOSED privacy check at the peer-facing boundary precisely BECAUSE the retrieval-layer filter had multiple regression escapes. federation-startup passes `extractionDb` to the retrieval pipeline but not to the offerer — second layer disabled. **Fix:** Pass `extractionDb` (and `requestAnalysis`) through to `createOfferer`.

### F-P209 — `generateConceptSummary` waitTimeoutMs=3s too short for cold loads
**File:** `lib/obsidian-summarizer.mjs:152-158`
Cold Ollama model load is 5–15s; analysis queue returns mode:'fallback' at 3s → "Summary not yet generated." On a daemon that's idle most of the time (consolidation's whole point), the model is always cold and NO concept ever gets a summary. **Fix:** Env-driven `CONSOLIDATE_SUMMARY_WAIT_MS`, default 12000.

### F-P210 — Promotion candidates resurface every cycle even after publication
**File:** `lib/consolidation.mjs:398-429`
Query doesn't exclude entities already in `published_items`. Every 30-minute cycle re-emits the same candidates. **Fix:** Add `AND NOT EXISTS (SELECT 1 FROM published_items ...)`.

### F-P211 — `decayWeights` decisions path never clamps salience, no archival
**File:** `lib/consolidation.mjs:138-166`
Decision salience can drift >1 if any future writer sets it. No `decisions_archived` table. Combined with F-P213's slow conflict surfacing, decision table grows unbounded. **Fix:** Mirror entity path: clamp [0,1], add archival.

### F-P212 — Orphan entities (null dates) never decay
**File:** `lib/consolidation.mjs:104-105`
`if (!refDate) continue;` skips entities with both `last_recalled` and `last_seen` null. Combined with F-P210 they become perpetual promotion candidates. **Fix:** Treat missing date as "decay to floor immediately." Log to surface bad data.

### F-P213 — `findEntityConflicts` is N×5 correlated subqueries
**File:** `lib/conflict-surfacing.mjs:50-72`
On 50k entities = 250k prepared-statement queries per `detectContradictions` step. Combined with F-P202's "this isn't detecting actual contradictions" — wasting CPU on meaningless results. **Fix:** Rewrite as single CTE-aggregate over mentions.

### F-P214 — Graph edge weights always 1.0 — the weight knob is inert
**File:** `bin/obsidian-graph-cache.mjs:121-126`
Spreading-activation reads `edge.weight ?? 1`, so weights are unused. Block 6's "tunable edge weights" promise is unimplemented. **Fix:** Either remove `weight` from schema (with migration) or compute weights by edge_type.

### F-P215 — Scheduler `setInterval` can stack overlapping cycles
**File:** `bin/consolidation-scheduler.mjs:234-238`
If a cycle hits the hard cap and the cooperative abort doesn't catch it before the next interval fires, two `runCycle` calls touch the same SQLite file concurrently. The F-N100 cooperative-cancellation note even admits this. **Fix:** Track `currentRun` promise; skip if non-null.

### F-P216 — Graph-cache refresh interval can stack overlapping rebuilds
**File:** `bin/obsidian-graph-cache.mjs:224-231`
Same shape as F-P215. Plus the fs-watch debounced refresh can fire while a previous refresh is mid-run. **Fix:** Track `refreshInFlight` promise; coalesce.

### F-P303 — Deeply-nested JSON causes RangeError + leaks V8 internal text in error response
**File:** `lib/memory-inject-server.mjs:63-87`
64KB byte cap stops bulk size, but `JSON.parse({"a":{"a":{...}}})` overflows V8 stack. Caught and reported as `invalid JSON: <V8 internal text>`. **Fix:** Set `server.requestTimeout = 30_000`, `headersTimeout = 10_000`. Map errors to coarse categories.

### F-P304 — No HTTP server timeouts (slow-loris)
**File:** `lib/memory-inject-server.mjs:284-289`
Node defaults apply but slow connections can hold the server. **Fix:** Explicit `requestTimeout`, `headersTimeout`, `keepAliveTimeout`. Per-request handler timeout via `Promise.race`.

### F-P305 — No rate limiting on inject server
**File:** `lib/memory-inject-server.mjs:98-211`
Any local process with the token can spam retrieve() at 100 req/s → exhausts Ollama queue + CPU. **Fix:** Per-token concurrency limit (max 4 in-flight) + token-bucket budget (60/min) → 429 on exceed.

### F-P410 — Canonicalization integer-key ordering relies on V8 enumeration behavior
**File:** `lib/node-identity.mjs:305-327`
`Object.keys().sort()` returns lexical order, but `JSON.stringify` reorders integer-like keys to numeric-first regardless. Deterministic on V8/Node, but ECMA-262 only guarantees it for own-string-keyed integer indices. Non-V8 peer runtime would produce different canonical bytes → sig mismatch. **Fix:** Document the V8 dependency OR write a custom serializer that emits keys in lexical order without relying on object iteration.

### F-P411 — `createIdentityRegistry.save()` is not atomic
**File:** `lib/node-identity.mjs:181-189`
SIGKILL or disk-full mid-write leaves truncated JSON → next startup catches JSON.parse exception → "starts fresh" → **ALL trust bindings silently wiped**. F-N3 spoofing window opens for every peer simultaneously. Same code path triggers on every `.trust()` and `.remove()`. **Fix:** Write to `${path}.tmp`, then `fs.renameSync`. Catch ENOSPC explicitly.

### F-P412 — `causation_id` and `data.responding_to` redundant; no cross-field check
**File:** `envelope.ts:10-11`, `broadcast/context-offer.ts:7`
Both carry the same value by convention. No schema-level assertion they match — a peer can sign an offer where they diverge, breaking attribution. **Fix:** `.refine(evt => evt.causation_id === evt.data.responding_to)` on ContextOfferSchema.

### F-P413 — `entity_type` enum doesn't include `'broadcast'`
**File:** `envelope.ts:8`
Federation events forced to lie (`entity_type: 'session'`). Analytics that switch on entity_type will mis-bucket federation events. **Fix:** Add `'broadcast'` (or `'federation'`).

### F-P414 — `actor.type` enum missing `'peer'`
**File:** `envelope.ts:13`
Federation publishers mark `actor.type: 'system'`. Consumers wanting peer-vs-local origin must bypass actor model. **Fix:** Add `'peer'`.

### F-P415 — `concept-mentioned.salience` schema field never set by emitters
**File:** `memory/concept-mentioned.ts:10`
Optional bounded [0,1] field. F-N52 noted recall reads `mention.salience`, writes entity. If emitters start including this, merge semantic with `entities.salience` is undefined. Schema declares the field but data flow doesn't. **Fix:** Remove the field (force entity-grain) OR document and wire it.

### F-P306, F-P307, F-P308, F-P309 — Prior LOW findings still open
All listed under LOW below, repeated here for visibility: F-N59 substring loopback (F-P306), F-N64 content-type (F-P307), F-N65 URL exact-match (F-P308), F-N63 directive regex edge cases (F-P309). Still LOW severity.

---

## LOW (28)

Grouped briefly to keep this readable:

**Wiring/lifecycle (4):**
- F-P108 trust-peer CLI accepts flags as positional args
- F-P109 daemon `isMain` heuristic fragile (symlink/extensionless breaks)
- F-P110 wiring-manifest regex matches name presence not invocation
- F-P111 registry.entries() return shape changed without versioning

**Inject server / wrappers (10):**
- F-P306 (F-N59 substring loopback)
- F-P307 (F-N64 content-type)
- F-P308 (F-N65 URL exact)
- F-P309 (F-N63 directive regex partial)
- F-P310 streaming publish fires before stream consumed
- F-P311 wrapper error path swallows all bugs silently
- F-P312 Gemini wrapper injects memory as `user` turn (should be system)
- F-P313 token file TOCTOU race on cold start
- F-P314 token file world-readable threat model undocumented
- F-P315 server.close() doesn't drain in-flight
- F-P316 extractLastUserPrompt ignores multimodal content arrays
- F-P317 parseMemoryDirective collapses all whitespace including newlines
- F-P318 500 response leaks err.message contents
- F-P319 loopback fingerprint via 403 response body
- F-P320 injectIntoMessages immutability contract undocumented

**Consolidation / graph (2):**
- F-P217 NaN intervalMs = DoS via parseInt
- F-P218 isOllamaIdle conflates unreachable with idle
- F-P219 privacy filter missing in conflict-surfacing + promotion-candidates

**Schemas / identity (5):**
- F-P416 zod-to-json-schema cast through `any` hides type drift
- F-P417 getOrCreateIdentity race-loser doesn't write identity.pub
- F-P418 verifyEvent strict-mode check ordering (replay vs freshness)
- F-P419 EventEnvelope.data field required everywhere; envelope-only events impossible
- F-P420 signature field shadowing not enforced

---

## Cross-cutting observations

1. **Same patterns, new code.** The "fix at leaf, not wired at call site" pattern is back: F-P107 (daemon onIngest stub) and F-P201 (Channel 5 broken in adapter) and F-P106 (federation-startup doesn't thread extractionDb to offerer). The wiring-manifest test catches "no name" but not "no invocation" (F-P110) or "wired but inert" (F-P107). Need a stronger structural test.
2. **Cluster D privacy is still leaky-by-default at the lib level.** F-P219: conflict-surfacing and promotion-candidates have no privacy filter. F-P415: concept-mentioned schema field declared but undefined data flow. The "private by default" principle isn't structurally enforced — each new query has to remember to filter.
3. **DoS surface in schemas.** F-P404–407 are all the same shape: unbounded strings/arrays/numbers admit attacker-controlled allocation before downstream rejection. Schema bounds are cheap and should be the first line of defense.
4. **Forward-compat is unimplemented.** F-P403 + F-N14: `event_version` exists as a number but no code dispatches on it. The `.strip()` default means new fields silently disappear on round-trip across federation.
5. **The consolidation cycle is the largest perf liability.** F-P203 (recency cap missing × 2), F-P213 (N×5 subqueries), F-P215 (overlapping cycles), F-P206 (graph rebuild can be aborted by reader). Each is independently fixable but the combination on a large vault probably explains real-world cycle timeouts.

---

## What to act on this pass

Recommended fix order:

1. **F-P107/P113** — defer or non-durable subscriber; events being lost
2. **F-P201** — Channel 5 broken (one-line fix)
3. **F-P401, F-P402, F-P403** — schema/sign integrity (three commits)
4. **F-P101, F-P102, F-P103** — daemon startup robustness
5. **F-P203, F-P206, F-P215** — consolidation perf cliff
6. **F-P404–407** — schema DoS bounds
7. **F-P301, F-P302** — wrapper cross-tenant + frontend divergence
8. **F-P208, F-P411** — observability + atomicity
9. Remainder by triage

The test scaffolding (Tier-2 auth-boundary suite, peer-trust helper, sign-fixture helper) from TESTING_PROTOCOL.md is still pending. Some of these fixes (F-P401, F-P408) would benefit from those scaffolds being in place first.

---

*Continuation: REVIEW_PASS_2.md after pass-1 fixes land.*
