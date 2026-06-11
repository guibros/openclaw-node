# Decisions Ledger — repair plan

Append-only. Newest at top. Each entry: date, decision, why, consequences. Referenced by MASTER_PLAN §4.8 and §11.

---

## 2026-06-11 — Block 6 closed (6.1–6.6): the watcher UI tells the truth and stays usable

**Consolidated step ledger:** 6.1 stable row identity (event_id lib→JSONL→API→key; panels stop snapping shut); 6.2 HealthCard reads the probe's real fields (the drift light shows green for the first time — it was structurally red); 6.3 fmtVal basenames only path fields (decision texts with '/' render whole); 6.4 session-less panels fetch nothing; 6.5 watcher.jsonl rotates at 5MB (both appenders routed through one helper); 6.6 the API tail-reads — measured 11ms/4ms against a 54MB synthetic file (was O(file) per 3s poll ×3 hooks).

**Deploys:** daemon restarted; three UI files copied to the runtime app (established model). Suite 1541/0. Block 7 (repo↔runtime defense) re-surveyed unchanged — the last active block before P.

---

## 2026-06-11 — Block 5 closed (5.1–5.6): retrieval is fresh and the signals are honest

**Consolidated step ledger** (per-step detail in INVENTORY DONE-notes + commits):
- **5.1 re-index on growth:** existence-skip → turn_count growth pre-filter; a 33-session frozen backlog began draining live (433 chunks of previously-invisible content in 3 passes; late-turn content FTS-verified). Search stops serving truncated prefixes.
- **5.2 channel errors surface:** pluggable sink over 10 silent catches; the inject server publishes memory.error naming the channel — live-verified through the production stream + watcher ('entity-match: no such table'); requests still degrade gracefully.
- **5.3 promotion emit-on-change:** sha256 candidate fingerprint in consolidation_meta; two live cycles → exactly one emission. Decision: emit-on-change over real promotion bookkeeping (federation-era, P.3).
- **5.4 stall detector:** liveness = write-pipeline ops only; scheduler drumbeats and bridge-dependent retrieval no longer mask a dead pipeline (discriminating regression).
- **5.5 readonly busy_timeout:** all opens get busy_timeout=5000; probes stop failing instantly under writer load.
- **5.6 integrity scans off hot paths:** the 60s poll and 10-min indexing open with integrityCheck:false — measured 85ms → 0ms; boot/CLI keep the scan.

**Macro Re-Orient:** Blocks 1–5 complete (32 steps closed, all runtime-proved). Block 6 (watcher/UI) re-surveyed unchanged. One honest note: a restart during a long LLM extraction still exits -6 after the 8s grace (the documented 4.1 trade-off; idle restarts are consistently 0). Suite 1539/0.

---

## 2026-06-10 — Block 4 closed (4.1–4.6): the daemon's lifecycle is trustworthy

**Consolidated step ledger** (per-step detail in INVENTORY DONE-notes + commits 20896b5→this):
- **4.1 shutdown fencing:** clearInterval + in-flight tick drained (8s grace) before ordered closes; shutdown owns process.exit(0). First exit-0 in the plan's history; four consecutive clean exits since.
- **4.2 probes decoupled:** SQLite health probes hoisted out of the NATS try — verified running with the broker booted out (CONNECTION_REFUSED + '3 stores checked' same second).
- **4.3 NATS re-init:** init wrapped retryable (60s); booted broker-down, restored broker → event log + watcher up on the SAME PID, JetStream publish consumed by the recovered watcher. Documented caveat: the inject server captures eventLog at startup (its events resume at next restart).
- **4.4 ended-session targeting:** IDLE→ENDED flush + subagent-audit use findJsonlBySessionId-first (the runtime-proven ACTIVE→ENDED pattern); wiring-locked.
- **4.5 idle-timer loop:** self-pings no longer re-arm; loopback-mock regression reproduces the mechanism (old 8 fires/400ms → 1).
- **4.6 session floor:** MIN_SESSION_BYTES=1024 named + documented at three sites (one previously unknown); short sessions reachable by flush paths.

**Macro Re-Orient:** audits/step24. Block 5 re-surveyed unchanged (5.1 the quality-critical one). OUT_OF_SCOPE: 50KB resolved; bootstrap memory-maintenance exit-1 deliberately left captured (LOW; Phase 2 covers it). Suite 1533/0; daemon PID 82349.

---

## 2026-06-10 — Step 3.4 closed: audit remediations land → Block 3 COMPLETE

**Decision (operator: "fix the docs").** (a) R43 — one analysis-timeout knob: the queue's `ANALYSIS_TIMEOUT_MS` (default 1000ms, the ceiling that once made LLM analysis structurally impossible, still loaded for any direct caller) removed; `LLM_ANALYSIS_TIMEOUT`/8000 governs both layers, regression-locked. (b) R42 — the JSON fast path validates before returning; concatenated `{...}{...}` model output now recovers via the largest-balanced-block scanner instead of costing a full extraction run. (c) R44 — MASTER_PLAN §3.2 corrected to measured reality (static `LLM_MODEL`; install-time advisor; runtime selector = unclaimed future scope), landed per §11 in its own `master-plan:` commit (70f61c5) and synced to all silos. Building a real tier selector was explicitly declined for now — docs-over-aspiration per §4.5.

