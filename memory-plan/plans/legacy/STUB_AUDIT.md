# OpenClaw — Full Stub & Placeholder Audit

**Date:** 2026-05-27
**Triggered by:** User callout — "do a fucking full review for all stub and placeholder."

This is a direct, structural audit. No agents, no delegation. Every entry below is verified by grep against the live tree at HEAD.

The user is correct: I have a pattern of shipping leaf changes while leaving the producer-side / wiring-side half-done, then catching it later in review. This audit lists every instance I can find, so the work-still-to-do is visible up front instead of getting discovered one critical at a time.

---

## Headline

**The extraction pipeline is broken end-to-end.** A user editing in Claude Code triggers a PreCompact hook that fires `openclaw-extract-now.mjs`, which publishes to a NATS subject. **Nothing subscribes to that subject in production.** The whole real-time extraction flow has been silently no-op'ing.

**The entire `memory.*` event family is dead schema.** 8 schemas exist in `packages/event-schemas/src/memory/`. **None have a production producer.** One producer module (`memory-budget.mjs`) emits 3 of them — that module is never instantiated outside tests.

**Channel 5 of retrieval (spreading activation) is wired in the inject-server but not in the daemon.** F-P201 fixed the adapter shape; the daemon still passes `graphCache: null` to federation-startup. So the channel is still inert in the daemon-deployed path.

Six top-level "DEAD" categories below, plus open TODOs and silent-swallow catches.

---

## 1. DEAD FACTORIES (exported, never called in production)

These export a `createX()` function but no production code calls it. The factory + module exist purely as test surface.

| Factory | Module | Production callers (excluding tests) | Notes |
|---|---|---|---|
| `createExtractionTrigger` | `lib/extraction-trigger.mjs` | **NONE** | Supposed to subscribe to `mesh.memory.extract_request` and run the extraction. Hook fires publishes — nothing consumes them. |
| `createMemoryBudget` | `lib/memory-budget.mjs` | **NONE** | Only producer of `memory.session_{started,ended}` + `memory.fact_extracted`. Never instantiated → those events never get emitted. |
| `createSessionStore` | `lib/session-store.mjs` | **NONE** (only `extraction-store.mjs` operates on the same DB by direct handle) | Exports `bulkInsert`, FTS rebuild, etc. Nothing calls it in production. Backfill scripts read the DB directly. |
| `runFlush` | `lib/pre-compression-flush.mjs` | **NONE** (only validation script) | The actual extraction worker. The hook fires extract-now → publishes NATS → nothing subscribes → runFlush never runs. |
| `createLocalEventLog` | `lib/local-event-log.mjs` | only `lib/memory-budget.mjs` (also dead) | Local JetStream event log. Signs but never verifies on read (F-N17). |

**Net:** the real-time memory extraction pipeline (hook → NATS → trigger → flush → store) is **broken at the trigger step**. Manual backfill via `bin/extract-existing-sessions.mjs` works. Real-time does not.

---

## 2. DEAD EVENT SCHEMAS (defined, no producer)

Every memory schema in `packages/event-schemas/src/memory/`:

| Schema | Producer found | Consumer found |
|---|---|---|
| `memory.session_started` | `memory-budget.mjs` (dead — see §1) | `local-event-log.mjs`, `memory-budget.mjs` |
| `memory.session_ended` | `memory-budget.mjs` (dead) | `memory-budget.mjs` |
| `memory.turn_recorded` | **NONE** | **NONE** |
| `memory.fact_extracted` | `memory-budget.mjs` (dead) | **NONE** (also: schema source `.ts` does not exist; only stale `dist/`) |
| `memory.concept_mentioned` | **NONE** | `memory-promoter.mjs` (idle daemon, never fires) |
| `memory.snapshot_taken` | **NONE** | `memory-promoter.mjs` (idle daemon, never fires) |
| `memory.artifact_attached` | **NONE** | **NONE** |
| `memory.compaction_triggered` | **NONE** | **NONE** |

**Net:** 5 of 8 memory schemas have zero references outside their own definition + the promoter that waits for them forever. The other 3 are referenced only by a module that itself is dead.

`memory.fact_extracted` is the most damning: `packages/event-schemas/src/memory/fact-extracted.ts` exists, **AND** `dist/memory/fact-extracted.js` exists as a stale build artifact. The schema is referenced in the dist `index.js` exports but the source has no callers anywhere.

---

## 3. DEAD WORKER MODULES (full implementation, never instantiated)

Beyond the factories in §1, these are full classes/modules that exist but nothing uses:

- `bin/memory-promoter.mjs` — daemon process listed in `openclaw-restart.sh` as "unmanaged." Subscribes to `memory.concept_mentioned` + `memory.snapshot_taken` (zero producers). If the operator runs it, it idles forever consuming no events.
- `bin/memory-subscriber.mjs` — daemon process. The main daemon (`openclaw-memory-daemon.mjs`) explicitly DISABLES it by default (see §4 below) because the projection layer doesn't exist.
- `lib/memory-budget.mjs` — full class with `recordSessionStart`, `recordSessionEnd`, etc. Never instantiated.

---

