# OpenClaw Memory Plan — Third-Wave Review (Pass 2)

**Date:** 2026-05-27
**Reviewers:** 4 serial general-purpose audit agents (post-pass-1 fix landing)
**Scope:** Re-audit all of `lib/` + `bin/` with awareness of pass-1 corrections. Find regressions, edge cases, and latent issues not yet surfaced.

---

## Headline

**83 new findings.** The "fix-at-leaf-not-wired-at-call-site" pattern hit again — most damagingly in **F-Q201 / F-Q301 / F-Q404**, which are three views of the same bug: the F-N51 chunk-grain privacy filter joins on `mentions.turn_index` but the entire extraction chain never produces that field. The fix landed correctly at the consumer side and is structurally inert in production.

Two CRITICAL findings I introduced in pass-1 are **already hotfixed**:
- **F-Q101** — my F-P404 regex rejected common macOS hostnames (`Guillaume's-MacBook-Pro`). Federation would silently fail to publish on the developer's own Mac. Hotfixed in commit `9a4396d` (defaultNodeId sanitization).
- **F-Q201** — privacy filter stopgap to treat sessions-with-private-mentions as fully private when turn_index is null. Hotfixed in same commit.

Three recurring patterns dominate the remaining findings:
- **Fix-at-leaf-not-wired-at-producer-side** (4 instances total: F-C14, F-P201, F-Q201, F-Q404)
- **Test-mock-masks-production-shape** (3 instances: F-P201, F-Q201, F-Q405)
- **Atomic-write inconsistency** — 5 different implementations of "atomic file write" across the repo, only 2 with `fsync` (F-Q205, F-Q313, F-Q409, F-Q410, F-Q411)

**Severity distribution:**

| Severity | Count |
|---|---:|
| CRITICAL | 9 |
| HIGH | 22 |
| MEDIUM | 31 |
| LOW | 21 |

**Status of pass-1 fixes re-verified:**

| Pass-1 ID | Status | Notes |
|---|---|---|
| F-P101 (registry self-trust force) | HOLDS | |
| F-P102 (daemon cleanup closure) | HOLDS | |
| F-P103 (early signal handlers) | HOLDS | |
| F-P104 (broadcaster.stop in fed.stop) | HOLDS | |
| F-P201 (Channel 5 adapter) | HOLDS | Both shapes work; `target_id` confirmed real field name |
| F-P209 (waitTimeoutMs 12s) | HOLDS | |
| F-P403 (.passthrough) | HOLDS but enables F-Q106 (no event_version dispatch) |
| F-P404 (envelope regex) | **REGRESSION** — F-Q101 (hotfixed) |
| F-P411 (atomic save) | PARTIAL — F-Q411 missing fsync + F-Q105 tmp filename collision |
| F-N51 (chunk-grain privacy) | **REGRESSION** — F-Q201/Q301/Q404 (hotfixed via stopgap) |
| F-N52 (recall read/write target) | PARTIAL — F-Q204 races consolidation (no busy_timeout) |
| F-N100 (hard-cap signal) | PARTIAL — F-Q307 swallows AbortError as not-aborted |
| F-N102 (vault privacy) | HOLDS on read; F-Q205/Q409 on write atomicity |
| F-N103 (currentJob cleanup) | HOLDS; F-Q308 notes benign race window |
| F-N106 (backfill error class) | PARTIAL — F-Q303 (queue-shutdown=transient), F-Q304 (regex false-match on 5xx body) |
| F-N107 (onIngest mandatory) | **REGRESSION** — F-Q302 (no-op fn passes type check; daemon stub does exactly this) |
| F-N150 (recency cap) | HOLDS in fix but F-Q407 (no index on created_at) |
| F-N155 (schema versioning) | **REGRESSION** — F-Q401 (still no versioning) |
| F-N156/157 (busy_timeout, integrity) | **REGRESSION** — F-Q403 (multiple stores still lack busy_timeout) |
| F-P206 (graph-cache busy_timeout) | HOLDS |
| F-P208 (mid-loop abort) | PARTIAL — F-Q307 |
| F-P210 (promotion dedup) | HOLDS (depends on published_items presence) |
| F-P215 (scheduler stack guard) | PARTIAL — F-Q306 (no max-age on currentRun) |

---

## CRITICAL (9) — what to fix this round

### F-Q101 — HOTFIXED `9a4396d`
`defaultNodeId()` now sanitizes hostname; lowercase + non-allowed chars → `-`. macOS hostnames work.

