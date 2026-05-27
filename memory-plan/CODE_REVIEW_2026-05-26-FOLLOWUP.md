# OpenClaw Memory Plan — Follow-up Code Review

**Date:** 2026-05-26 (afternoon, post-remediation round)
**Reviewers:** 4 parallel general-purpose audit agents
**Scope:** Same as original (Block 6–10 modules + supporting infra). This review focuses on (a) regressions introduced by the earlier remediation round, (b) net-new bugs, (c) latent issues. Also incorporates test-suite triage and storage audit.
**Methodology:** Each agent re-read assigned files end-to-end, paying special attention to commits in the 2026-05-26 remediation round (`F-C*` / `F-H*` / `F-M*` references in commit subjects). Findings cite `file:line` and ship with suggested fixes.

---

## Headline

**The previous remediation round shipped working leaf-level fixes but a meaningful fraction of them are not actually exercised in production.** Two distinct failure modes account for most of the regressions:

1. **"Not wired"** — code was written and tested in isolation but never called from a daemon entrypoint. The most severe case: **`createBroadcaster`/`createOfferer`/`createAcceptor` are not instantiated anywhere outside tests.** The entire Block 9/10 federation layer — including all of Cluster A's signing/auth/replay work — is dead code at runtime. (F-N1, F-N2, F-N3)
2. **"Partial-fix"** — a helper accepts a new option (e.g. `respectPrivacy`, `signal`, `requireSigned`) but the live caller doesn't pass it. The privacy filter exists and works correctly when invoked, but `retrieve()` invokes it without the option set, so it's a no-op (F-N50). The consolidation hard-cap signal is passed to `runCycle()` but destructured away (F-N100). The acceptor was supposed to get the same ack/nak treatment as the offerer (F-H1) but didn't (F-N4).

**Total new findings: ~70.** Severity distribution:

| Severity | Count | Notes |
|---|---:|---|
| CRITICAL | 9 | 7 of these are regressions of previously-claimed-fixed items |
| HIGH | 15 | 4 regressions; one is a third occurrence of the same privacy bug class |
| MEDIUM | 22 | |
| LOW | 24 | |

**Previously-claimed fixes flagged as incomplete:**
- **F-C2** (verifyEvent missing-signature behavior) — F-N13 (legacy 1-arg shape still allows unsigned)
- **F-C6** (wait-timeout aborts in-flight) — F-N103 (orphaned job still holds queue slot)
- **F-C8/C10** (recall scoring data path) — F-N52 (read mention.salience, write entity.salience — loop still inert)
- **F-C12** (privacy in queryRelevant\*) — F-N50 (helper takes opt but retrieve never passes it)
- **F-C13** (chunk-grain privacy) — F-N51 (only channels 3/4/5 filter; channels 1/2 bypass; fails OPEN)
- **F-H1** (ack/nak by outcome) — F-N4 (applied to offerer, never to acceptor)
- **F-H8** (eager dedup rollback) — F-N5 (signing-error path missing rollback)
- **F-H14** (recency cap in self-joins) — F-N150 (index added, recency filter never landed)
- **F-H19** (hard-cap AbortController propagated) — F-N100 (signal destructured away in runConsolidationCycle)
- **F-M1** (loopPromise on stop) — F-N6 (applied to offerer, never to acceptor)
- **F-M6** (LLM summary observability) — F-N110 (counters in offerer; consolidation summaries still silent)

**Three independent occurrences of the same privacy bug class** (entities marked `private:1` leaking into a user-facing surface): F-N50 (retrieve helpers), F-N51 (retrieval channels 1+2), F-N102 (Obsidian vault notes). Cluster D is a structural problem, not isolated bugs.

**Test suite:** 68 of ~900 tests fail. 61 are trivial fixture-signing breaks (one before/after hook fixes each suite). 6 are real integration bugs in `fed-2node`/`fed-3node` needing a product decision on peer-trust bootstrap. 1 is a stale sort-order assumption.

---

