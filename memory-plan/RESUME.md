# OpenClaw Memory Plan — Resume Doc

**Workplan status.** Block 1 in progress.
**Current version carrier.** `v1.2` (Step 1.2 closed).
**Streaks.** zero-Phase-4-correction: 0 of 2 (Block 1; reset due to test count underestimate) · zero-Phase-8-patch: 1 of 2 (Block 1).
**Last commit on plan branch.** v1.2 — Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring).

A fresh worker reading only this file should be able to resume the workplan with no
conversational context. The Framework that governs how steps are executed is at
[FRAMEWORK.md](FRAMEWORK.md). The full implementation plan is at
[REFERENCE_PLAN.md](REFERENCE_PLAN.md). The step list is at [INVENTORY.md](INVENTORY.md).

---

## §0 — Block-level frozen decisions

These constraints apply to every step in the **current block** (Block 1) and are not
re-litigated per step. Each block transition will reset §0 with the block's own constraints.

### Working principles (apply to all blocks)

- **Local-first.** No phase may break local offline operation. Federation features are opt-in capabilities.
- **One commit per step.** No mid-step commits, no amends, no force-pushes. The Phase 9 commit is the only commit a tick produces.
- **Block on architectural choices.** If a step needs a decision not already captured in §0 or in the prior step's `AUDIT_POST §6` carry-forwards, write `BLOCKED.md` and stop. The autonomous worker does not improvise architecture.
- **Tests are a hard gate.** A red `npm test` at Phase 5 is a block trigger, not a "fix forward" cue.
- **Workspace files are out of repo.** `/Users/moltymac/.openclaw/workspace/` is the live runtime tree (MEMORY.md, .companion-state.md, memory/*). When a step touches a workspace file, the **change is documented in the audit doc** but the workspace file itself is not committed (it's not git-tracked). Plan ledgers committed to the repo describe what landed in the workspace.

### Block 1 frozen decisions

Authored 2026-05-21 by operator (interactive viewer session).

**Scope and file list — authoritative for Block 1:** exactly what REFERENCE_PLAN §"Phase 1 — Schema & event foundations" specifies. No deviations:

- **Step 1.1** — `packages/event-schemas/`:
  - `src/envelope.ts` (`EventEnvelopeSchema` per REFERENCE_PLAN §1.1).
  - `src/memory/*.ts` — one file per payload schema: `session-started.ts`, `session-ended.ts`, `turn-recorded.ts`, `fact-extracted.ts`, `concept-mentioned.ts`, `snapshot-taken.ts`, `compaction-triggered.ts`, `artifact-attached.ts`.
  - `src/events.ts` — `MemoryEventSchema` discriminated union.
  - `package.json` declaring `zod` + `zod-to-json-schema` deps.
  - TypeScript types via `z.infer<>` exported from each module.
- **Step 1.2** — `lib/local-event-log.mjs`:
  - JetStream local stream `local-events-${NODE_ID}` at **R=1**, file-backed under `~/.openclaw/local-events/`.
  - `publishLocal(event)` API per REFERENCE_PLAN §1.2 (zod-validated, `msgID = idempotency_key`).
  - Dual-write at three call sites (see Events wiring below).
- **Step 1.3** — `lib/artifacts.mjs`:
  - `putArtifact` / `getArtifact` / `hasArtifact` / `validateArtifact` per REFERENCE_PLAN §1.3.
  - Directory layout `~/.openclaw/artifacts/sha256/<2>/<2>/<full-hash>` with `.meta.json` sidecars.
  - Local-only for now (peer NATS RPC `artifacts.fetch.<hash>` is Block 4's wiring).
- **Step 1.4** — shared JetStream cluster config:
  - Configure R=3 across the three mesh nodes (moltymac, Ubuntu VM, macOS VM).
  - Stream `OPENCLAW_SHARED` with subject filter per REFERENCE_PLAN §1.4.
  - **Configure only — no memory data flows until Block 4.** This step preps infrastructure; the cluster sits idle.

**Package manager — npm workspaces.** No new tools. Add `"workspaces": ["packages/*"]` to the root `package.json` in Step 1.1. The existing project uses `npm install` patterns; a one-package addition doesn't justify introducing pnpm.

**Zod version — `^3.23.0`.** Latest 3.x stable line. `zod-to-json-schema` ecosystem support is mature on 3.x; Zod 4 ecosystem lag isn't worth the risk for a foundational schema package.

**Events to wire in Step 1.2 — all three** per REFERENCE_PLAN §1.2:
- `MemoryBudget.startSession` → publishes `memory.session_started`.
- `MemoryBudget.endSession` → publishes `memory.session_ended`.
- `MemoryBudget.addEntry` → publishes `memory.fact_extracted`.

Dual-write — the existing `MEMORY.md` + session-store DB writes continue unchanged. The local event log accumulates ALONGSIDE these. This is shadow mode; validation runs for one full week of real activity (REFERENCE_PLAN §1 "Validation") before Block 2 may begin.

### Carry-forward from Block 0

- **Phase 2 scope must be revisited before Block 2 starts.** A prior repo analysis showed that `lib/mcp-knowledge/core.mjs` already implements sqlite-vec + embeddings via `@huggingface/transformers` (Xenova/all-MiniLM-L6-v2, 384-dim) and is the registered "knowledge" MCP server in `.mcp.json`. Step 2.1's first deliverable is a written re-scoping decision: extend mcp-knowledge to embed session JSONL turns, or add a parallel embedding stack in session-store. Block 2 cannot start without this decision recorded in `RESUME.md §0` for Block 2.
- **Zod is not yet a top-level dependency.** Block 1 adds it via the new `packages/event-schemas` workspace package, not as a root dependency.
- **NATS JetStream is already mesh-wired** ([lib/mesh-tasks.js](../lib/mesh-tasks.js), [lib/mesh-plans.js](../lib/mesh-plans.js), [lib/mesh-collab.js](../lib/mesh-collab.js)). Block 1 adds a NEW stream `local-events-${NODE_ID}` at R=1; existing buckets are untouched.
- **`docs/ARCHITECTURE.md`** has stale references to `frontend-activity` and `session-fingerprint.json`. Should be updated when convenient.
- **COMPANION variable name** in `daily-log-writer.mjs:34` is cosmetic. Not functionally broken.
- **Test fixture `confidence`** in `test/memory-budget.test.mjs` (lines 284, 315, 388, 389) — harmless extra property.
- **`pre-compact.sh`** is a no-op stub awaiting Block 4 rewiring.
- **`docs/STATE_FILES.md`** should be updated as Block 1 adds new state files.

---

## §1 — Per-step close paragraphs

### Step 0.1 — Wire MemoryBudget.reload() into daemon flush paths + NATS subscription + test

Closed at v0.1. `MemoryBudget.reload()` now fires after both daemon flush paths
(pre-compression at line 835, end-of-session at line 874) and via an optional NATS
subscription on `mesh.memory.compaction_completed` (line 1054). The NATS connection is
optional with graceful degradation — if NATS is unavailable, the daemon continues to work
locally. One new test added. 6 positive audit findings, zero Phase 4 corrections, zero
Phase 8 patches. Carry-forwards to Step 0.2: the daemon now has an async shutdown handler
and an optional `natsConn` in `main()` scope.

### Step 0.2 — Resolve .companion-state.md collision (rename to .daemon-state-${NODE_ID}.md + migrate readers)

Closed at v0.2. Daemon state file renamed from `.companion-state.md` to
`.daemon-state-${NODE_ID}.md` across all four readers: `memory-daemon.mjs` (line 526),
`session-start.sh` (line 33), `daily-log-writer.mjs` (line 34), and
`mission-control/src/app/api/tasks/route.ts` (line 23). Function `readCompanionState`
renamed to `readDaemonState`. Migration script `scripts/migrate-companion-state.mjs`
added — idempotent, detects daemon-written files via `## Session Status` / `last_flush`
markers. `NODE_ID` derived consistently as `process.env.OPENCLAW_NODE_ID || os.hostname()`
across all JS/TS files and `${OPENCLAW_NODE_ID:-$(hostname)}` in shell. 6 positive audit
findings, zero Phase 4 corrections, zero Phase 8 patches. Carry-forwards to Step 0.3:
`COMPANION` variable name retained in daily-log-writer (cosmetic, deferred); session-start.sh
sandbox restriction requires operator pre-apply for Step 0.6; test baseline unchanged at 467.

### Step 0.3 — Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup)

Closed at v0.3. Replaced the parenthetical merge format `(updated: ...)` in `mergeFacts`
with a supersedes-comment model: merged entries now write the NEW fact verbatim plus an
invisible `<!-- supersedes: <8-char-sha256> -->` HTML comment. Added
`cleanParentheticalChains(content)` to strip legacy chains (keeps only the innermost/most
recent segment). Added `stripSupersedes(text)` for clean similarity comparison. 5 new
regression tests cover 10-merge accumulation, nested chain cleanup, supersedes presence,
comment stripping, and no-chain passthrough. `crypto` import added (Node.js built-in, no
new dependency). 6 positive audit findings, zero Phase 4 corrections, zero Phase 8 patches.
Carry-forwards to Step 0.4: test baseline now 472 (399 pass, 73 fail pre-existing);
`extractFacts` still filters `role === 'user'` only; `confidence` field still unused;
`crypto` import shifts line numbers in `pre-compression-flush.mjs`.

### Step 0.4 — Include assistant-role messages in extraction + add speaker field + new patterns

Closed at v0.4. Opened `extractFacts` role filter to include assistant messages
alongside user messages (line 166). Added `stripSpeaker(text)` helper (line 203) to
remove `[user]`/`[assistant]` prefix before similarity comparison. Added two
assistant-voice pattern groups: `agent_action` (line 160) for intent declarations
(`I'll`, `I'm going to`, etc.) and `finding` (line 162) for observations (`I found`,
`I noticed`, etc.). Added `speaker: msg.role` field on all extracted fact objects
(line 180). Updated `mergeFacts` to format entries with `[speaker]` prefix and strip
speaker tags during similarity comparison and hash computation. 5 new tests cover
assistant inclusion, speaker field, pattern matching, tool exclusion, and speaker tag
formatting. 6 positive audit findings, zero Phase 4 corrections, zero Phase 8 patches.
Carry-forwards to Step 0.5: test baseline now 477 (404 pass, 73 fail pre-existing);
`confidence` field still unused (deferred to Step 0.6); `stripSpeaker` exported at
line 203; speaker tags formatted as `[user]`/`[assistant]` in MEMORY.md entries;
`agent_action` and `finding` categories are new (no downstream consumer filters by
category yet).

### Step 0.5 — Fix mid-word truncation via truncateAtWord helper

Closed at v0.5. Added `truncateAtWord(text, maxLen)` helper at
`lib/pre-compression-flush.mjs:212` to replace the hard `.slice(0, 120)` in
`extractFacts` (line 173). The helper truncates at the last space before `maxLen`,
with a 0.7 fallback threshold that avoids absurdly short results when a single word
is very long (falls back to hard slice if `lastSpace < maxLen * 0.7`). 4 new tests
cover short-text passthrough, word-boundary truncation, long-word fallback, and
exact-length passthrough. 6 positive audit findings, zero Phase 4 corrections, zero
Phase 8 patches. Carry-forwards to Step 0.6: test baseline now 481 (408 pass, 73
fail pre-existing); `confidence` field still unused (Step 0.6 deletes it);
`truncateAtWord` exported at line 212; `cleanParentheticalChains` shifted to line 222.

### Step 0.6 — Delete dead artifacts (.pre-compact-state.md write, .tmp/session-fingerprint.json, .tmp/frontend-activity, confidence field)

Closed at v0.6. Removed four dead artifacts that were written but never read by any
in-repo consumer. (1) `.claude/hooks/pre-compact.sh`: removed `STATE_FILE` variable and
the entire `.pre-compact-state.md` write block; hook retained as no-op stub for future
Block 4 rewiring. (2) `workspace-bin/session-recap`: deleted `FINGERPRINT_FILE` constant,
`extractFingerprint` function (~60 lines), `writeFingerprint` function (~12 lines), and
the fingerprint caller block in `main()`. (3) `workspace-bin/auto-checkpoint`: deleted
`ACTIVITY_FILE` variable and `touch "$ACTIVITY_FILE"`. (4) `lib/pre-compression-flush.mjs`:
removed `confidence` property from all 7 pattern objects, from the loop destructuring, from
the fact push, and from both JSDoc annotations. `extractFacts` return shape is now
`{ fact, category, speaker }`. 1 new regression test asserts `confidence` is absent from
returned fact objects. 6 positive audit findings, zero Phase 4 corrections, zero Phase 8
patches. Carry-forwards to Step 0.7: test baseline now 482 (409 pass, 73 fail pre-existing);
`docs/ARCHITECTURE.md` has stale references to `frontend-activity` and
`session-fingerprint.json` (out of Block 0 scope, defer or address if Step 0.7's
`docs/STATE_FILES.md` work opens the door); `pre-compact.sh` is a no-op stub; test
fixture data still passes `confidence` in some `mergeFacts` calls (harmless, cosmetic).

### Step 0.7 — Document state files (docs/STATE_FILES.md)

Closed at v0.7. Created `docs/STATE_FILES.md` — comprehensive reference inventory of
every runtime state file the memory infrastructure writes. Organized by location:
workspace runtime files (`~/.openclaw/workspace/`), daemon internal state (`.tmp/`),
SQLite databases (`~/.openclaw/`), and configuration files (`~/.openclaw/config/`).
Each entry documents owner process, format, lifetime, and consumers. Includes a
"Files removed in Block 0" section tracking the four artifacts deleted in Step 0.6.
Documentation-only step: zero functional code changes, zero new tests. 6 positive
audit findings, zero Phase 4 corrections, zero Phase 8 patches. **Block 0 complete
(7/7).**

### Step 1.1 — Create packages/event-schemas (zod envelope + memory event payloads + discriminated union)

Closed at v1.1. Created the `packages/event-schemas` workspace package — the foundational
schema layer for the event-sourced memory infrastructure. EventEnvelopeSchema defines the
13-field canonical event envelope (event_id, event_type, event_version, entity_id,
entity_type, timestamp, causation_id, correlation_id, actor, node_id, idempotency_key).
Eight memory event payload schemas extend the envelope with literal `event_type`
discriminators and typed `data` payloads: session-started, session-ended, turn-recorded,
fact-extracted, concept-mentioned, snapshot-taken, compaction-triggered, artifact-attached.
MemoryEventSchema provides a `z.discriminatedUnion` for runtime validation by event_type.
`toJsonSchema()` generates JSON Schema for cross-language consumers. npm workspaces enabled
at root (`"workspaces": ["packages/*"]`) with a `pretest` script that builds workspace
packages before tests. 15 new tests. 6 positive audit findings, 1 Phase 8 patch
(`.gitignore` for `packages/*/dist/`). Carry-forwards to Step 1.2: test baseline now 497;
`npm install` was blocked during this tick — event-schemas build script uses
mission-control's tsc (workaround), `toJsonSchema` has an `as any` cast for Zod 4/3
type mismatch — both resolve when workspace deps are properly installed; event-schemas
package exports are ready for import by `lib/local-event-log.mjs`.

### Step 1.2 — Create local event log substrate (lib/local-event-log.mjs + JetStream R=1 stream + dual-write wiring)

Closed at v1.2. Created `lib/local-event-log.mjs` — the per-node event log substrate backed
by NATS JetStream. `createLocalEventLog(nc, nodeId)` ensures a JetStream stream
`local-events-${NODE_ID}` exists (R=1, file storage, `local.>` subject filter) and returns
a `publishLocal(event)` method that validates against `MemoryEventSchema` and publishes with
`idempotency_key` as `msgID` for dedup. `buildMemoryEvent()` helper constructs
envelope-conformant events with auto-generated `event_id`, `timestamp`, and `idempotency_key`.
Dual-write wired into `MemoryBudget` at three sites: `startSession()` publishes
`memory.session_started`, `endSession()` publishes `memory.session_ended`, `addEntry()`
publishes `memory.fact_extracted`. All publishing is fire-and-forget via `#publishEvent()`
private helper — errors are caught silently to ensure the event log never disrupts the
primary MEMORY.md write path (shadow mode). The daemon initializes the event log after NATS
connection and passes it as `eventLog` option to `createBudget`. 9 new tests cover event
construction, schema validation, dual-write integration, and error isolation. 6 positive
audit findings, 0 Phase 8 patches. Phase-4-correction streak reset to 0 (test count
underestimated in AUDIT_PRE: planned 7, delivered 9). Carry-forwards to Step 1.3: test
baseline now 506; `createLocalEventLog` and `buildMemoryEvent` are available for use by
the artifact store; MemoryBudget accepts `eventLog` and `nodeId` options.

---

## §N+1 — Progress tracker

```
Steps closed:               9 / 45
Current block:              Block 1 in progress (Schema & event foundations)
Steps closed in block:      2 / 4
Consecutive zero-Phase-4-correction streak:  0 (Block 1; reset due to test count underestimate)
Consecutive zero-Phase-8-patch streak:       1 (Block 1)
Test baseline (npm test):   506 tests (433 pass, 73 fail pre-existing)
Last successful tick:       2026-05-21 (Step 1.2)
Last block file written:    memory-plan/audits/BLOCK_0_COMPLETE.md
```

---

## Next-tick checklist

The next scheduled tick should:

1. Run pre-flight (Framework §8).
2. Decode state: `VERSION` is `v1.2` (no suffix) → Start NEXT step at Phase 1.
3. Read `INVENTORY.md` → first `[ ]` row is Step 1.3.
4. Read `AUDIT_POST §6` from `memory-plan/audits/step09_local_event_log/AUDIT_POST.md` for carry-forwards.
5. Execute Phases 1 → 4 → 5 → 7 → 8 → 8.5 → 9 for Step 1.3.
6. **Important for Step 1.3:** Step 1.3 creates `lib/artifacts.mjs` — the content-addressed artifact store under `~/.openclaw/artifacts/`. `buildMemoryEvent` from `lib/local-event-log.mjs` is available if artifact events need publishing. MemoryBudget dual-write is established; the artifact store can follow the same pattern if events are needed. The event-schemas package build workaround (mission-control tsc path) should continue to work if `npm install` is still blocked.
7. Commit. Stop.