### F-Q201 — HOTFIXED `9a4396d`
Privacy filter stopgap: treat any session with private mentions as fully private when turn_index is null. The proper fix needs the extractor to populate turn_index (see F-Q404).

### F-Q102 — `signEvent` re-sign throw indistinguishable from real signing errors
**File:** `lib/node-identity.mjs:375-381` + call sites in emitter/offerer/acceptor
Distinguish via `err.code = 'ALREADY_SIGNED'`. Call sites should treat that as a logic bug (telemetry) vs. real crypto error (fatal). Currently both surface as `signing_error` and infinite-retry.

### F-Q103 — `publishedIds` cap-by-count (1024) mismatched to offer expiry (60 min)
**File:** `lib/broadcast-emitter.mjs:178-179, 291-295`
A daemon emitting 1 broadcast/sec wipes the visible window to ~17 min — less than the offer expiry. Offers for older broadcasts get dropped as `not_our_broadcast`. **Fix:** age-based eviction instead of count-based, matching offer expiry. Map<event_id, publishedAt>; sweep entries older than `offer_expiry_min` periodically.

### F-Q301 — Extractor never has turn_index; F-N51 chunk-grain inert at producer
**Files:** `lib/extraction-store.mjs:264`, `lib/extraction-prompt.mjs:225-233`, `bin/extract-existing-sessions.mjs:166`, `lib/pre-compression-flush.mjs:371-388`
The whole chain (transcript-parser → pre-compression-flush → extract-existing-sessions → extraction-prompt → storeExtractionResult) drops turn_index. The LLM extraction prompt doesn't ask for per-turn attribution either. **Options:** (a) cheap-wrong-grained: stamp last_turn_in_tail; (b) prompt-the-LLM-for-citations (expensive but right); (c) compromise: store min/max turn range per mention. The hotfix for F-Q201 covers the leak; this is the architectural debt.

### F-Q302 — F-N107 still escapable: `onIngest: () => {}` passes type check
**File:** `bin/memory-subscriber.mjs:132-138`
The function-typecheck is paper-thin. The daemon at `openclaw-memory-daemon.mjs:115` literally supplies a logging stub that does this. **Fix:** require `onIngest` to return a discriminated union `{ok: true} | {ok: false, transient?: boolean}` so the subscriber explicitly knows to ack vs. nak. Or: at minimum, detect short stubs and warn loudly at startup.

### F-Q401 — REGRESSION (F-N155): no schema versioning anywhere
**Files:** all three stores
Downgrade silently corrupts; partial migrations leave inconsistent state; tests can't assert "DB at version X." **Fix:** add `schema_meta(version, applied_at)` per DB; wrap migration blocks in transactions; refuse to open a DB whose version exceeds what current code knows.