## Federation findings (F-N1 – F-N23)

### CRITICAL

#### F-N1 — Federation modules NEVER instantiated in production
**File:** `lib/broadcast-{emitter,offerer,acceptor}.mjs` (no production callers)
`grep -r "createBroadcaster\|createOfferer\|createAcceptor" bin/ lib/memory-*.mjs` returns zero hits. The federation factories are imported only by `test/`. None of the daemon entrypoints wire them. The "deployed multi-node federation" claim is hollow at runtime.
**Fix:** Add a federation startup module the memory daemon imports — `createBroadcaster(nc, nodeId, { identity, log })`, `createOfferer(nc, nodeId, { identity, registry, seenIds, retrievalPipeline })`, `createAcceptor(nc, nodeId, { identity, registry, seenIds, ownBroadcastIds })`.

#### F-N2 — REGRESSION (F-C3): Identity registry never constructed; binding inert
**File:** `lib/node-identity.mjs:153` (definition); no production caller
`createIdentityRegistry` is exported but never invoked. Factories accept `opts.registry` and pass through to `verifyEvent`; when null (default), the binding check at line 447 is skipped (`if (opts.registry) { ... }`). Any peer can sign with their own key and set `node_id: "alice"`. Same is true of `seenIds` — F-C4 replay protection is bypassed identically.
**Fix:** At daemon startup, build registry + seenIds and thread through.

#### F-N3 — Registry default mode is TOFU; first-contact-wins spoofing
**File:** `lib/node-identity.mjs:155`
Default `mode = 'tofu'`. An attacker reaching the shared NATS stream before alice's first publish becomes the trusted "alice-node"; the real alice is then locked out (`pubkey-mismatch`). No out-of-band identity exchange, no operator-seeding tooling.
**Fix:** Default to `'strict'` in production. Provide `bin/openclaw-trust-peer <nodeId> <pubkeyBase64>` CLI. Document onboarding flow.

#### F-N4 — REGRESSION (F-H1): Acceptor unconditionally acks; transient failures dropped
**File:** `lib/broadcast-acceptor.mjs:520-533`
F-H1's outcome-driven ack/nak was applied to offerer but acceptor still unconditionally `msg.ack()` after both success and catch. Transient processing failures get permanent-acked, dropping JetStream redelivery. A peer can DOS by sending malformed offers that get permanently acked.
**Fix:** Mirror the offerer's `outcome = 'ack' | 'nak'` pattern.

### HIGH

#### F-N5 — REGRESSION (F-H8): Signing-error path skips dedup rollback
**File:** `lib/broadcast-emitter.mjs:249-253`
The eager `dedupMap.set` is rolled back on validation-error and publish-error, but the signing-error catch returns `suppressed:true` without rolling back. A transient signing failure suppresses the dedupKey for 15 min — legitimate broadcast can't be retried.
**Fix:** `if (dedupMap.get(dedupKey) === setEagerly) dedupMap.delete(dedupKey);` before the return.

#### F-N6 — REGRESSION (F-M1): Acceptor lacks loopPromise tracking
**File:** `lib/broadcast-acceptor.mjs:520-539, 566-580`
Offerer was updated; acceptor still uses unawaited `(async () => { ... })()`. `stop()` can't guarantee the in-flight handler finished.
**Fix:** Mirror offerer pattern — capture `loopPromise`, await with timeout in stop.

#### F-N7 — Unauthenticated `offerer_node_id`
**File:** `lib/broadcast-acceptor.mjs:301-302, 336-339`
Signer can claim any `offerer_node_id` in payload — polluting peer-tracker, attributing peer-memory blocks to wrong author. Registry binds `event.node_id ↔ signer_pubkey`, not `data.offerer_node_id`.
**Fix:** Assert `offerData.data?.offerer_node_id === offerData.node_id` before recording peer. Same for broadcast actor.id.

