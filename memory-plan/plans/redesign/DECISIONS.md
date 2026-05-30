# Decisions Ledger

Append-only. Newest at top. Each entry: date, decision, why, consequences. Referenced by MASTER_PLAN §4.8 and §11.

---

## 2026-05-29 — Step 1.5 closed: memory.error wired at all caught boundaries → Block 1 COMPLETE

**Decision.** `emitErrorEvent(boundary, err, sessionId)` added to the memory daemon. Wired at all 7 catch-block boundaries: 3 ingest (Phase 0 bootstrap, Phase 2 throttled, end-of-session archive), 3 extract (ACTIVE→IDLE flush, IDLE→ENDED flush, NATS-triggered flush), 1 retrieve (inject server HTTP 500). Follows the same fire-and-forget pattern as existing emitters. Inject server uses its closure `eventLog`/`nodeId` (from step 1.4). VERSION `v1.4 → v1.5`.

**Design.** One new helper `emitErrorEvent(boundary, err, sessionId)` parallels `emitIngestEvent`/`emitExtractEvent`. `error_code` derived from `err.code || err.constructor?.name || 'UNKNOWN'`; `error_message` truncated to 500 chars; `session_id` optional (available at extract boundaries via `path.basename(currentJsonl, '.jsonl')`; absent at batch-ingest boundaries). Inject server emits inline without the helper (closure access to `eventLog`/`nodeId`).

**Evidence.** Tests: 1383/0 (2 new: `buildMemoryEvent('memory.error')` validates against `MemoryErrorSchema` with and without `session_id`). Stream: `nats stream get local-events-daedalus 9` → 432B `memory.error` event with `boundary=ingest`/`error_code=TEST_INDUCED`/`error_message=Step 1.5 runtime verification`/`session_id=test-1-5`/`node_id=daedalus`. Daemon: PID 66385 running with NATS connected, zero new errors.

**Block 1 close.** This is the last step of Block 1 (L1 event log spine). All 5 steps closed: 1.1 (schemas), 1.2 (ingest producer), 1.3 (extract producer), 1.4 (retrieve/inject producers), 1.5 (error producer). The event log spine is complete — every wired boundary now reports both success and failure events to `local-events-daedalus`. Block 2 (memory-watcher) can consume these to classify op outcomes.

**Macro re-orient (Block 1 close, WORKFLOW §7.2).** Block 1 served the north star by making every memory operation observable via structured events — the prerequisite for D6 (the watcher). The block produced 8 boundary-event schemas + 4 producer types (ingested, extracted, retrieved+injected, error) covering all active pipeline boundaries. Carry-forward: Block 2 has a real event stream to subscribe to, with error events distinguishing failures from silent no-ops. The 5 original unproduced schemas (`turn_recorded`, `concept_mentioned`, etc.) remain — their fate is a Block 2 or later decision; they are not boundary events and aren't needed for the watcher's op classification.

**Consequences.** Block 2 step 2.1 (watcher core: subscribe to event log, persist per-op records) is the next step. The watcher subscribes to `local.>` on `local-events-daedalus` and classifies each event by its `event_type`.

---

## 2026-05-29 — Step 1.3 closed: memory.extracted producer wired at extract boundary

**Decision.** `emitExtractEvent(sessionId, extraction)` added to the memory daemon. It calls `buildMemoryEvent('memory.extracted', ...)` → `localEventLog.publishLocal()` (fire-and-forget with catch). Wired at all 3 flush boundaries: ACTIVE→IDLE pre-compression flush, IDLE→ENDED end-of-session flush, NATS-triggered extraction. Fires only on LLM extractions (`result.extraction` present, mode='llm'), not regex fallback. VERSION `v1.2 → v1.3`.

**Design.** Two-layer change: (1) `runFlush` in `lib/pre-compression-flush.mjs` extended to return an `extraction` detail object (session_id, per-type counts, duration_ms) on the LLM path — additive, no existing callers affected. (2) Daemon's `emitExtractEvent` consumes the detail + adds `DEFAULT_MODEL` (imported from `llm-client.mjs`) as the `model` field.

**Evidence.** Tests: 1379/0 (1 new: `buildMemoryEvent('memory.extracted')` validates against `MemoryExtractedSchema`). Stream: `nats pub` → 465B event → `nats stream get local-events-daedalus 4` → full `memory.extracted` event with session_id/entities_count=7/themes_count=3/mentions_count=7/decisions_count=2/model=qwen3:8b/duration_ms=8500/node_id=daedalus. Daemon: PID 62081 running with NATS connected, zero new errors.

**Consequences.** Step 1.4 follows the same pattern for `memory.retrieved` + `memory.injected` at the inject server boundary (`lib/memory-inject-server.mjs`). `DEFAULT_MODEL` import is now established in the daemon.

---

## 2026-05-29 — Step 1.2 closed: memory.ingested producer wired at ingest boundary