## 4. DAEMON STUBS (explicitly disabled paths in production)

The main `bin/openclaw-memory-daemon.mjs` has explicit "feature disabled" branches. These are HONEST in that they log loudly, but they are still stubs:

| Component | Daemon behavior | Why |
|---|---|---|
| Subscriber projection (Block 11) | DISABLED by default; `OPENCLAW_SUBSCRIBER_PROJECTION=stub` for ack-without-project | Real projection not implemented |
| Graph cache (Channel 5) | **NEVER CONSTRUCTED IN THE DAEMON** — daemon doesn't import `createGraphCache`, doesn't pass it to federation-startup | F-P201 fixed the adapter shape but the daemon never plugs it in. Spreading activation is still dead in the daemon-deployed path. |
| Trust registry pre-seeding | Daemon starts with strict mode + zero peers + a WARNING log | Operator must run `openclaw-trust-peer` manually. Until they do, federation accepts nothing. |
| Extraction trigger | NOT WIRED. `createExtractionTrigger` is never imported by the daemon | The hook → NATS → trigger chain is broken at this gap. |

---

## 5. HALF-WIRED MODULES (caller exists but doesn't pass required deps)

These are the most insidious. The factory IS called, but with missing/null deps that disable functionality:

| Module | What's missing | Effect |
|---|---|---|
| Federation `createOfferer` | `requestAnalysis` never threaded through `federation-startup` | Offer-summary LLM analysis always falls back to data-only (no LLM summaries on offers). Stats counter `summariesFallback` would tick if you wired it. |
| Federation `createOfferer` | `extractionDb` threaded (post-F-P106) but the `peerTracker` opt isn't | Peer-tracker for `getTopOffer` dead-peer filtering doesn't accumulate. |
| Retrieval pipeline in daemon | `graphCache: null` always | Channel 5 inert in the daemon path. |
| `mentions.turn_index` | Always `null` on insert (F-Q201 stopgap reverted to session-grain) | Chunk-grain privacy filter never gets real data; works only via fail-safe. |
| `actor.type: 'peer'` enum value | F-P414 added but no producer ever sets it | Federation events still claim `actor.type: 'system'`. Analytics can't differentiate peer vs local origin. |
| `entity_type: 'broadcast'/'offer'/'accepted'` | F-P413 added but no producer ever sets them | Same. |
| `event_version` field | F-Q106 now rejects > 1 in verify, but no producer ever sets > 1 either | The dispatch logic works; nothing exercises it yet. Acceptable. |

---

## 6. OPEN TODOs / "later" / "future" comments in code

Direct grep over `lib/`, `bin/`, `packages/event-schemas/src/`:

| File:line | Comment |
|---|---|
| `lib/publishers/openai-wrapper.mjs:58` | `// to derive a per-conversation key (TODO: future).` — F-P301 session-disable per-conversation keying deferred |
| `bin/openclaw-trust-peer.mjs:34` | `// (or send SIGHUP — TODO) so the` — SIGHUP-based registry reload not implemented |
| `lib/concurrency-guard.mjs:70` | `// The guard doesn't expose state — this is a placeholder for a future version` — `isGuardRunning()` stubbed-throws |
| `lib/artifacts.mjs:7` | `// Local-only for now. Peer NATS RPC (artifacts.fetch.<hash>) deferred to Block 4.` |
| `lib/obsidian-summarizer.mjs:342` | `// Remaining concepts are deferred to` — top-N cap, remainder dropped |

These are the only explicit TODOs. Note how few there are — the codebase tends to encode "deferred work" as silent absence (the worst kind) rather than as TODO comments.

---

## 7. EMPTY / SILENT CATCH BLOCKS

`catch {}` blocks with no log or rethrow swallow real failures. Surveyed:

| File:line | Context | Verdict |
|---|---|---|
| `lib/ollama-queue.mjs:447` | Inside `_reject` per pending entry during shutdown | OK — best-effort cleanup, errors here can't be acted on |
| `lib/memory-inject-server.mjs:239` | Inside `resolveDeps` opening extractionDb | **SUSPECT** — if DB open fails, the inject server proceeds without it; should at least log |
| `lib/memory-inject-server.mjs:247` | Same — knowledgeDb open | Same |
| `lib/memory-injector.mjs:367, 370` | Per-row `stmt.run` in `writeBackReconsolidation` | **OK** — F-N52 design says reconsolidation is best-effort; but pass-2 F-Q204 noted these swallow `SQLITE_BUSY` from concurrent consolidation, masking the recall-loop-never-closes symptom |
| `lib/mcp-knowledge/bench.mjs:26` | Test fixture cleanup | OK |
| `lib/kanban-io.js:45` | Lock-dir cleanup | OK |
| `lib/nats-resolve.js:80, 90` | Optional Tailscale resolution paths | OK |

**Two suspect:** the inject-server DB opens. Should log; today they silently start without the DB and quietly degrade.

---

## 8. PLACEHOLDER FUNCTIONS (return early without doing work)

Beyond the standard `if (!input.length) return []` pattern (which is legitimate), the suspicious ones:

- `lib/concurrency-guard.mjs:70` — `isGuardRunning(guard)` throws "not implemented" with a "future version" comment. **Dead stub.** Either implement or remove.
- `lib/obsidian-summarizer.mjs:166` — `if (result?.mode !== 'llm') return null;` — Cold Ollama loads consistently return `mode: 'fallback'` here (F-P209 raised the wait but not enough on cold start). Concept summary never generates on first-of-cycle. Not technically a stub; documented limitation.

---

## 9. TEST-MOCK-SHAPE-DIVERGENCES (production vs test shape mismatch)

These are the worst pattern — tests pass because the mock matches an idealized shape that production doesn't actually produce. Three instances confirmed across the review rounds:

| ID | Helper | Test mock | Production shape | Resolution |
|---|---|---|---|---|
| F-C14 | spreading-activation | Array of edges | `{edges, neighbors}` (object) | Fixed F-P201 |
| F-Q201 | mentions.turn_index | Test sets explicit `turn_index` | Production always `null` | Stopgap applied (session-grain fallback); proper fix needs extractor changes |
| Hand-rolled schemas | consolidation.test, conflict-surfacing.test | Schema without `private` column | Production schema has `private` (F-C15) | Open — should switch to `createExtractionStore({:memory:})` |

---

## 10. TABLES CREATED BUT NEVER WRITTEN/READ IN PRODUCTION

All 23 tables surveyed. None are unused. Closest to "underused":

- `published_items` — written by `bin/publish-item.mjs` (operator CLI) and read by promotion-candidate filtering. Real but operator-driven, not automatic.
- `entities_archived` — written by consolidation decay; never read anywhere. Pure write-only audit log. (Documented per F-N154 in pass 1.)
- `concept_graph_edges` / `concept_graph_nodes` — written by `obsidian-graph-cache`; read by spreading-activation. Both ends exist; the daemon just doesn't wire them (§4).

---

## What this means

The codebase has **two layers of "implemented but inert":**

1. **Lib-level inertness** — modules are correct in isolation. Tests pass. Reviews of the file itself find no bugs. This is where my "fix-at-leaf" pattern lives — I correctly modify a function but never verify the caller actually exercises it.

2. **Daemon-level inertness** — the daemon (`bin/openclaw-memory-daemon.mjs`) intentionally disables Block 11 (subscriber projection) and incidentally skips Channel 5 (graph cache) and the extraction trigger. The "daemon starts cleanly" status report doesn't reveal that 3 of the major subsystems are not running.

The shared cause: there's no single inventory document that says "what does a fully-running memory daemon do." Each module's docstring describes the module in isolation. The wiring-manifest test (`test/wiring-manifest.test.mjs`) was supposed to be that inventory but it's just `grep` for the factory name — passes whether the factory is called, imported-and-ignored, or commented-out (F-Q412).

---

## What I'm going to do about it

Three concrete actions:

### A. Document the active vs. dormant subsystems in code

Add a `bin/openclaw-status.mjs` CLI that introspects the running daemon and reports for each subsystem: WIRED / STUB / NOT_WIRED, with the env-var or commit that would change the state. No new functionality; just observable truth.

### B. Strengthen `wiring-manifest.test.mjs`

Replace the regex with an AST walk that asserts each factory name appears in CALL POSITION (not just import). Per F-P110 / F-Q412. Cost: ~50 lines.

### C. Decide on each dead module

For each of the 8 dead memory schemas + the 5 dead factories, make a decision:
- **Build it** — wire it into the daemon, with regression tests that exercise the live path.
- **Delete it** — remove schema + dist + consumer references. Better to have a small repo with everything wired than a big repo with half the surface inert.

I'll do A + B as part of this work. C is a per-item decision that needs your call.

---

## Summary table of dead/inert subsystems

| Subsystem | Status | What it would take to revive |
|---|---|---|
| Real-time extraction (hook → trigger → flush → store) | **DEAD** at trigger | Instantiate `createExtractionTrigger` in daemon |
| Block 11 subscriber projection | **STUB** | Implement the shared-knowledge merge path |
| Channel 5 spreading activation in daemon | **NOT WIRED** | Pass `graphCache: createGraphCache()` to federation-startup |
| `memory.*` event family | **DEAD** | Either wire `memory-budget.mjs` into the daemon, or delete all 8 schemas |
| `memory-promoter.mjs` daemon | **IDLE** | Producers of its subscribed events don't exist |
| `local-event-log.mjs` verify path | **STUB** | No reader uses `verifyEvent` on local events |
| Peer-trust scaffolding for tests | **MISSING** | Write `test/helpers/sign-fixture.mjs` + `peer-trust.mjs` (TESTING_PROTOCOL.md §9) |
| Extractor turn_index population | **STUB** | Change extraction prompt to require turn citation; parse + validate |
| Schema versioning | **MISSING** | F-Q401 (`user_version` per store) |
| Integrity check / backup | **MISSING** | F-Q402 |
| Atomic SQLite open helper | **MISSING** | F-Q403 |

This is the full list. Eight items on the right column are "missing" — actual gaps, not "deferred to a future Block." I'm going to be straight with you about what's hollow.