#### F-N8 — `checkAcceptance` async race produces double-publish
**File:** `lib/broadcast-acceptor.mjs:373-485`
Two concurrent invocations can both pass `bestKey` selection, both `js.publish`. `pendingOffers.delete(bestKey)` is idempotent so the second deletion no-ops; but JetStream sees two distinct accepted events.
**Fix:** `inFlightAcceptance.set(bestKey, true)` sync before await; skip if already in-flight.

#### F-N9 — `ttl_minutes` schema unbounded; `Infinity` bypasses expiry
**File:** `packages/event-schemas/src/broadcast/context-broadcast.ts:11`
`z.number()` accepts `Infinity`. `Date.now() - ts > Infinity * 60_000` is always false; broadcast never expires locally (24h sig freshness still caps it, but intent bypassed).
**Fix:** `z.number().int().positive().max(60 * 24)`. Same audit for `expires_at`.

#### F-N10 — No peer key rotation path
**File:** `lib/node-identity.mjs:207-224`
Once node_id↔pubkey is recorded, all future events with a different `signer_pubkey` → permanent rejection. Key rotation locks legitimate peer out forever. No revocation, no adoption protocol.
**Fix:** Plan `identity.rotated` event signed by both old and new keys; registry records both in grace period. Until then, document manual `bin/openclaw-trust-peer` flow on every peer.

#### F-N11 — `peerTracker.recordSeen` honors unauthenticated peer-id; unbounded growth
**File:** `lib/broadcast-offerer.mjs:357-364`
Without registry binding, attacker floods peerTracker with fake peerIds. Cleanup every 5 min only if autoCleanup is on — federation paths don't set it.
**Fix:** Defer recordSeen until after registry binding succeeds; cap Map size with LRU.

### MEDIUM

| ID | File | Issue |
|---|---|---|
| F-N12 | `node-identity.mjs:324-339` | `signEvent` silently overwrites existing signature (no detection of double-sign in logs) |
| F-N13 | `node-identity.mjs:402-414` | REGRESSION (F-C2): legacy 1-arg `verifyEvent(event)` returns `true` for missing sig "for backward compat" — footgun for non-federation callers |
| F-N14 | `broadcast-offerer.mjs:339-346` | `.parse()` strips unknown keys; future schema versions silently lose data |
| F-N15 | `node-identity.mjs:465-472` | `seenIds.add` in verify rejects JetStream redelivery as replay; combine with F-N4 makes redelivery lossy |
| F-N16 | `node-identity.mjs:99-104` | `getOrCreateIdentity` race-loser doesn't persist pubkey file |
| F-N17 | `local-event-log.mjs:67-81` | Local events signed but never verified on read; signing is security-theater on local path |
| F-N18 | `federation-resilience.mjs:178-189` | Dead Array-path in cleanupExpiredOffers; silently returns 0 on unknown input shape |
| F-N19 | `broadcast-acceptor.mjs:114-132` | Per-string sanitize cap exists but no per-block total cap; peer can inflate prompt by 3 KB |
| F-N20 | `broadcast-{offerer,acceptor}.mjs` | `await import()` in hot per-message path; module cache resolves fast but each adds microtask boundary |

### LOW

| ID | File | Issue |
|---|---|---|
| F-N21 | `broadcast-emitter.mjs:43-128` | `inferIntensity`/`inferProblemClass` regexes English-only |
| F-N22 | all three federation modules | `stats` returned by reference; concurrent mutation observable |
| F-N23 | `local-event-log.mjs:18` | CJS `_require('./tracer')` while rest of file is ESM |

---

## Retrieval/Injection findings (F-N50 – F-N70)

### CRITICAL

#### F-N50 — REGRESSION (F-C12): `respectPrivacy` not threaded into retrieve
**File:** `lib/memory-injector.mjs:530-531`
`queryRelevantConcepts/Decisions` accept `respectPrivacy` opt (F-C12 added it). Production `retrieve()` calls both with NO opts. Concepts and decisions returned to formatter still include private items. Unit tests exercise helpers directly, masking the gap.
**Fix:** Thread `respectPrivacy` (default true) through `retrieve(prompt, opts)` → both helpers AND `pipeline.retrieve({respect_privacy})`.