**Decision.** `emitIngestEvent(sessionId, source, messageCount)` added to the memory daemon. It calls `buildMemoryEvent('memory.ingested', ...)` → `localEventLog.publishLocal()` (fire-and-forget with catch). Wired at all 3 session-import boundaries: Phase 0 Bootstrap (`importDirectory` onImported callback), Phase 2 Throttled Work (same), IDLE→ENDED transition (inline after `importSession`). VERSION `v1.1 → v1.2`.

**Design.** `SessionStore.importDirectory()` gained an opt-in `onImported` callback fired per successfully imported session — existing callers unaffected. The daemon passes `(r) => emitIngestEvent(r.sessionId, source.name, r.messageCount)`. No changes to `importSession` itself; event emission lives at the daemon layer, not the store layer.

**Evidence.** Tests: 1378/0 (2 new: `buildMemoryEvent('memory.ingested')` validates against `MemoryIngestedSchema`). Stream: `nats stream get local-events-daedalus 3` → full `memory.ingested` event with session_id/source/messages_added/total_messages/node_id/actor/timestamp. Daemon: PID 59112 running with NATS connected, zero new errors.

**Consequences.** Steps 1.3–1.5 follow the same pattern: add `emit<Op>Event` + wire at the relevant boundary. The extraction boundary (1.3) is in the flush/extraction code paths, not session-store.

---

## 2026-05-29 — Step 1.1 closed: memory.* event vocabulary defined

**Decision.** 8 boundary-event Zod schemas added to `packages/event-schemas`: `memory.ingested`, `memory.extracted`, `memory.retrieved`, `memory.injected`, `memory.synthesized`, `memory.decayed`, `memory.promoted`, `memory.error`. These are operation-boundary events (one per pipeline run) designed for the Block 2 memory-watcher to consume. VERSION `v0.4 → v1.1`.

**Design.** Each schema extends `EventEnvelopeSchema` with `entity_type: 'memory'` and operation-specific `data` fields (counts, durations, trigger types). The `MemoryEventSchema` discriminated union now has 16 members (8 original + 8 new). Existing schemas untouched — backward compatible. No architectural decision needed; this is pure schema work.

**Evidence.** Unit tests: 1376/1376 pass (10 new cases for the boundary schemas). NATS round-trip: `nats pub` → 472B `memory.ingested` event → `nats stream get local-events-daedalus 2` → all fields intact.

**Consequences.** Steps 1.2–1.5 wire `publishLocal(buildMemoryEvent('memory.<type>', ...))` at each boundary. The 5 original unproduced schemas (`turn_recorded`, `concept_mentioned`, `snapshot_taken`, `artifact_attached`, `compaction_triggered`) remain — their fate is a separate decision, not Block 1's concern.

---

## 2026-05-29 — Step 0.4 closed → Block 0 (L0) COMPLETE

**Decision.** The memory daemon is wired to the local NATS node and its per-node event-log stream `local-events-daedalus` is live and writable. Block 0 (L0: deploy gap + local NATS substrate) is done; VERSION `v0.3 → v0.4`. Next is Block 1 (emit `memory.*` events at the ingest/extract/inject boundaries), inventory step 1.1.

**Why / how.** The daemon plist already carried `OPENCLAW_NATS=nats://127.0.0.1:4222` + `OPENCLAW_NODE_ID=daedalus` (a launchd-plist override, highest-priority in the resolution order, leaving `~/.openclaw/openclaw.env` and the mesh consumers pointed at the remote IP). The daemon was simply **not loaded**; `launchctl bootstrap` started it (PID 42661). Evidence: `NATS connected`, `Local event log initialized (stream: local-events-daedalus)`, `nats stream ls` shows the stream, CLI test publish → `stream info` messages = 1, and `Shared stream unavailable … continuing` (federation D4 dormant, no crash).

**Node-id decision.** `OPENCLAW_NODE_ID=daedalus` is mandatory, not cosmetic: the default `os.hostname()` (`MoltyMacs-Virtual-Machine.local`) contains dots, which are illegal in a JetStream stream name (`local-events-<id>`). Set in the plist; `.daemon-state-<hostname>.md` regenerates each poll, old one inert.

**Done-evidence refinement (MASTER_PLAN §5).** INVENTORY 0.4 said "`~/.openclaw/local-events/` exists" — stale. The event log is a JetStream stream (`local-events-daedalus`, store under `~/.openclaw/nats/jetstream/`), not a loose directory. INVENTORY note + registry 1.7/7.1 updated to the real observable.

**Macro re-orient (Block 0 close, WORKFLOW §7.2).** Block 0 served the north star by closing the deploy gap (0.1 lib symlink, 0.2 daemon-binary symlink — runtime now runs repo code) and standing up the local-first event substrate (0.3 NATS node, 0.4 daemon↔stream). The D3 local event log the L2 watcher will consume now exists. Carry-forward: Block 1 has a real broker to publish to. Note: the running daemon emits silent extraction Zod rejections + a native worker crash at boot (captured in OUT_OF_SCOPE 2026-05-29) — live targets for Block 2 (watcher) + step 3.4 (tolerant extraction).