**Evidence.** Suite **1529/1529**; grep shows zero `ANALYSIS_TIMEOUT_MS` remnants; daemon restarted onto v3.4 (sanity inject `mode=llm`, items 7/5/3).

**Block 3 close + macro Re-Orient (audits/step20).** D8 worked as designed: measure first, fix only what the measurements convicted — and the audit cleared as many suspects as it convicted (pre-warm unnecessary, 8s ceiling adequate cold and warm, extraction cost acceptable post-dedup). Block 4 re-surveyed: steps unchanged, 4.1 (shutdown fencing) remains the headline — every restart this plan has performed exits -9/-6, live evidence accumulating. The 50KB-floor capture rides into Block 4's scope-setting.

---

## 2026-06-10 — Step 3.3 closed: health-watch finally watches the daemon, not itself

**Decision.** Queue state crosses the process boundary via a snapshot file: the daemon exports `getState()` each tick (atomic write); health-watch reads the file with a 2-minute staleness guard (a dead exporter reads as *unknown*, never *idle*); stuck evaluation reuses the F-H17 extraction-only rule over the snapshot. The auto-restart unload mechanism switched from the `ollama stop` CLI — which the 3.1 audit measured NOT evicting — to the `keep_alive: 0` API, which does. Restart rate-limiting is local to the restarter (the daemon's in-process counters can't be reset cross-process and clear on its next success).

**Evidence.** Queue tests 30/30 (+3 snapshot cases), suite 1526/0. Live cross-process flow with real data: the daemon's own inject became visible in the snapshot (`runs: 1, analysis avg 1754ms`, daemon pid) and rendered in `.daemon-health.md`'s queue section by the separate health-watch process — both previously structurally impossible. Synthetic stuck snapshot → auto-restart attempted **true** → model genuinely evicted (api/ps empty), 1.5s reload on next use.

**Consequences.** R12 closed; the watchdog's Ollama-stuck recovery is live for the first time. 3.4 defined (R43+R42+R44-docs, mechanical) — awaiting operator scope confirmation; the only judgment item is docs-vs-build on the tier selector.

---

## 2026-06-10 — Step 3.2 closed: queue single-flight restored under timeout pressure

**Decision.** `requestAnalysis` carries a per-call ticket (opts → pending entry → running job). Its wait-timeout path now (a) removes its own never-started pending entry — previously left behind to fire an analysis nobody consumes — and (b) abandons the running slot only when that job is its own (the only case where its abort signal actually cancels the fetch). `drainPending` drops cancelled entries defensively. F-N103's defensive-release intent is preserved, scoped to ownership.