### F-Q402 — REGRESSION (F-N157): still no integrity_check / wal_checkpoint / backup
**Files:** all three stores
Consumer-HW target (per user's deployment note) makes this real risk. **Fix:** `db.pragma('integrity_check')` at startup; `wal_checkpoint(TRUNCATE)` on graceful shutdown; expose `store.backup(toPath)`.

### F-Q403 — REGRESSION (F-N156/F-Q204/F-Q314): extractionDb lacks busy_timeout on 3 of 4 callers
**Files:** `lib/extraction-store.mjs:46-49`, `lib/session-store.mjs:51-54`, `bin/openclaw-memory-daemon.mjs:94-95`, `bin/consolidate.mjs:63-83`
Consolidation scheduler + inject-server reconsolidation race on SQLITE_BUSY → recall writes silently fail → biological forgetting loop never closes despite F-N52's "fix." **Fix:** extract `openSqliteStore(path)` helper that ALWAYS sets WAL + foreign_keys + busy_timeout.

---

## HIGH (22) — high-leverage fixes

Three shared helpers, if extracted, absorb a large fraction:

### Helper 1: `lib/atomic-write.mjs` — `atomicWriteFile(path, content, opts)`
Pattern: openSync(tmp, wx) + writeSync + fsyncSync + closeSync + renameSync. Use the kanban-io.js pattern (fsync before rename). Absorbs:
- **F-Q205 / F-Q409** vault note writes (`obsidian-summarizer.mjs:369`)
- **F-Q313 / F-Q410** backfill checkpoint (`extract-existing-sessions.mjs:60-69`)
- **F-Q411** registry save fsync gap (`node-identity.mjs:181-197`)
- **F-Q105** registry save tmp filename collision (per-pid suffix or wx flag)
- F-Q211 token file TOCTOU (memory-inject-server.mjs:51-59)

### Helper 2: `lib/concurrency-guard.mjs` — `withConcurrencyGuard(fn)`
Tracks an in-flight promise; subsequent calls log + skip. Absorbs:
- **F-Q406** graph-cache refresh stacking (`obsidian-graph-cache.mjs:225-258`) — same shape as F-P215 (already fixed inline in scheduler)
- **F-Q306** scheduler currentRun no max-age — add `Promise.race([fn, timeout])` inside the helper

### Helper 3: `lib/sqlite-store.mjs` — `openSqliteStore(path, opts)`
Always WAL + foreign_keys + busy_timeout=5000 + integrity_check on open. Absorbs:
- **F-Q401 / F-Q402 / F-Q403** schema versioning + integrity + busy_timeout
- F-Q419 (kanban-store)
- F-Q314 (runConsolidationCycle owned DB)
- F-Q204 (inject-server extractionDb)
- 16 grepped raw `new Database(...)` call sites

### Federation HIGHs (not absorbed by helpers)

- **F-Q102** signEvent error class — see CRITICAL above
- **F-Q104** pendingOffers pinned by evicted broadcasts → cleanup must check ownBroadcastIds presence
- **F-Q106** `event_version` dispatch missing → add `verifyEvent` refine for `event_version > MAX_SUPPORTED`
- **F-Q107** acceptor signs but recipient peers can't verify without explicit trust → operator visibility metric
- **F-Q108** F-P413/F-P414 enum extensions are dead-letter (producers never set `'broadcast'` / `'peer'`)
- **F-Q303** queue-shutdown classified as transient in backfill → infinite retry next run
- **F-Q304** backfill regex false-matches `fetch failed` inside HTTP 500 body → permanent-failure misclassified as transient

### Retrieval/Lifecycle HIGHs

- **F-Q202** filterPrivateResults bypassed entirely when extractionDb is null → explicit `assume_public` opt OR fail-closed
- **F-Q203** RRF weighted fusion has score scale mismatch — channels produce different score scales but only rank is used; downstream recallScore caps at ~0.08
- **F-Q204** inject-server reconsolidation races consolidation scheduler (no busy_timeout) — absorbed by helper 3
- **F-Q305** retry delays don't observe shutdown signal
- **F-Q307** regenerateSummaries swallows AbortError as `aborted: false` → cycle continues after abort
- **F-Q404** REGRESSION — turn_index null on every insert (see F-Q301)
- **F-Q405** test fixtures drift from production schema (private column missing in 2 test files)
- **F-Q406** graph-cache stack guard — see Helper 2
- **F-Q407** F-P203 recency cap landed without index → add `idx_mentions_created_at`
- **F-Q408** privacy migration ALTER+UPDATE not atomic → wrap in transaction
- **F-Q409/Q410/Q411** atomic-write — see Helper 1

---

## MEDIUM (31) — grouped by area

### Federation (8)
- F-Q109 cleanup over-counts via non-atomic snapshot-then-delete
- F-Q110 inFlightAcceptance mutex never cleared if early throw between add and try
- F-Q111 signature `.max(128)` looser than ed25519 length (88)
- F-Q112 SIG_B64_RE accepts all-padding sigs
- F-Q113 REQUIRE_SIGNED_DEFAULT module-level vs factory-level can diverge under env-flip
- F-Q114 verifyEvent freshness window not aligned with TTL max
- F-Q116 canonicalizeEvent doesn't handle Map/Set/BigInt
- F-Q117 getOrCreateIdentity race-loser doesn't write identity.pub

### Retrieval (6)
- F-Q206 future-dated `last_recalled` → recency=1.0 (max)
- F-Q207 `_score` reserved key collision
- F-Q208 token-budget overflow when concepts+decisions alone exceed
- F-Q209 directive regex collapses newlines (`\s{2,}` → use `[ \t]{2,}`)
- F-Q210 first-match-wins on multiple directives (silent drop)
- F-Q211 token file TOCTOU (absorbed by Helper 1)
- F-Q212 getChunksForSessions returns most-recent globally not per-session

### Queue/Lifecycle (8)
- F-Q308 currentJob race window between clear and reassign
- F-Q309 same abortSignal across retries → all retries fail immediately
- F-Q310 isTransient missing EPIPE/ENETUNREACH
- F-Q311 extraction-trigger swallows errors, kills loop
- F-Q312 extractStructured can't be aborted (signal not threaded)
- F-Q313 backfill checkpoint write non-atomic (absorbed by Helper 1)
- F-Q314 runConsolidationCycle no busy_timeout (absorbed by Helper 3)
- F-Q315 NaN salience passes `typeof === 'number'` check → AVG NaN propagation

### Storage/Tests (9)
- F-Q414 themes.parent_id self-FK no CASCADE (F-N151, deferred per user)
- F-Q415 ha_telemetry_proposals junction no ON DELETE (F-N153, deferred)
- F-Q416 entities_archived schema redefined independently of entities
- F-Q412 wiring-manifest test is name-regex; doesn't catch "wired but inert"
- F-Q413 peer-trust + sign-fixture helpers still missing (TESTING_PROTOCOL.md §9 task 4)
- F-Q417 concept-mentioned event family is schema + promoter dead code
- F-Q418 local-event-log signs but never verifies on read (F-N17 still open)
- F-Q422 migration loops over pragma table_info on every store open

---

## LOW (21)

Grouped:
- **Wiring/lifecycle (5):** F-Q118 publishedIds returned by reference; F-Q119 entries() returns mutable records; F-Q120 signEvent destructure style; F-Q121 formatPeerMemoryBlock total cap; F-Q122 English-only regexes
- **Wrapper/inject-server (5):** F-Q213 lazy llmClient _creating never cleared on rejection; F-Q214 FTS5 keyword fallback; F-Q215 UTF-8 mid-codepoint truncation; F-Q216 themeFilter LIKE wildcards; F-Q217 _creating retained on success; F-Q218 multimodal content arrays ignored
- **Queue/extraction (6):** F-Q316 OLLAMA_QUEUE_RETRIES env parse; F-Q317 mutable arrays in checkpoint; F-Q318 model finish-reason ignored; F-Q319 parseFloat inconsistency; F-Q320 backfill no queue drain on shutdown; F-Q321 getEntityByName null guard unexplained
- **Storage misc (5):** F-Q419 kanban-store no pragmas; F-Q420 CJS shim leftovers; F-Q421 test schema CASCADE drift; F-Q422 pragma loops on every open; F-Q415 already noted

---

## Cross-cutting observations

1. **Schema migration is still ad-hoc.** No `user_version`, three different "atomic write" implementations, raw `new Database(...)` at 16 sites. **Single highest-leverage fix:** the three shared helpers.

2. **The privacy structural fix is overdue.** Cluster D has now hit 6 times across 3 review rounds (F-C12, F-C13, F-N50, F-N51, F-N102, F-Q201/Q301/Q404). Every fix is a leaf patch. **Structural fix:** every query against `entities`/`decisions`/`themes`/`mentions` MUST go through a helper that takes `respectPrivacy` as REQUIRED (not optional with default true). Today the leaf SQL builds the clause conditionally and every new query forgets it.

3. **Test scaffolding is incomplete.** TESTING_PROTOCOL.md §9 prescribed `sign-fixture.mjs` and `peer-trust.mjs` helpers. Neither exists. The 6 fed-2node/3node BUG-class failures remain blocked.

4. **The wiring-manifest test is name-regex.** It catches "factory never imported" but not "factory imported but never invoked" (F-Q412). Tighten to AST-walk that asserts call-position.

5. **Documentation drift is small.** Spot-checked 4 pass-1 entries; all aligned in spirit. F-P411's "atomic" claim is partially true (missing fsync = F-Q411).

---

## Recommended action order for pass-2 repair

Highest leverage first. Each bullet is one focused PR.

1. **HOTFIXES already landed** — F-Q101, F-Q201 (commit `9a4396d`)
2. **Helper extraction** — `atomicWriteFile`, `withConcurrencyGuard`, `openSqliteStore`. Absorbs 13+ findings. Largest single PR.
3. **F-Q302** — onIngest return-value contract
4. **F-Q304 / F-Q303** — backfill error classification hardening
5. **F-Q307** — AbortError-aware regenerateSummaries
6. **F-Q102** — typed signEvent errors
7. **F-Q405** — replace hand-rolled test schemas with `createExtractionStore({dbPath: ':memory:'})`
8. **F-Q103** — age-based publishedIds eviction
9. **F-Q106** — event_version dispatch in verifyEvent
10. **F-Q108** — wire `actor.type:'peer'` and `entity_type:'broadcast'` (or remove unused enum values)
11. **F-Q413** — write the test scaffolding helpers
12. **F-Q301** — extractor turn_index population (architectural — large change, defer to design pass)
13. Remainder by triage.

Items 1-11 are mechanical; item 12 needs design decisions on prompt format + LLM cost trade-off.

---

*Continuation: REVIEW_PASS_3.md after pass-2 fixes land.*