**Consequences.**
- `MemoryBudget.publishLocal()` now has a live broker (was silently failing). Producer wiring for the 5 unproduced `memory.*` schemas is still Block 1.
- The autonomous redesign tick chain is currently **unloaded** (operator chose to drive 0.4 interactively). Re-enable via the viewer Automation tab when Block 1's lighter steps are ready for autonomous ticking.

---

## 2026-05-28 — RESTRUCTURE: fully siloed `plans/` tree (supersedes the six-shared-doc model below)

**Problem (operator directive).** The "six governance docs shared at `memory-plan/`" boundary (entry directly below) was still operator-rejected: the viewer kept centering on the completed `memory-plan` plan and the shared docs blurred plan boundaries. Directive, verbatim: *"RESTRUCTURE: EVERYTHING IS SILOED, AND IF NECESSARY THE DIFFERENT DOCUMENT WILL BE SHARED."* Chosen layout (via AskUserQuestion): a new `plans/` tree.

**Decision (FINAL).** Each plan is a self-contained directory under `memory-plan/plans/<id>/` owning ALL its docs — SCOPE, DECISIONS, COMPONENT_REGISTRY, OUT_OF_SCOPE, MEMORY_REDESIGN, INVENTORY, VERSION, WORKFLOW, TICK_PROMPT, audits/, tick-logs/, automation.json. The **only** shared doc is `MASTER_PLAN.md`, which stays at `memory-plan/` (one level above the discovery root). Resulting tree:
- `memory-plan/MASTER_PLAN.md` — the ONE shared doc.
- `memory-plan/plans/legacy/` — the completed 58-step plan (was the top-level `memory-plan` plan; keeps the original governance docs).
- `memory-plan/plans/redesign/` — the active plan (was `memory-plan/redesign/`; seeded with copies of the governance docs).

**How.** `git mv` preserved history for all 167 tracked files (legacy docs → `plans/legacy/`, the redesign dir → `plans/redesign/`, `MEMORY_REDESIGN.md` → redesign). Redesign's DECISIONS/COMPONENT_REGISTRY/OUT_OF_SCOPE were `cp`-seeded from the legacy originals; each plan now appends to its own going forward (they will diverge — intentional).

**Four rewires.**
- **Hook** (`.claude/hooks/scope-check.sh`): now per-plan — scans every `plans/*/SCOPE.md`, keeps those `active` + unexpired, unions their `files` blocks. Legacy single-gate fallback retained for the pre-restructure state. Escape valves: every plan's own `SCOPE.md`/`OUT_OF_SCOPE.md` (+ legacy `memory-plan/{SCOPE,OUT_OF_SCOPE}.md`). One scope active at a time preserved.
- **Viewer** (`workplan-viewer.mjs`): `SHARED_DOCS = ['MASTER_PLAN.md']`; default `ROOTS = <cwd>/memory-plan/plans`; shared-doc resolution walks up to `sharedRoot(plan) = dirname(plan.root)` = `memory-plan/`. *Verified:* discovers `legacy` (58/58) + `redesign` (3/40), redesign owns 8 docs + inherits MASTER_PLAN as `shared`, MASTER_PLAN serves via `/doc`.
- **CLAUDE.md**: bootstrap paths point at `plans/redesign/*`; forcing-function section rewritten for the per-plan hook.
- **redesign-tick.sh + redesign/automation.json**: `PLAN_DIR` and tick-log paths repointed to `plans/redesign/`. *Verified:* `--preflight` resolves to `plans/redesign`, next step 0.4.

**Consequences.** `COMPONENT_REGISTRY.md` (live service reality) is now duplicated per-plan and will drift — accepted per the siloing directive. Legacy's tick automation still hardcodes pre-move paths but is dead (plan complete, unloaded) → captured in `plans/legacy/OUT_OF_SCOPE.md`, deliberately not half-fixed. The active session scope currently lives in `plans/legacy/SCOPE.md` (the restructure contract); operator should flip it dormant and activate `plans/redesign/SCOPE.md` to resume step 0.4.

## 2026-05-28 — Tooling: workplan-viewer per-plan doc wiring (shared docs at root, plan-specific in subdir)

**Problem (operator-reported, repeatedly).** The viewer showed the legacy `memory-plan` plan with full Master-Plan/scope/decisions data but the live `redesign` sub-plan blank. Root cause: `readPlanFile()` read shared docs only from `plan.dir`. The 4 project-wide docs (SCOPE/COMPONENT_REGISTRY/DECISIONS/OUT_OF_SCOPE) live once at `memory-plan/`, not in `memory-plan/redesign/`, so every shared-doc endpoint returned `{present:false}` for the redesign plan.