#### F-N51 — REGRESSION (F-C13): Privacy filter session-grain, fails OPEN, bypassed by 2/5 channels
**File:** `lib/retrieval-pipeline.mjs:409-452, 544-546`
F-C13 narrative claimed chunk-grain SQL JOIN. Only true for channels 3/4/5; channels 1 (FTS) and 2 (semantic embedding) bypass `findMatching*` and pull raw `session_chunks`. Post-fusion `filterPrivateResults` still session-grain — keeps any session with at least one public entity. All 4 catch blocks fail OPEN. Single private chunk in otherwise-public session leaks.
**Fix:** Push privacy into the chunk SQL (JOIN mentions WHERE entity.private=0 on the matched chunk_id), OR maintain private-chunk denylist post-fusion. Always return `[]` on error.

### HIGH

#### F-N52 — REGRESSION (F-C8/C10): Reconsolidation read/write target divergence
**File:** `lib/memory-injector.mjs:91-100, 327-345`
`queryRelevantConcepts` reads `AVG(m.salience)` from mentions; `writeBackReconsolidation` updates `entities.salience` on entities. The read never sees the write. Decay also operates on `entities.salience` — also invisible to recall. The "biological forgetting loop" doesn't close.
**Fix:** Pick one source. Simpler: read `e.salience` directly; let mentions be count-only.

#### F-N53 — `@memory only:X` cartesian join makes filter all-or-nothing
**File:** `lib/memory-injector.mjs:509-513`
Themes table has no session linkage. `JOIN themes t ON 1=1` cartesians every mention with every theme. `LIKE` then keeps all input sessions if matching theme exists anywhere, drops everything otherwise. Opposite of user expectation.
**Fix:** Either add `theme_mentions` linkage, reinterpret against entities/decisions, or return 400 + mark unimplemented.

#### F-N54 — `recallScore` NaN propagation silently corrupts curation
**File:** `lib/memory-injector.mjs:222-249`
Corrupt timestamp → `new Date().getTime() = NaN` → all-NaN score → V8 sort places unpredictably → writeBack updates whatever survived. No clamp on salience.
**Fix:** Bounded coercion: `salience = Math.max(0, Math.min(1, raw))`, NaN recency → 0 (suppresses item), guard negative mention_count.

### MEDIUM / LOW

| ID | Sev | File | Issue |
|---|---|---|---|
| F-N55 | MED | `memory-injector.mjs:287-313` | curateForRecall doesn't enforce budget when concepts+decisions exceed it |
| F-N56 | MED | `memory-injector.mjs:418-433` | Lazy llmClient permanent-fails after first throw (rejected promise memoized) |
| F-N57 | MED | `memory-injector.mjs:607-633` | `formatDegradedWarning` mode allowlist suppresses warning even with fallbackReason set |
| F-N70 | MED | `publishers/openai-wrapper.mjs:77` | `@memory only:X` query semantics diverge between openai-wrapper and inject-server |
| F-N58 | LOW | `memory-injector.mjs:260-265` | `inhibitWithinGroup` spread/rest drops symbol keys, clobbers any user `_score` |
| F-N59 | LOW | `memory-inject-server.mjs:101-104` | Bearer loopback check uses `.includes()` not exact match |
| F-N60 | LOW | `retrieval-pipeline.mjs:229-244` | 20 theme LIKE scans; dead code at 245-257 |
| F-N61 | LOW | `retrieval-pipeline.mjs:131-138` | `getChunksForSessions` returns most-recent globally, not per-session (F-M11 still open) |
| F-N62 | LOW | `retrieval-pipeline.mjs:502-515` | Channel failures silent; no channel-error counter feeding degraded warning |
| F-N63 | LOW | `memory-directives.mjs:28, 48-73` | `@memory only:` regex breaks on quotes/spaces/newlines/multiple directives |
| F-N64 | LOW | `memory-inject-server.mjs:130-147` | No content-type enforcement on POST |
| F-N65 | LOW | `memory-inject-server.mjs:126, 130` | `req.url === '/memory/inject'` brittle on query strings, trailing slash |
| F-N66 | LOW | `memory-formatter.mjs:89-118` | Warning-only block (no items) might surprise callers |
| F-N67 | LOW | `memory-formatter.mjs:161-174` | `injectIntoMessages` shallow-copy semantics; doc immutability contract |
| F-N68 | LOW | `retrieval-pipeline.mjs:519-539` | Sync channels not wrapped in async IIFE; one throw at construction crashes Promise.all |
| F-N69 | LOW | `memory-injector.mjs:294 vs 317` | TDZ smell: `OVERHEAD_TOKENS` referenced before declaration |