**Evidence.** Queue tests 27/27 (+2: the exact R11 overlap scenario — A keeps the slot and completes `mode=llm`, B falls back, B's run never fires, max-concurrency stays 1, queue drains empty; own-job abandonment still releases). Full suite 1523/0. Daemon restarted onto the fix (PID 57880); live inject post-change: `mode=llm`, items 7/5/3.

**No architectural decision needed** — spec came verbatim from the 3.1 audit.

---

## 2026-06-10 — Step 3.1 closed: LLM infrastructure audited — the layer is sounder than suspected → Opens Block 3

**Decision.** Audit-first per D8; deliverable `LLM_INFRA.md` (read-only, zero code changes). Headline verdicts: **llm-client sound** (both lanes; timer/signal hygiene holds); **queue sound except R11** (now sharpened to two parts: ownership-less slot abandonment + stale pending entry — 3.2's exact spec); **analysis path healthy end-to-end** (live inject: mode=llm, items 7/5/3, 1.2s); **extraction sound but expensive** (p50 38.9s from a week of production events — per-new-content only since 1.4's dedup); **health-watch LLM introspection dead** (R12 → 3.3); **runtime model tiering does not exist** (R44 — the documented "tiered selector" is an install-time RAM advisor; docs mislead per §4.5); **pre-warm gap closed by measurement** (true-cold-after-eviction analysis 1.56s, warm 3.1s — both far under the 8s ceiling; no machinery needed).

**New findings:** R43 (queue-side `ANALYSIS_TIMEOUT_MS` default 1000 — the old broken ceiling — shadowed by llm-client but loaded for any direct caller), R44. One audit self-correction recorded: the inject response carries counts under `items`/content in `block`; a probe reading top-level arrays misreads it as empty (briefly looked like a retrieval regression; it isn't — pipeline verified healthy).

**Consequences.** 3.2 (queue ownership) and 3.3 (cross-process introspection) proceed as specified; 3.4's candidate list: R43, R44 docs-or-build, R42, theme-linkage schema, 50KB floor, extraction-cost review.

---

## 2026-06-03 — Step 2.9 closed: decisions/ + themes/ surfaces live, duplicates aliased → Block 2 COMPLETE

**Decisions (operator, via AskUserQuestion).** Per-decision dated notes (salience ≥0.4, top-30: rationale, confidence, concept + session links); per-theme hub pages (≥threshold: alias, hierarchy, member concepts); duplicates **aliased, not merged** — both DB rows kept, the slug-owning note carries every colliding name (operator deviated from the merge recommendation; the alias map is built from all candidates so targeted regens never drop it).

**Design refinement mid-step.** Decision/theme concept links use **piped slug form** (`[[slug|Name]]`) — basename resolution needs no alias on the target, killing the legacy-note alias-gap class outright. Mid-step find fixed: the session-notes generator was still emitting dangling links (34 landed during the night's induced flushes) — it now applies link-only-existing like every other writer. Theme membership runs on the extraction-batch approximation; the missing theme↔session schema linkage is captured in OUT_OF_SCOPE.

**Evidence.** 21 decision notes + 6 theme hubs live, idempotent on rerun; `openclaw.md` aliases `["OpenClaw", "openclaw"]`; vault **867/867 links resolved (100%), 0 dangling, 0 slug-gap**; coverage: concepts 69/69, decisions 30/30, themes 6/6 — all 100%. Suite **1521/0**. Daemon restarted onto the wired flush (PID 40668).

**Block 2 close + macro Re-Orient (audits/step16).** The operator's headline is delivered end to end: four generated surfaces, full coverage, full link resolution, integrity measured per flush in mission-control. Block 3 (D8 LLM audit-first) re-surveyed and unchanged; 3 new candidates noted for 3.4's defined-at. Flag for operator: a second active scope (`plans/protocol/`) appeared in the hook union — not this plan's doing; one-scope-at-a-time needs an operator look.

---

## 2026-06-03 — Steps 2.10 + 2.11 closed: synthesis events attributable and truthfully labeled

**2.10.** `memory.synthesized.data.session_id` is required (schema + dist), emitted at the daemon; the watcher reads it natively. Live: a synthesized record with `session: repair-11-verify` — every prior record had `session: null`.

**2.11.** Trigger enum gains `'idle'`; the ACTIVE→IDLE pre-compression flush is relabeled from the false `'interval'`. Per-site labels locked by a source-wiring test (idle / interval / manual / session_end ×2). Live-induction substitution documented: that path gates on `shouldFlush` ≥150k tokens (~1.2MB session) — impractical to induce; the wiring + schema tests and the truthful live `interval` label stand as the evidence (substitution precedent: 0.2, 2.2).

**Evidence.** Full suite **1515/0**. Single live induction (synthesisMs 60s, reverted; daemon PID 22383 back on defaults).

---

## 2026-06-03 — Step 2.8 closed: every wikilink in the vault resolves — the referential system works

**Sub-decision: link-only-existing, no stubs.** A referential system links what exists; sessions without notes render as plain text, related-links are emitted only for targets on disk or in the same generation run. 442 stub notes rejected as noise.

**Decision.** Three mechanisms: (1) concept frontmatter carries `aliases: ["<Entity Name>"]` — the single line that makes name-style `[[links]]` resolve against slug filenames in Obsidian; (2) generators filter/resolve at emission (related → resolvable targets only; session refs → the real note's basename via `buildSessionNoteResolver`, else text); (3) the checker resolves path-style targets by basename, matching Obsidian (the digest's correct links had been misclassified). One-time migration repaired the 72 existing notes (66 aliased, 10 session links fixed, 300 unlinked to text, 239 ghost related-links dropped — script preserved in audits/).

**Evidence.** Vault-wide: **739/739 wikilinks resolved (100%)** — from 503/1264 (39.8%) at the 2.4 baseline — **0 slug-resolvable, 0 dangling**. Fresh deployed generation (`openclaw-tui`, real LLM): aliases present, 0 dangling in the new note. Tests 44/44 (two bug-locking tests converted).

**Consequences.** `vault_integrity.dangling` on live flushes is now a true regression signal (expected 0). The operator's referential system — concept coverage 100% (2.7), link resolution 100% (2.8), measured per flush (2.5) — is implemented and working. Remaining in block: 2.9 (themes/decisions surfaces — definable now), 2.10/2.11 (event attribution).

---

## 2026-06-03 — Step 2.7 closed: concept-note coverage 100%, and it stays there

**Decision.** Two mechanisms: (1) `generateConceptNotes` gains `opts.names` — targeted generation reusing the whole existing write path; (2) the flush path generates **missing-coverage names first** (from `checkReferentialCoverage`, capped 10/flush, best-effort) instead of blindly rewriting the same top-10 forever — the structural reason HEARTBEAT.md (and any tail entity below the cap) could never get a note. One-time live backfill via the deployed writer closed the last gap.

**Evidence.** Tests 27/27 (+1 targeted-names case). Live: `heartbeat-md.md` written (real LLM body); coverage CLI now reads **68/68 (100%)**. The "newly-crossing entity gets its note on the next synthesis" gate: structurally guaranteed by missing-first selection + already observed live in 2.5's flush (notes 75→76).

## 2026-06-03 — Step 2.6 closed (ledger entry omitted from commit d6d83a1, recorded here)

**Decision.** `checkReferentialCoverage` (lib + CLI `--coverage`) measures the three coverage numbers — concept coverage with missing list, link resolution %, session-note concept linkage %. Live: 67/68 (98.5%) / 39.8% / 6-of-7 (85.7%), each spot-checked against SQL and disk. 2.9's definition input gathered: `decisions/` and `themes/` vault surfaces exist but are empty (0 files).

---

## 2026-06-03 — Step 2.5 closed: integrity counts on every synthesis flush, end to end

**Decision.** `memory.synthesized` carries an optional `vault_integrity` block (notes/links/resolved/slug_resolvable/dangling/orphans). Measured by `checkVaultLinks()` inside `runFlush` after the synthesis chain (non-fatal — a failed check never kills a flush), passed through the daemon's emit, schema + dist updated. Surfacing rides the existing watcher detail panel (payloads render verbatim) — zero UI changes needed.

**Evidence.** Tests 46/46. Live flush (synthesisMs 60s temporarily, reverted): watcher record `status=ok` with `vault_integrity {76/1264/503/204/557/29}` — byte-identical to a manual CLI run and to `GET /api/watcher`. Daemon back on default config (PID 14804).

**Found while verifying (captured, not fixed):** `findCurrentJsonl` silently skips sessions under 50KB — interval/NATS flush paths can never process short sessions (OUT_OF_SCOPE; Block 4 / 3.4 triage). The fixture was padded past the floor and remains the designated verification session.

---

## 2026-06-03 — Step 2.4 closed: vault link-integrity checker — the referential system measured for the first time

**Decision.** `lib/obsidian-link-checker.mjs` (read-only) + `bin/vault-check.mjs` classify every wikilink three ways — Obsidian-exact resolved, slug-resolvable (links carry entity names, files carry slugs, notes have no `aliases:` frontmatter), truly dangling — plus orphan notes. Three-way classification chosen deliberately so 2.8 fixes on facts rather than collapsing distinct failure modes.

**First readings (live vault, 75 notes / 1213 links):** 488 resolved (40%), **204 slug-resolvable, 521 truly dangling** (dominated by `[[sessions/<uuid>]]` links to session notes never written), 28 orphans. The operator's "the referential system needs to be implemented and working" verdict, now quantified.

**Evidence.** Tests 4/4 (classification matrix, orphans, seed-detect-remove, missing-vault). Live seed cycle: planted dangling link detected by name, cleared on removal. Two in-step tool bugs caught by verification and fixed (process.exit stdout truncation; YAML-list bracket leakage).

**Consequences.** 2.5 puts these counts on the synthesis cadence + watcher; 2.6 adds the db-side coverage; 2.8's queue is now concrete: alias/slug unification (204) + session-note link policy (the 521).

---

## 2026-06-03 — Step 2.3 closed: promoter idempotent + deterministic

**Decision.** `promoteConceptNotes` writes only new/changed notes: content compared without the volatile `promoted_at` line; writes go through `atomicWriteFileSync`; return reports `skipped`. Plus a tripwire find handled minimally in-step: distinct entities slugifying to one filename (`OpenClaw` vs `openclaw`) made true idempotency impossible (ping-pong overwrites) — resolution is deterministic first-wins by mention_count with `collisions` reported. The underlying entity-duplication/canonicalization defect and the promoter's post-D7 filtering posture are captured in OUT_OF_SCOPE (Block 2 re-plan candidate; P.3 respectively), not silently absorbed.

**Evidence.** Tests 10/10 (skip semantics mtime-locked; changed-entity rewrites exactly its note; collision determinism). Runtime, deployed lib against live state.db: run 1 promoted 23 + 1 collision reported; run 2 **promoted=0, skipped=23, mtime snapshot byte-identical**. Full suite 1503/0.

**No architectural decision needed** — canonicalization deferred to its own slot by design.

---

## 2026-06-03 — Step 2.2 closed: one slugify behavior, writer + UI locked together

**Decision.** The mission-control route's slug mirror is now byte-equivalent to the writer's `slugifyName` (60-char cap dropped). The INVENTORY's "single imported definition" gate was substituted — the runtime mission-control is a file-copy deploy, so one relative import cannot resolve in both trees — with an equal-strength gate: `test/slugify-parity.test.mjs` extracts the route's function from source and battery-asserts equality with `slugifyName` (incl. >60-char, unicode, slash cases) plus a no-`.slice(` regression lock. Substitution documented in audits/step10 (precedent: redesign 0.2's done-evidence refinement).

**Evidence.** Parity tests 3/3. Runtime: route deployed (file copy, Next hot-reload); seeded an 89-char-slug entity + real-writer note → live API `?entity=` returned the full prose (pre-fix: truncated-filename lookup → null → "No concept note written yet" for a note that existed). Seed cleaned up.

**No architectural decision needed.** Carry-forward: 2.4/2.6 resolve names→files through the same `slugifyName`; UI agreement is now guaranteed by test.

---

## 2026-06-03 — Step 2.1 closed: all local vault writers transparent → Opens Block 2

**Decision.** The privacy default in `obsidian-summarizer` (the single gate every vault writer flows through) flipped per D7: `respectPrivacy === true` is now an explicit opt-IN for federation-era surfaces; local writers (flush, consolidation regenerateSummaries, promoter) are transparent by default. The flush call site's redundant explicit `false` removed — the default is the single source of the posture. F-N102's machinery is intact behind the opt-in; its cloud-sync exposure remark stays parked (R36, Block P).

**Evidence.** grep: zero local writers opt into filtering. Tests 48/48 (F-N102 regression pair converted: D7 default-transparency + opt-in filtering with the original exclusion assertions). Runtime, both Proof halves: live scheduler cycle post-change wrote 5 concept notes including `private=1` restored entities (nats-kv-interference-bug-pattern, arcane — pre-change this path excluded every row); deployed real-LLM flush wrote 10 notes for private-flagged entities. Same cycle confirmed Block 1 in live steady state (Decayed 0/0 archived, Reinforced 0, promotion candidates 103→24 under recounted thresholds).

**Consequences.** The R6 contradiction is gone — one posture, decided, documented. Block 2 continues: 2.2 shared slugify.

---

## 2026-06-03 — Step 1.8 closed: rebaseline → Block 1 COMPLETE

**Decision (operator, via AskUserQuestion).** (1) `mention_count := COUNT(DISTINCT session_id)` for entities with mention rows — immune to residual pre-fix duplicate rows and consistent with reinforcement's shared-session semantics; the 941 restored keep their preserved historical counts (rows unrecoverable). (2) Salience **0.5 + fresh anchor for ALL live entities** — the same fresh-start the restored got; kills the remaining ≈0.158 artifact cluster (94 rows) outright; mention_count carries ranking until fresh dynamics differentiate.

**Evidence.** Backup `pre-step-1-8-2026-06-03`. Post-write SQL: 0 recount mismatches (132 entities), 0 restored counts disturbed, 0 rows with salience ≠ 0.5. New top-5 by real session count: NATS-KV-pattern 77, Arcane 71 (claimed "157" pre-fix), HIDDEN_TRUTH 60, NATS JetStream 58, openclaw-tui 33. Stability (1.2-proven copy-run, 2 cycles): 0.208% drift ≤ 0.3% gate, 0 archived, SUM(mention_count) stable at 2118.

**Block 1 close + macro Re-Orient (audits/step08_rebaseline/AUDIT_POST.md).** All 8 steps closed with runtime evidence. The graph's numbers now measure memory, not scheduler cadence. Live probes: 1073 entities (132 organic + 941 restored), 68 above concept threshold, 652 themes, 341 decisions, 973 mentions, 65 vault concept notes. Block 2 re-surveyed: steps remain atomic and ordered; 2.9 stays defined-after-2.6; 2.7's backfill scope is modest (68 threshold vs 65 notes) — 2.4's link-integrity unknowns are the bigger surface. No drift; next step **2.1** (unify all vault writers on transparent, D7).

---

## 2026-06-03 — Step 1.7 closed: bug-archived entities restored (operator-driven)

**Decision (operator, via AskUserQuestion).** (1) Restore **all 941** non-colliding archived entities — the bug killed them in hours, the fixed decay re-archives genuinely idle ones legitimately over ~46 days; maximally transparent per D7. (2) Restored salience **0.5 with `last_decayed_at` anchored at restore time** — archived values were sub-floor and would have re-archived within one cycle; 1.8 rebaselines uniformly. (3) **Flag, don't delete**: `entities_archived.restored_at` stamps the audit trail; the 20 name-collision rows (re-extracted since, live row wins) stay archived and unflagged.

**Precondition verified first.** Overnight post-fix scheduler cycles showed the steady-state signature (Decayed 24–45 with 0 archived, Reinforced 0, 364 credited pairs, archive frozen at 961) — the anchoring/seeding pass had completed.

**Evidence.** Backup `~/.openclaw/backups/pre-step-1-7-2026-06-03/state.db` (25.6 MB). One sub-second transaction on live state.db: 941 inserted with original ids (verified safe: AUTOINCREMENT, sequence 2177 > max archived id 2113, 0 id collisions), live entities 132 → **1073**, join-check **0 field-preservation failures** across all 941, 0 entities below the archive floor, 941 archive rows flagged / 20 unflagged.

**Consequences.** The archived entities' mention rows were deleted at archive time and are unrecoverable — their preserved `mention_count` is the historical baseline; 1.8's recount therefore applies only to entities that have mention rows. `entities_archived` semantics now: flagged = bug-era archive (restored), unflagged = superseded by later re-extraction.

---

## 2026-06-02 — Step 1.6 closed: MEMORY.md writes are atomic

**Decision.** All three MEMORY.md write sites (pre-compression-flush LLM + regex paths, memory-budget `#writeFile`) route through `atomicWriteFileSync` (tmp + fsync + rename; budget keeps its dir-creation via `mkdirp: true`). Concurrent readers (budget reload, companion-bridge) can never observe a torn file.

**Evidence.** Grep: zero bare `writeFileSync` in either file. Tests: targeted 72/72, full suite 1499/0. Observed deployed flush wrote MEMORY.md intact with no `.tmp` residue.

**No architectural decision needed.** Block 1 code steps (1.1–1.6) complete; 1.7/1.8 are operator-driven data repair — the autonomous chain BLOCKS here by design.

---

## 2026-06-02 — Step 1.5 closed: turn_index stamps the last real turn

**Decision.** The flush stamp is `messageCount - 1` (turns are 0-based). The prior `messageCount` stamp meant every mention referenced a turn that doesn't exist — the turn-grain mechanisms downstream could never match. The regression test that had locked the bug in (asserting 3 for a 3-message session) is corrected, not just extended.

**Evidence.** Tests 12/12. Runtime: real-LLM deployed runFlush against the 4-message `repair-11-verify` fixture in production state.db → mode=llm/16 facts, all mentions `turn_index=3` (=messageCount−1), JOIN to the messages table: 8 matched, **0 orphan stamps**.

**No architectural decision needed** — one-line semantic fix.

---

## 2026-06-02 — Step 1.4 closed: extraction dedup at flush boundaries

**Decision.** `runFlush` keeps a per-session record of the last successfully-extracted tail (`extraction_state`: session_id PK, sha256 of the tail's `[role, content]` pairs, message_count, extracted_at — lazy table in state.db via the store's db handle). Unchanged tail → no LLM call, no synthesis re-run, `mode:'llm-dedup'` with a zero-count extraction block that the daemon's existing emit guard turns into a watcher-classified `noop`. Hash recorded only after a successful store, so failed extractions retry. Delta-input extraction (feeding only new messages) deliberately not attempted.

**Evidence.** Tests: +1 integration (unchanged → dedup/0 LLM calls/0 new mentions; grown → re-extracts); full suite **1499/0**. Runtime, live daemon end-to-end (synthesisMs 60s temporarily, config backed up + reverted): flush#1 16:04:17 `[llm]` → watcher `status=ok entities=12`, 12 mention rows; flush#2 16:04:55 over the unchanged tail → `[llm-dedup]: 0 facts`, watcher `status=noop entities=0`, **0 mention rows inserted** (SQL window check). Fired on a real 712KB production session.

**No architectural decision needed.** All three mention-count inflators (R1 decay, R2 reinforcement, R4 re-extraction) are now off. Carry-forward: 1.5 can cross-check its stamp against `extraction_state.message_count`.

---

## 2026-06-02 — Step 1.3 closed: idempotent reinforcement

**Decision.** Co-occurrence reinforcement is credited-evidence-based: `cooccurrence_state(id_a, id_b, sessions_seen, last_reinforced_at)` (created lazily inside `reinforceCoOccurrence` so every caller is covered). A pair credits +1 mention_count / +0.05 salience per member when it first qualifies and again only when its shared-session count grows; equal counts skip; 30-day-window shrink is tracked downward (under-credit chosen over re-credit). The `pairs` return now reports only this cycle's credits.

**Evidence.** Tests: 22/22 (2 new: second-cycle full-snapshot deepEqual; one-new-session → exactly +1). Runtime: live-copy run — cycle 1 seeds 102 credits (the set the live scheduler had re-credited every 30 min), cycle 2 reinforced=0 with identical snapshots and unchanged SUM(mention_count)=9113, one real new shared session → exactly +1 per member. Deploy via lib symlink; scheduler picks it up next spawn.

**No architectural decision needed.** With 1.2+1.3, both halves of the salience/mention_count pump are off; the bug equilibrium is gone. Carry-forward: live scheduler log should show one ~102-credit seeding cycle then 0s — sanity check before 1.7/1.8.

---

## 2026-06-02 — Step 1.2 closed: time-anchored decay

**Decision.** Decay applications anchor at `last_decayed_at` (new nullable column on entities + decisions, migrated idempotently in `initConsolidationTables` — the only path that reads it). Per-cycle factor = 0.5^(Δt/14d) where Δt = now − max(last_decayed_at, last_recalled||last_seen): exponentials compose, so N cycles decay exactly as much as one; recall restarts the idle clock; the anchor is written only when decay actually applies, so sub-threshold deltas accumulate instead of vanishing. F-P212/F-L21/F-M18/F-P211 semantics preserved. Decisions loop fixed identically (same bug, same function).

**Evidence.** Tests: 3 new frozen-clock cases (compose-not-compound, recall reset, decisions parity), consolidation file 20/20. Runtime: 4 real-cadence cycles against a `.backup` copy of live state.db — cycle 2 decayed **0** entities (pre-fix live baseline: all 110, every cycle), cycles 2–4 total drift 0.19% (gate ≤0.4%), `entities_archived` 961→961 (0 new rows). Deploy is the lib symlink; the scheduler spawns fresh per StartInterval, so the next live cycle runs anchored decay with no restart step.

**No architectural decision needed** — formula correction within the documented half-life contract. Carry-forward: run 1.7/1.8 after one live anchored cycle; expect a one-time live anchoring pass that may floor a few bug-crushed idle entities (restorable in 1.7 with the rest).

---

## 2026-06-02 — Step 1.1 closed: tick re-entrancy guard → Opens Block 1

**Decision.** The daemon's tick loop is single-flighted through the existing shared `lib/concurrency-guard.mjs` (`createConcurrencyGuard(tick, { maxAgeMs: 30 * 60_000, log })`) — reuse of the F-P215/F-Q406 standardized fix, no new mechanism. Both call sites (immediate boot tick, 30s interval) route through the guard; an overlapping interval fire logs `tick skipped (in-flight)` and does nothing. maxAgeMs=30min force-clears a wedged tick (deadlock recovery over strict exclusion — same posture as the graph-cache usage).

**Evidence.** Tests: 1493/0 (5 new in `test/daemon-tick-guard.test.mjs` — behavioral single-flight + 4 source-wiring assertions; the first tests defending `workspace-bin/memory-daemon.mjs`). Runtime: daemon PID 9102 on repo code; induced long tick (planted gateway session `repair-11-verify`) → boot tick started 15:36:54, interval fire at 15:37:24 logged `tick skipped (in-flight)`, log shows one continuous Phase-0→Phase-2 sequence with zero interleaving; watcher recorded `memory.ingested` (`status:ok`) through the guarded tick.

**No architectural decision needed** — mechanical reuse. Carry-forward: `repair-11-verify` (4 messages) remains in state.db as a known fixture for 1.4's dedup proof; skip-line frequency doubles as a chronic-long-tick signal for 3.1. OUT_OF_SCOPE captured: Phase 0 bootstrap's `memory-maintenance` exits 1 while Phase 2's succeeds.

---

## 2026-06-02 — Inventory v2: atomization review (operator-directed) — 30 → 48 steps, Goal+Proof per step, 9-phase binding

**Decision.** The v1 inventory failed an operator review on three criteria and was rewritten in place:
1. **Atomization:** 13 v1 steps bundled ≥2 independently-verifiable outcomes (the "and" test from the redesign atomicity rule). All split — full ledger in INVENTORY's "Atomization revision log". Three bundles kept deliberately because their parts are NOT independently verifiable (3.3 expose+consume queue state — exposure alone is dead code; 4.1 shutdown ordering — one behavior; 6.1 record field + UI key — only the surviving panel is observable); each justified inline.
2. **Structure:** every step now carries an explicit **Goal** (single outcome) + **Proof** (concrete runtime-observable gate with thresholds where measurable). Rule stated at the top: no produced Proof → step not done; no writable Proof → step not startable (binds the 2 defined-at placeholders 2.9/3.4 and Block P).
3. **Procedural:** the per-step 9-phase lifecycle (WORKFLOW §3 — Scope→§0 Re-Orient→AUDIT_PRE→implement→VERIFY(tests+runtime)→AUDIT_POST→corrections→Deep-Review-Gate→commit, macro Re-Orient per block close, §7.3 tripwire) is now bound explicitly in the INVENTORY header; the copied WORKFLOW.md was repointed at this plan's docs (FINDINGS instead of MEMORY_REDESIGN, D7/D8 as the intent check instead of DESIGN_INPUTS, plan-local audits/ path) — protocol itself unchanged.

**Why.** Operator directive (verbatim criteria): maximize atomization to the simplest implementable task; every task needs a clear goal and a validation point that must be proved; procedure must follow the 9-phase step protocol as in the prior workplan. A verbatim-copied WORKFLOW with redesign references is itself the drift disease this discipline exists to kill.

**Consequences.** 48 active steps (46 fully specified, 2 defined-at), 4 parked. Step numbering changed from v1 — FINDINGS R-ids are the stable references. Next executable step remains 1.1.

---

## 2026-06-02 — D8: LLM infrastructure gets an audit-first block; no further LLM wiring until measured

**Decision.** The local LLM layer (llm-client, ollama-queue, query-analysis, extraction calls, concept-note summaries, health-watch's LLM introspection) is treated as **untrusted wiring** until a read-only audit (`step 3.1 → LLM_INFRA.md`) measures it end to end: every call site, the full timeout chain, cold/warm latencies per model, model-selection reality vs the MASTER_PLAN "tiered selector (qwen3:8b floor)" claim, and the pre-warm gap. Remediation steps (3.4) are defined from the audit, not guessed.

**Why.** Operator verdict (verbatim intent): the local LLM infrastructure is a crucial part of this harness and looks badly wired. Track record agrees: the 1s analysis ceiling made LLM analysis structurally impossible until 2026-06-01 (OUT_OF_SCOPE entry, resolved); the queue's single-flight invariant is breakable by a second caller's timeout (R11); health-watch's LLM stuck-detection inspects its own empty in-process queue and can never fire (R12). Three independent symptoms of wiring-by-assumption. MASTER_PLAN §4.5: reality before aspiration.

**Consequences.** Block 3 ordering: audit (3.1) → known mechanical fixes (3.2, 3.3) → audit-derived remediations (3.4, defined at block-open). The known fixes are NOT blocked on the audit (they're verified findings), but no new timeout values, model choices, or pre-warm strategies get committed before 3.1's numbers exist.

---

## 2026-06-02 — D7: the Obsidian vault is TRUSTED + FULLY TRANSPARENT for the dev/test phase

**Decision.** All local synthesis paths write everything — no privacy filtering on the vault, MEMORY.md, concept/session notes, digests, or watcher surfaces. `respectPrivacy:false` becomes the deliberate, uniform local posture (it was already the de-facto posture on the flush path and the inject server; the consolidation path's filtering was the inconsistent holdout). The `private` column and the filtering machinery are **retained in code and schema** (federation-era semantics, D4) but not consulted by any local writer. The vault + wikilink graph is the referential system — the operator's primary monitoring surface — and must be complete and on display.

**Why.** Operator directive (2026-06-02, verbatim intent): everything as transparent as possible to monitor a maximum during testing and development; the vault and link system IS the referential system and must be implemented and working. The previous state was the worst of both worlds: a referential system built on default-private data, with one path filtering (producing near-empty output) and another bypassing (silently violating the documented invariant) — R6 in FINDINGS_2026-06-02.md. A referential system that hides its referents is not a referential system.

**Security remark (parked, revisit at working-prototype / before federation or any vault sync):**
- The vault may be cloud-synced (iCloud/Dropbox/Syncthing) — transparent content leaves the machine with it (R36).
- `memory.retrieved` events persist prompt plaintext (first 200 chars) into the event stream + watcher.jsonl (R35).
- The mission-control file API currently jails to all of `~/.openclaw`, which contains `identity.key`, `.mesh-secret`, `discord.token`, telegram credentials (R34) — unauthenticated localhost read. ~1-line narrowing; recommended early even within the parked block.
These are accepted exposures **for now**, by operator decision, in exchange for maximum observability. Block P holds them; un-parking requires an operator decision logged here.

**Consequences.** Step 2.1 unifies every path on transparent and removes the contradiction. Privacy work is *out* of the local-first scope entirely; it returns as a federation concern (the offerer/acceptor boundary is where filtering matters — that infrastructure stays intact). Turn-grain mechanics (turn_index, R5) still get fixed in 1.5 because correct provenance is valuable for ranking and debugging regardless of privacy.

---

## 2026-06-02 — Plan created: repair (post-review correction + upgrade)

**Decision.** New plan silo `memory-plan/plans/repair/` created from the 2026-06-02 deep review (4 parallel review agents + hand-verification of critical claims; baseline in `FINDINGS_2026-06-02.md`, 42 findings R1-R42). 30 active steps across 7 blocks + a parked security block (P). Block order: 1 stop-data-corruption → 2 vault referential system (operator headline) → 3 LLM infra (audit-first) → 4 daemon lifecycle → 5 retrieval freshness → 6 watcher/UI → 7 repo↔runtime defense.

**Why Block 1 before the headline Block 2.** The vault is generated from the entity/theme/decision tables. R1 (compounding decay) + R2 (non-idempotent reinforcement) + R3 (tick re-entrancy) + R4 (re-extraction) actively corrupt those tables on a 30-minute cadence — 961 of ~1,070 entities ever seen are already archived, survivors' salience/mention_count are scheduler artifacts. A referential system rendered from that data would lie. Block 1 is 6 small steps; it stops the bleeding and repairs the data (1.6) so Block 2 builds on truth.

**Consequences.** Redesign plan stays closed at v6.5 (Blocks 0–6 COMPLETE; its Block 7/federation remains deferred — now joined by parked R37). The redesign tick chain stays disabled; repair has no tick automation yet (built on operator demand, see INVENTORY "Work infrastructure"). One scope active at a time, repo-wide, unchanged.