**Decision (FINAL) — the project-wide governance docs are the shared "common basics"; per-plan operational state is isolated.** The boundary that satisfies the operator's two constraints ("main docs stay in root and are shared" AND "each plan separate, what's specific to a plan stays in that plan") is:
- **Shared (live once at the plan-root, inherited by every plan):** `MASTER_PLAN.md`, `MEMORY_REDESIGN.md`, `COMPONENT_REGISTRY.md`, `DECISIONS.md`, `SCOPE.md`, `OUT_OF_SCOPE.md`. These are project-wide — one north star, one decision ledger, one registry, one scope. `SHARED_DOCS` lists exactly these; `readPlanFile` falls back self-then-parent only for these names.
- **Strictly per-plan (resolve from `plan.dir` alone, never inherited):** `INVENTORY.md`, `VERSION`, `WORKFLOW.md`, `TICK_PROMPT.md`, `audits/`, `tick-logs/`, `automation.json`, and the Live / Progress / History streams.

A brief detour narrowed `SHARED_DOCS` to just `MASTER_PLAN.md`, which left the redesign Master-Plan tab empty — operator rejected ("redesign have nothing in it"). Reverted to the six-doc shared set above. *Net:* `redesign` shows the shared scope/registry/decisions/out-of-scope (inherited from `memory-plan/`) plus its own INVENTORY/WORKFLOW, while its Live/Progress/automation are its own. `memory-plan` owns all six physically → no fallback needed. `SCOPE.md` stays load-bearing for the scope-check hook (hardcoded `memory-plan/SCOPE.md`); the hook reads the file directly and is unaffected by viewer wiring.

**Follow-up — same principle applied to the remaining tabs (Documents / Live / Progress / History).**
- **Documents** lists the plan's own `*.md` (`scope:'plan'`) plus the six shared governance docs from the parent (`scope:'shared'`) when the plan doesn't own them. `/doc` falls back to the parent **only** for exact `SHARED_DOCS` names (no path traversal — verified non-whitelisted parent file → 404). *Verified:* redesign Documents = 3 own + 6 shared; `memory-plan` owns all itself, no parent fallback.
- **Live** had a genuine bug: the client listens only for `append`/`switch`, never `file`, and the empty branch sent only a `file` event → the pane was stuck on "connecting…" forever.
- **Live + Progress stream ONLY each plan's real agent work output — artifact feed reverted.** A first attempt derived a per-plan activity feed from git commits + audit files (`planArtifactActivity`) as a fallback for plans with no scheduler tick-log. The operator rejected this: they want the **agent's actual streaming work output** for the plan being worked on, not git history dressed up as a live flow. Reverted. Now `/stream` (Live) tails `plan.dir/tick-logs/current.log` and `/activity-stream` (Progress) parses `plan.dir/tick-logs/*.jsonl` — strictly per-plan, the source the scheduler agent writes via stream-json. When a plan has no tick-log yet (e.g. `redesign`, never run by its scheduler), both tabs show one honest message: "No agent run recorded for this plan yet. Activate this plan's automation … and its live work output will stream here." If that plan's scheduler later produces a tick-log, the interval auto-detects it and begins streaming live. *Why:* the only thing that is genuinely "the flow done in plan X" is plan X's own agent stream; deriving a feed from commits was wrong wiring.
- **Automation is strictly per-plan independent (verified, no change needed).** Each plan's launchd label is derived from its id: `com.openclaw.<id>-tick` → `com.openclaw.memory-plan-tick` vs `com.openclaw.redesign-tick`. `getAutomationState(plan)` queries only that plan's own label via `launchdStatus(cfg.plist_label)`, and load/unload act on the plan's own `plist_label`+`plist_path`. So activating one plan's scheduler cannot flip another's loaded state, and each writes to its own `plan.dir/tick-logs/`. *Verified:* both plans report distinct labels, distinct stdout paths, both `loaded:false`.

*Consequences:* (1) Shared docs populate every plan: `curl /api/plans/redesign/{scope,registry,decisions,out-of-scope}` → all `present:true` (inherited); `memory-plan` → all `present:true` (owns). Documents: redesign = 3 own + 6 shared; memory-plan = its own. (2) Per-plan operational state is isolated: Live/Progress are real per-plan agent streams — `redesign` → honest empty-state ("activate this plan's automation"), `memory-plan` → its real `current.log` + `*.jsonl`. (3) Automation strictly per-plan (distinct launchd labels `com.openclaw.<id>-tick`, distinct tick-log dirs; loading one cannot flip another). (4) Viewer restarted (bare `node`, not launchd; `WORKPLAN_ROOTS` preserved; PID 70714). (5) **0.4 paused, not abandoned** — daemon plist already edited (`OPENCLAW_NATS` + `OPENCLAW_NODE_ID=daedalus`, `.bak-2026-05-28`) but not reloaded; resume = bootout+bootstrap the daemon, verify `local-events-daedalus` stream + test publish, close Block 0.

---

## 2026-05-28 — Step 0.3 closed: local NATS (JetStream, loopback) running as launchd service

A single-node `nats-server` (homebrew v2.12.6) now runs under launchd (`ai.openclaw.nats`), bound to `127.0.0.1:4222` (monitor `:8222`), JetStream enabled (store `~/.openclaw/nats/jetstream/`, caps 128MB mem / 1GB file). Self-healing (KeepAlive) and verified to survive `kickstart -k` (PID 58563 → 58591). This is the local event-log substrate (D3) the watcher (L2) will read.