---

## Queue/Lifecycle findings (F-N100 – F-N117)

### CRITICAL

#### F-N100 — REGRESSION (F-H19): Hard-cap signal lost in destructure
**File:** `bin/consolidation-scheduler.mjs:158-163` + `bin/consolidate.mjs:44-91`
`runCycle()` receives `signal: ac.signal`; `runConsolidationCycle()` destructures only `{dbPath, vaultPath, dryRun, db}`. The 6 cycle steps have no abort plumbing. 5-min hard cap fires, `Promise.race` rejects, but cycle keeps running on the same DB. Two 30-min ticks can stack overlapping cycles racing on the same SQLite handle.
**Fix:** Thread `signal` through `runConsolidationCycle` and each step. Check `signal.aborted` in loops. Stop claiming F-H19 fixed in scheduler doc until real.

#### F-N101 — Consolidation `regenerateSummaries` can't fit in hard cap
**File:** `lib/obsidian-summarizer.mjs:147` + `lib/consolidation.mjs:328-338`
`generateConceptSummary` uses `client.generate()` (extraction queue — no fallback, no wait timeout) sequentially per concept. 50 concepts × 5s = 250s already. Under contention each can hit the 5-min Ollama runner deadline. With MAX_PENDING=50, mid-loop "queue full" silently swallowed (F-N110). Cycles routinely time out and half-update the vault.
**Fix:** Use `generateAnalysis` (with data-only fallback) OR cap per-cycle summary count to top-N by recent mention growth OR run summaries outside hard-cap window with own scheduler. Track partial progress for resume.

#### F-N102 — Obsidian summarizer leaks private entities to vault
**File:** `lib/obsidian-summarizer.mjs:167-172, 280-303`
`queryConceptData` query: `SELECT ... FROM entities WHERE mention_count >= ?` — no `AND private = 0`. Every private entity above threshold becomes a markdown note in vault (likely synced to iCloud/Dropbox). Same problem in `coMentioned`, `decisions`, `recentSessions` sub-queries. Third occurrence of the Cluster D pattern.
**Fix:** Add `AND (private = 0 OR private IS NULL)` to all 5 prepared statements. Add `respectPrivacy` opt (default true) to `generateConceptNotes`.

### HIGH

#### F-N103 — REGRESSION (F-C6): Aborted analysis still holds queue slot
**File:** `lib/ollama-queue.mjs:215-231`
Wait-timeout fires, `queueController.abort()` signals fetch — but `jobPromise` only settles when `executeJob`'s `finally` runs. If Ollama doesn't honor signal mid-stream (often the case), `currentJob` stays populated. F-C6's "slot held" bug is reduced but not eliminated.
**Fix:** When wait-timeout fires, defensively clear `state.currentJob` or set `abandoned: true` flag. Make `executeJob`'s `finally` idempotent.

#### F-N104 — Queue shutdown is one-shot; never resettable
**File:** `lib/ollama-queue.mjs:372-390`
`state.shuttingDown` never reset outside `_resetForTesting`. No public restart. Latent footgun for any future reload/restart story.
**Fix:** Document explicitly that shutdown is final, OR reset `shuttingDown = false` after rejection sweep.

#### F-N105 — Stuck-detection regex false-trips on benign errors → destructive ollama restart
**File:** `lib/ollama-queue.mjs:114-119, 334-336`
`/timeout|aborted/i.test(err.message)` matches schema errors mentioning "timeout", 500 bodies containing "aborted", etc. Three such matches → `isStuck()` true → health-watch evicts healthy model.
**Fix:** Use `err.name === 'AbortError' || err.code === 'ETIMEDOUT' || err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT'` or compare elapsed time against EXTRACTION_TIMEOUT_MS.

#### F-N106 — Backfill checkpoint poisoned by queue-full rejections
**File:** `bin/extract-existing-sessions.mjs:182-197`
Every error → `checkpoint.failed`. Next run skips. Queue-full (F-C7 cap) is transient pressure but marked permanent.
**Fix:** Classify error type. Only schema/parse failures are permanent. Add retry hook for transient previously-failed.

#### F-N107 — `memory-subscriber` acks without `onIngest` consumer; events evaporate
**File:** `bin/memory-subscriber.mjs:172-211`
If caller forgets `onIngest`, events stream by stats-counted but no projection happens; permanently acked from JetStream. The "silent no-op" pattern called out in F-N1.
**Fix:** Throw if missing OR skip ack when no consumer wired.

### MEDIUM / LOW

| ID | Sev | File | Issue |
|---|---|---|---|
| F-N108 | MED | `health-watch.mjs:123-160` | TOCTOU between `isStuck()` and `recordAutoRestart()` |
| F-N109 | MED | `consolidation-scheduler.mjs:204-229` | `runOnce` checks idle at start only; LLM calls within cycle compete with user prompts |
| F-N110 | MED | `consolidation.mjs:328-338` | REGRESSION (F-M6 not applied): `regenerateSummaries` silently swallows errors |
| F-N111 | MED | `extraction-trigger.mjs:93-105` | Subscription failure on bad UTF-8 silently kills loop; `running=true` lingers |
| F-N112 | MED | `llm-client.mjs:120-155` | `generate()` (extraction) ignores `opts.abortSignal`; no path to abort an extraction |
| F-N113 | MED | `ollama-queue.mjs:372-390` | `shutdown()` doesn't abort in-flight; SIGTERM hangs 30s then SIGKILL loses progress |
| F-N114 | LOW | `llm-client.mjs:207, 253` | `waitTimeoutMs ?? 1000` read twice; `0` swallowed |
| F-N115 | LOW | `ollama-queue.mjs:256-269` | `runWithRetry` reuses aborted signal across retries |
| F-N116 | LOW | `health-watch.mjs:56-74` | New NATS connection per alert; FD churn |
| F-N117 | LOW | `memory-subscriber.mjs:215-220, 254-262` | `stop()` can hang on idle JetStream; depends on `iter.stop()` semantics |

---

## Storage findings (F-N150 – F-N158)

### MEDIUM

- **F-N150** — REGRESSION (F-H14): `reinforceCoOccurrence` index added but recency `WHERE created_at >= ?` filter never landed. (`consolidation.mjs:186-198`)
- **F-N151** — `themes.parent_id` self-FK has no CASCADE; latent footgun for future hierarchy ops. (`extraction-store.mjs:67`)
- **F-N153** — `ha_telemetry_proposals` junction has no `ON DELETE`. Same class as F-H13. (`hyperagent-store.mjs:121-125`)
- **F-N155** — No schema versioning anywhere. No `user_version`, no `_meta` table. Downgrades silently corrupt; partial migrations have no recovery. (3 stores affected)
- **F-N157** — No backup/restore code path. No `wal_checkpoint` on shutdown, no `integrity_check` on startup, no `.backup()`. Matters for consumer-HW target.

### LOW