**Finding — "you already have NATS" was the remote mesh, not a local server.** `~/.openclaw/openclaw.env` sets `OPENCLAW_NATS=nats://100.91.131.61:4222` (Ubuntu worker's Tailscale IP, currently down) — that's why the daemon logged `NATS unavailable (TIMEOUT)`. The resolver chain ([lib/nats-resolve.js](../../../lib/nats-resolve.js)) is env var → `openclaw.env` → `~/openclaw/.mesh-config` → `127.0.0.1:4222` fallback, so the remote IP wins. That remote mesh is the federation layer D4 keeps dormant — NOT the local piece 0.3 needs.

**Decision — install local NATS (operator chose "follow the plan" over reusing the remote mesh).** *Why:* the whole redesign is local-first; the event log is meant to be a local substrate; D4 explicitly defers federation until the local core is solid; and reusing the remote depends on a remote box staying up. The local node is loopback-only (no off-box exposure, no auth needed for 127.0.0.1) and is a separate interface from the remote — no conflict.

**Decision — single loopback node, NOT the repo `services/nats/` 3-node cluster.** Those cluster plists are the G-phase / step 10.2 deliverable (R=3 federation). For L0, a single node is correct (MEMORY_REDESIGN L0: "single-node for local; the 3-node cluster is a G-phase concern").

**Decision — 0.4 will point the daemon at local via its launchd `OPENCLAW_NATS` env var, NOT by editing `openclaw.env`.** The env var is resolution step 1 (highest priority); the resolver's own comment names launchd as the intended override. This keeps mission-control + all `mesh-*` scripts pointed where they are (at the remote mesh config) while the memory daemon uses the local node — clean separation, no collateral.

*Consequences:* (1) COMPONENT_REGISTRY 7.1 → LOCAL NODE RUNNING (streams not yet created). (2) `openclaw.env` and the `mesh-*` launchd jobs left untouched (D4 dormant). (3) Disk is at 94% (12 GiB free) → JetStream file store capped at 1GB; revisit if the event log grows. (4) Rollback: `launchctl bootout gui/501/ai.openclaw.nats` + `rm` the plist. (5) Next: 0.4 — daemon ↔ local NATS, create the `local-events-<nodeId>` stream, confirm a test publish lands.

---

## 2026-05-28 — Step 0.2 closed: daemon binary symlinked + restarted; code half of deploy gap CLOSED

Runtime `~/.openclaw/workspace/bin/memory-daemon.mjs` is now a symlink → repo `workspace-bin/memory-daemon.mjs`, and the daemon was restarted onto it (launchd kickstart). **First time new-bin + new-lib ran together** — and they run clean. New PID 51216 (≠ old 869), executing the symlinked repo file, stable 2:48+ past the 10s ThrottleInterval, `:7893` → 401. The code half of the deploy gap is closed: the running daemon IS repo HEAD. Only NATS remains (0.3/0.4).

**Done-evidence refinement (the planned substitution, now confirmed necessary).** INVENTORY 0.2 done-evidence said "after restart a log line only current code emits appears." Verified impossible at 0.2: old/new startup banners are byte-identical, and *every* new-only log line is gated behind a successful NATS connection ("Shared stream OPENCLAW_SHARED verified" etc.), which won't happen until NATS is up (0.4). Substituted per MASTER_PLAN §5 — "a process state visible in ps/launchctl that only the new code creates": the symlink target + new PID executing the repo file + crash-loop-free stability. The NATS-gated lines become deferred confirming evidence at 0.4.

**Restart-instant native crash investigated, ruled benign.** Two lines hit `.err` at the exact restart instant (mtime 16:34:10): `libc++abi: … mutex lock failed: Invalid argument` (count 1) and `[memory-daemon] PID check failed (process not alive): kill ESRCH`. Both belong to the **old** process (869) being torn down: its better-sqlite3 native binding hit a mutex while SIGTERM killed it mid-operation; the watchdog then saw 869 gone. *Proof they're not the new code:* after these lines, new PID 51216 ran 2:48+ adding zero further `.err` lines with the inject server responding — the `.err` size/mtime are frozen at the restart instant. Not a regression; a one-time shutdown artifact of the dying old process.

*Consequences:* (1) COMPONENT_REGISTRY Family 8 → CODE CLOSED (both `lib/` and binary are live symlinks; remaining gap is NATS only, not code). (2) Rollback binary `bin/memory-daemon.mjs.bak-2026-05-23` retained; full data security copy at `~/.openclaw/backups/pre-step-0.2-2026-05-28/`. (3) Pre-existing Zod extraction-validation errors (`Invalid option: expected one of "depends_on"|…`) persist as the known baseline — unrelated to the deploy gap, a separate extraction-schema issue to triage (OUT_OF_SCOPE candidate). (4) Next: 0.3 install local NATS (JetStream) as a launchd service.

---

## 2026-05-28 — Step 0.1 closed: lib/ deploy gap closed via symlink; mcp-knowledge deps = "move the box"

First executable redesign step. Runtime `~/.openclaw/workspace/lib` is now a symlink → repo `lib/`. The `lib/` deploy gap is permanently closed (repo IS runtime for libraries; drift cannot reopen).

**Sub-decision — mcp-knowledge native deps: Option A (move the box).** The daemon's inject server dynamically imports `lib/mcp-knowledge/core.mjs`, which needs 580 MB of compiled native deps (better-sqlite3 + BGE-M3 stack) that existed ONLY in the runtime copy. A naive symlink would have yanked them and broken retrieval. Chosen: move the existing, already-working node_modules into repo `lib/mcp-knowledge/node_modules` (same-FS instant rename; already gitignored) BEFORE flipping the symlink. *Why over the alternatives:* reuses deps proven to load under the daemon's exact node (zero ABI/rebuild risk vs. a fresh `npm install`); keeps a clean single source vs. symlinking node_modules back into the retired runtime dir.

**No restart in 0.1** (by design — restart is 0.2). The running daemon (PID 869) keeps its in-memory modules; the swap doesn't disturb it. "Still boots" verified as: daemon alive + :7893 up + better-sqlite3 loads/runs through the symlink under `~/.openclaw/bin/node`.

*Consequences:* (1) daemon binary still drifted until 0.2 — first new-bin+new-lib run happens at 0.2 restart; watch boot log for missing-import/signature errors against the 11 repo-only lib files. (2) Rollback snapshot `~/.openclaw/workspace/lib.bak-2026-05-28` retained until 0.2 confirms a clean restart. (3) COMPONENT_REGISTRY Family 8 now PARTIALLY CLOSED.

---

## 2026-05-28 — Session boundary (handoff)

This session built the entire discipline + planning + tooling layer; **no memory-pipeline code was changed.** Committed work (git log): audit (AUDIT_2026-05-27) → discipline bootstrap (MASTER_PLAN, scope-check hook, COMPONENT_REGISTRY, CLAUDE.md) → DESIGN_INPUTS → redesign roadmap (MEMORY_REDESIGN) + 40-step atomic INVENTORY + 9-phase WORKFLOW + Re-Orient Loop → viewer Master Plan tab → redesign-tick automation (built, not loaded) → viewer transition notifications (top-right NC banner via terminal-notifier, Glass/Sosumi, names the step + time, mute toggle).

**Next action: redesign step 0.1** (deploy gap: symlink runtime→repo, start NATS), run **interactively**. No active scope — a fresh session sets one per redesign/WORKFLOW.md §6. Passation protocol is in CLAUDE.md (the auto-loaded entry point) + this ledger.

---

## 2026-05-28 — Memory redesign: 6 foundational decisions (local-first)

Operator answered the six DESIGN_INPUTS §7 open questions. Locked:

**D1 — Keep all 5 stores. Collapse nothing.** state.db (episodic), knowledge.db (semantic vec), extraction tables (entity), graph-cache.db (thematic index), + the event log. Plus the Obsidian vault as the wiki layer. *Why:* nothing already built gets thrown away. *Consequence:* the redesign is additive/repair, not a teardown. The "one-hop simplicity" bar from DESIGN_INPUTS §2 applies to NEW work, not to deleting existing stores.

**D2 — Synthesis runs on session-end AND every 30 min while a session is active.** The "turn raw → readable wiki" step has two triggers. *Why:* end-of-session captures the whole arc; the 30-min active cadence keeps long sessions fresh. *Consequence:* the consolidation/synthesis scheduler needs both an event hook (session-end) and an interval (30 min, gated on active session).

**D3 — Add the event log now; erase nothing; local-first then multi-node.** The per-node event log gets wired as part of local work. *Why:* it's the substrate the memory-watcher (D6) consumes and the future federation promoter needs. *Consequence:* event-sourcing comes back INTO scope (it was a DESIGN_INPUTS §7 tension) — accepted deliberately because the watcher needs it. Local correctness first; multi-node is a later phase. Nothing already implemented is removed.

**D4 — Federation stays, dormant/offline, until local is solid.** *Why:* it exists and works in code; turning it on now adds NATS-cluster/trust complexity before the local core is even running. *Consequence:* federation modules stay in the tree (not deleted), not launched. "Local running proper" is the gate before "going global." Nothing erased.

**D5 — Readable output = the already-documented synthesis layer; make it actually run.** Not a new design. The docs already specify: structured MEMORY.md (generated from entity/theme/decision tables — REFERENCE_PLAN Phase 3.3) + the Obsidian vault (concepts/decisions/sessions/themes notes — Phase 5) regenerated by consolidation (Phase 8). This IS the Karpathy LLM-Wiki layer-2. *Why:* the design exists; the failure is that it never executes (consolidation undeployed, vault not generating). *Consequence:* the redesign's job for #5 is to wire + run the documented synthesis, replacing the lossy daily logs (OUT_OF_SCOPE 2026-05-27) with the structured MEMORY.md + vault wiki.

**D6 — Build a memory-watcher: full observability/logging/debug device over the ENTIRE memory system.** Watches everything — who/where/how/when of every memory operation (ingest, extract, synthesize, retrieve, inject, decay, promote). Clear structured logging. Purpose: control, log, and debug what's actually happening, to eliminate silent failures and nonsense code. *Why:* the current system's #1 failure mode is silent inertness (operations that no-op without surfacing). *Consequence:* the watcher is built EARLY (right after the event log), as the verification lens for all other redesign work. It consumes the D3 event log + instruments operations directly.

These six are the foundation of MEMORY_REDESIGN.md. Local-first ordering, federation deferred, nothing deleted.

**Sub-decision (same session):** the memory-watcher's readable surface (D6) lives as a **panel in mission-control** (the existing ops UI, PID 872), not in the workplan-viewer and not standalone. Phase order L0→G accepted as proposed (operator expressed no preference → proceed with recommended order).

---

## 2026-05-28 — Atomicity revision + the Re-Orient Loop

Operator asked to (a) re-decompose steps to their most atomic level, and (b) hook a "global-view loop" into the 9-phase framework to counter the attention-span deficit when digging deep.

**Atomicity revision:** redesign INVENTORY re-decomposed 33 → 40 steps (36 local + 4 deferred). Rule applied: one step = one independently-verifiable runtime outcome. Notable splits — Block 0 deploy/NATS into 4; Block 2 watcher core vs classification, API vs UI; Block 4 (synthesis, the heart) into 9 (concept vs session notes, two triggers separated, consolidation deploy vs schedule, digest-build vs retire-old); Block 6 route vs migrate. **Ordering fix:** event-log emission for each operation is folded into the step that *builds* that operation (synthesize/decay/promote events now live in Block 4 build-steps), not front-loaded in Block 1 — Block 1 only wires events for ops that already exist (ingest/extract/inject/error).

**The Re-Orient Loop (WORKFLOW §7):** two mandatory cadences embedded in the per-step lifecycle. *Why:* deep implementation work makes the global picture fade → drift; willpower doesn't fix it, structure does.
- **Micro (every step):** Phase 1 AUDIT_PRE opens with a ≤6-line `§0 Re-orient` (where am I / last change / this step's contribution / north-star link / still-right-next?). Forces a look-up before every dig.
- **Macro (every block close):** a Global Review — re-read MASTER_PLAN+DESIGN_INPUTS, update COMPONENT_REGISTRY via runtime probes, re-atomicity-check the next block, drift check, log course-corrections. Re-establishes the whole picture ≥1×/block.
- **Tripwire:** Phase-4 sprawl or ≥2 mid-implementation findings = the step wasn't atomic → stop, re-orient, split.
*Consequence:* "the deeper you dig, the more often you must surface" is now a framework rule, not a hope. The viewer's Master Plan tab is the re-orient surface.

---

## 2026-05-28 — Redesign-tick automation: built, BLOCK-not-fake, NOT auto-loaded

Operator chose "build redesign-tick wiring first" (over running L0 interactively now). Built the autonomous tick for the redesign plan: `workspace-bin/redesign-tick.sh` + `memory-plan/redesign/TICK_PROMPT.md` + `services/launchd/com.openclaw.redesign-tick.plist`, plus fixed `redesign/automation.json` paths.

**Safety design (resolves the standing concern that a headless tick re-creates the original "59 closed, 0 working" disaster):** the TICK_PROMPT's overriding rule is **done = runtime-observable; if you cannot produce the step's runtime evidence, BLOCK — do not fake-close.** The commit format requires a `Runtime-Evidence:` trailer citing an observed runtime proof; no trailer → no commit → BLOCK. A Phase-4 sprawl tripwire forces a BLOCK-and-split when a step turns out non-atomic. So the tick can safely *attempt* steps: it self-pauses (BLOCKED.md) on anything it can't verify, surfacing it for the operator.

**NOT auto-loaded.** The plist is installed in `~/Library/LaunchAgents` but deliberately not bootstrapped (`launchctl list` shows nothing). `RunAtLoad=false`. Enabling autonomous ticks — and *for which steps* — remains a separate operator decision. Recommendation still stands (DESIGN_INPUTS / prior analysis): run the foundation phases L0–L2 interactively (runtime-heavy, need a live environment + operator judgment); reconsider the tick for mechanical/test-verifiable steps only after the watcher (L2) provides observability.

*Consequence:* the automation exists and is verifiable (`redesign-tick.sh --preflight` reports next step without invoking claude) but inert until explicitly enabled. The viewer's Automation tab can load it when the operator decides.

---

## 2026-05-28 — Viewer emits banner+sound on plan state transitions

The workplan-viewer now fires the existing `memory-plan-notify.sh` server-side on plan transitions (a 12s poller diffs each plan's {version, blocked, closed_steps}):
- **Forward** (step closed / version advanced) → `closed` → **Glass** chime + banner.
- **Blocked** (a plan's BLOCKED.md appears) → `blocked` → **Sosumi** alert + banner.

*Why server-side:* it fires whether or not a browser tab is open — the right behavior for an operator monitoring autonomous ticks. *Why reuse notify.sh:* one source of truth for sounds/banners shared with the tick wrapper. First-sight of a plan seeds silently (no startup storm); `MEMORY_PLAN_NOTIFY=off` disables. A `/api/notify-test?kind=forward|block` endpoint verifies the wiring. Verified: both test kinds fire (enabled:true); a real induced block transition (touch redesign/BLOCKED.md) produced `[notify] redesign BLOCKED at v0.0` and the banner, then cleared.

**Amended 2026-05-28 (operator: "leave the banner until I discard it" → "both persist"):** transient `display notification` banners auto-dismiss and their persistence is only a per-app System-Settings toggle (not script-controllable). So `memory-plan-notify.sh` now renders a **detached `display alert` WINDOW** that stays until the operator clicks Dismiss — for BOTH forward (Glass) and block (Sosumi, `as critical`) — with no `giving up after`. Launched `nohup … &` so the caller returns immediately and the window survives independently; the afplay chime still plays. Trade-off accepted: a focus-grabbing window pops per transition (operator chose this over the System-Settings route). Viewer needs no change (execs notify.sh by path). Verified: direct + viewer-path calls return in ms and leave persistent windows; grep confirms no auto-dismiss.

**Added 2026-05-28 (operator: "add a switch to activate/deactivate"):** the workplan-viewer has a runtime on/off switch — a header 🔔/🔕 toggle button + `GET|POST /api/notify-config?enabled=0|1`. The flag is mutable (`notifyEnabled`, honored by `fireNotify`) and persisted to `~/.openclaw/config/workplan-viewer.json`, so it survives viewer restarts (boot value = persisted file, else the MEMORY_PLAN_NOTIFY env default). Verified: get/set/persist + a real restart loads the saved value; disabled → notify-test no-ops (no window).

**Corrected 2026-05-28 (operator: "I want a top-right Notification Center banner, not a modal"):** the `display alert` modal window was WRONG — it's center-screen and focus-grabbing. `memory-plan-notify.sh` now posts a real **top-right NC banner** via **terminal-notifier** (`brew install terminal-notifier`, 2.0.0), with an `osascript display notification` fallback (also top-right). Glass for forward, Sosumi for block. No `display alert` remains.
- **Persistence is a macOS System Setting, not scriptable:** to make banners STAY until dismissed (vs auto-dismiss ~5s), set **System Settings → Notifications → terminal-notifier → "Alerts"** (one-time). Default install style is "Banners" (auto-dismiss).
- **First-run permission:** macOS may require granting terminal-notifier permission to send notifications before banners appear.

**Enriched 2026-05-28 (operator: "can it show the step?"):** the banner message now names the step, not just the version. The viewer looks up the inventory row matching the new version → forward = "step X.Y closed — <desc>" (or "(pre/mid)" while in-flight); block = "blocked at step X.Y — <desc>" (the step it's stuck on). `/api/notify-test?kind=&plan=` renders the real message for a named plan and returns it in JSON; the poller logs it. Verified: forward/block test messages name step 0.1 + its description; a real induced block logged "blocked at step 0.1 — Symlink runtime lib/ → repo lib/".

**Time added 2026-05-28 (operator: "could it show time as well?"):** `memory-plan-notify.sh banner()` appends Montreal-local `HH:MM` to the subtitle (`<version> · HH:MM`), so every banner shows when it fired — applies to all callers (viewer poller, test endpoint, tick) and both the terminal-notifier and osascript paths. Verified: subtitle renders "v0.1 · 14:16".

---

## 2026-05-27 — Master-plan discipline is intentionally repo-scoped to openclaw-nodedev

**Decision:** The master plan, the scope-check hook, and the SCOPE.md contract govern work done **inside the `openclaw-nodedev` repo only.** They are deliberately NOT propagated to other repos (companion-bridge, mission-control) or to the global `~/.claude/CLAUDE.md`. Other Claude Code sessions working in other repos are unbound by this discipline.

**Why:** Operator's explicit choice. The discipline exists to fix the development pattern in *this* repo (the memory infrastructure dev work). Extending the hook to every session everywhere would impose friction on unrelated work the operator doesn't want gated.

**Consequences:**
- A session working in `~/Documents/openclaw infrastructure/companion-bridge/` gets neither the CLAUDE.md pointer nor the scope-check hook. That's intended.
- The MASTER_PLAN's stated scope ("everything in ~/.openclaw") refers to what the plan *documents and reasons about* — not what the enforcement mechanism *gates*. The registry tracks all families; the hook only blocks edits made from within this repo.
- **Do not "fix" this by adding the hook to other repos or the global CLAUDE.md.** It is not an oversight. If the operator later wants broader reach, that's a new decision logged here.

---