- **F-N152** — `hyperagent-store.mjs` migration not atomic; benign today, footgun for multi-process opens.
- **F-N154** — `consolidation.entities_archived` schema redefined independently of `entities` table. Silent drift on next column add.
- **F-N156** — `session-store.mjs`/`extraction-store.mjs` lack `busy_timeout`. WAL serializes writers but the default-0 busy timeout means concurrent writers throw `SQLITE_BUSY`.
- **F-N158** — `obsidian-graph-cache.mjs` clear-then-rebuild not transactional; crash mid-rebuild leaves empty cache (silent feature disablement, see F-C14 precedent).

### Existing findings status

| ID | Status |
|---|---|
| F-C15 (privacy NULL migration) | FIXED |
| F-C16/F-H13 (decayWeights FK throw) | FIXED |
| F-C17 (graph edges UNIQUE) | FIXED |
| F-H9 (FK no CASCADE) | DEFERRED per user (still scoped to 7 places) |
| F-H10 (FTS5 triggers) | FIXED |
| F-H11 (FTS5 sanitizer) | FIXED |
| F-H12 (ON CONFLICT overwrites type) | FIXED |
| F-H14 (self-joins O(N²)) | PARTIAL — index landed, recency filter didn't (F-N150) |

---

## Test suite triage (68 failures of ~900 tests)

### Breakdown

| Category | Count | % | Fix complexity |
|---|---:|---:|---|
| REORDER_BREAK — unsigned fixtures rejected as `bad_signature` | 52 | 76% | TRIVIAL (4 file edits) |
| REORDER_BREAK — broadcaster has no identity → `unsigned_refused` | 9 | 13% | TRIVIAL (1 file edit) |
| Cascade failures (test uses upstream-broken return value) | 4 | 6% | (resolved by fixing root cause) |
| BUG — verified-signed path failing in fed-2node/3node | 6 | 9% | MODERATE — needs peer-registry decision |
| STALE_FIXTURE (block3-validation sort order) | 1 | 1% | TRIVIAL |

### Hot-spots

- `test/broadcast-acceptor.test.mjs` — 10 failures, all unsigned fixture
- `test/broadcast-offerer.test.mjs` — 10 failures, all unsigned fixture
- `test/broadcast-cross-node.test.mjs` — 8 failures, all unsigned fixture
- `test/broadcast-emitter.test.mjs` — 7 failures, all missing-identity
- `test/federation-resilience.test.mjs` — 3 failures, all unsigned fixture
- `test/federation-2node.test.mjs` — 4 failures (2 unsigned, 2 BUG)
- `test/federation-3node.test.mjs` — 4 failures (all BUG)
- `test/block3-validation.test.mjs` — 1 failure, stale sort

### Root cause of the 6 BUGs (fed-2node/3node)

Tests sign broadcasts via `signEvent` but never register `identityA.publicKeyBase64` with node B before the call. The offerer's strict-mode `verifyEvent` requires the signer's pubkey to be in `registry`. Tests fail as `'skip' !== 'offered'`. This forces a product decision: does the offerer auto-trust any well-signed peer (TOFU), or require explicit `registry.trust(nodeId, pubkey)` registration? Tests are a forcing function. (See F-N3 for the security implications of either choice.)

---

## What you should treat as urgent

The **8 CRITICALs that are also "not wired"** are the highest-leverage fixes:

1. **F-N1** + **F-N2** + **F-N3** — wire federation, build registry+seenIds, default to strict mode. Until this lands, **Block 10 is not delivered.**
2. **F-N50** + **F-N51** + **F-N102** — three separate privacy leaks. Cluster D needs structural fix, not patches.
3. **F-N100** + **F-N101** — consolidation cycle can't finish under load and can't be cancelled.
4. **F-N4** + **F-N103** + **F-N105** — queue/acceptor lifecycle correctness regressions.

The **15 HIGHs** are mostly real but can wait behind the criticals.

The **22 MEDIUMs / 24 LOWs** include several that became visible only because we looked closely; budget them for cleanup batches rather than per-bug remediation.

---

*See `TESTING_PROTOCOL.md` for the testing strategy designed in response to these findings.*
