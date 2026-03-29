# Circling Strategy Implementation — V3 Complete Reference

**Last updated:** 2026-03-29
**Version:** 3 (post-V2 analysis fixes)
**Test status:** 40 passing (27 collab-circling + 13 daemon-circling-handlers)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [File Map](#2-file-map)
3. [Session Schema](#3-session-schema)
4. [Workflow: End-to-End Lifecycle](#4-workflow-end-to-end-lifecycle)
5. [Layer 1: State Management — lib/mesh-collab.js](#5-layer-1-state-management)
6. [Layer 2: Orchestration — bin/mesh-task-daemon.js](#6-layer-2-orchestration)
7. [Layer 3: Execution — bin/mesh-agent.js](#7-layer-3-execution)
8. [Layer 4: Human Interface — bin/mesh-bridge.js](#8-layer-4-human-interface)
9. [Information Flow Matrix](#9-information-flow-matrix)
10. [State Machine](#10-state-machine)
11. [Error Handling and Recovery](#11-error-handling-and-recovery)
12. [Tier Gates and Human Intervention](#12-tier-gates-and-human-intervention)
13. [Test Infrastructure](#13-test-infrastructure)
14. [Known Gaps and Future Work](#14-known-gaps-and-future-work)
15. [Changelog: V1 → V2 → V3](#15-changelog)

---

## 1. Architecture Overview

The Circling Strategy is an asymmetric multi-agent collaboration protocol for complex tasks (e.g., Solidity contract development). Three AI agents — one **Worker** and two **Reviewers** — iterate through structured sub-rounds of directed work, review, and integration. Each agent sees only what the protocol decides it should see at each step, creating cognitive separation that prevents groupthink.

The implementation is split across four layers with zero coupling:

```
lib/circling-parser.js   (parsing)       Delimiter-based output parser, zero deps
     ^
     | imported by
     |
bin/mesh-agent.js        (execution)     Builds prompts, runs LLMs, wraps parser
     |
     | NATS request/reply
     v
bin/mesh-task-daemon.js  (orchestration) Reads state, makes decisions, publishes events
     |
     | JetStream KV read/write
     v
lib/mesh-collab.js       (state)         Pure state management, zero I/O
     |
     | NATS pub/sub events
     v
bin/mesh-bridge.js       (human UI)      Materializes state to kanban, handles gates
```

**Key design decisions:**

- **Single writer to session KV.** Only the daemon writes to JetStream KV. Agents submit artifacts as part of reflections (standard NATS request). The daemon stores them. No distributed write races.
- **Delimiter-based parsing.** LLM output uses `===CIRCLING_ARTIFACT===` / `===END_ARTIFACT===` delimiters instead of JSON embedding. LLMs produce clean delimiter-separated output reliably. JSON embedding of multi-line code artifacts would be a constant source of parse failures.
- **Per-step barriers.** Each step waits for all active nodes to submit before advancing. The `circling_step` tag on reflections distinguishes Step 1 vs Step 2 submissions within the same round.
- **Stored role identities.** `worker_node_id`, `reviewerA_node_id`, and `reviewerB_node_id` are assigned once at recruiting close and stored in the session. All lookups use these stable IDs — no recomputation from array position.
- **Dual-layer timeout.** In-memory timers per step (cleared on normal completion) + a periodic cron sweep every 60s that rehydrates timeouts from `step_started_at` after daemon restart.
- **Backward compatibility.** Non-circling sessions have `circling: null`. All existing code paths are untouched.

---

## 2. File Map

| File | Layer | Lines | What It Does |
|------|-------|-------|-------------|
| `lib/mesh-collab.js` | State | ~720 | Session schema, artifact store with blob size warning, state machine, directed input compilation, barrier checks, failure tracking |
| `lib/circling-parser.js` | Parsing | ~115 | Standalone delimiter parser. Imported by both agent and tests — single source of truth, zero external deps |
| `bin/mesh-task-daemon.js` | Orchestration | ~2060 | NATS handlers (reflect/join/gate), step lifecycle, timeout management (in-memory + cron sweep), recruiting guards |
| `bin/mesh-agent.js` | Execution | ~1050 | Prompt construction (`buildCirclingPrompt`), parser wrapper with legacy fallback, collab execution loop |
| `bin/mesh-bridge.js` | Human UI | ~330 | NATS event subscriber, kanban materialization, gate message formatting with blocked reviewer summaries |
| `test/collab-circling.test.js` | Tests | ~568 | 27 unit tests for mesh-collab.js circling features |
| `test/daemon-circling-handlers.test.js` | Tests | ~428 | 13 tests for daemon orchestration logic |

---

## 3. Session Schema

When `mode === 'circling_strategy'`, the session gains a `circling` block. For all other modes, `circling` is `null`.

```javascript
// lib/mesh-collab.js — createSession()
circling: {
  // Role identities — assigned ONCE at recruiting close, stable for session lifetime.
  // Eliminates race condition from array-index computation.
  worker_node_id: null,
  reviewerA_node_id: null,
  reviewerB_node_id: null,

  // Sub-round management
  max_subrounds: 3,            // Configurable. Each sub-round = 2 steps.
  current_subround: 0,         // 0 = init. Incremented after each step-2 completion.
  current_step: 0,             // 0 = init/finalization. 1 = review pass. 2 = integration.

  // Automation tier: controls when human gates fire
  // 1 = fully autonomous. 2 = gate on finalization. 3 = gate every sub-round.
  automation_tier: 2,

  // Artifact store — flat map, single source of truth for all produced work.
  // Key format: "sr{N}_step{S}_{role}_{type}"
  // Examples: "sr1_step1_worker_workArtifact", "sr0_step0_reviewerA_reviewStrategy"
  artifacts: {},

  // Protocol phase: init | circling | finalization | complete
  phase: 'init',

  // Parse failure tracking — keyed "nodeId_srN_stepS" → count.
  // Wired to daemon's reflect handler. Critical warning logged at 3 failures.
  artifact_failures: {},

  // Timeout rehydration — ISO timestamp set by daemon at each step start.
  // Survives in JetStream KV across daemon restarts. The cron sweep reads
  // this to re-fire timeouts for steps that outlived the daemon process.
  step_started_at: null,
}
```

**`min_nodes` defaults to 3 for circling** (2 for other modes):

```javascript
min_nodes: collabSpec.min_nodes || (collabSpec.mode === COLLAB_MODE.CIRCLING_STRATEGY ? 3 : 2),
```

The `checkRecruitingDeadlines` function provides a second-layer guard: even if `min_nodes` is met, circling won't start without exactly 1 worker + 2 reviewers.

**Why reviewer IDs are stored, not computed:**

Early versions computed reviewer identity from array position on every lookup. If the nodes array mutated between step start and step completion (disconnect/reconnect), the identity mapping could flip — artifacts would route to the wrong node. Storing IDs at recruiting close makes identity deterministic. A legacy fallback exists for backward compatibility with sessions created before the schema change.

---

## 4. Workflow: End-to-End Lifecycle

```
TASK SUBMITTED
     |
     v
[1] RECRUITING — 3 nodes join, role IDs assigned (worker, reviewerA, reviewerB)
     |
     v
[2] INIT STEP — all nodes receive task plan, produce initial artifacts
     |        Worker: workArtifact (initial implementation)
     |        Reviewer A: reviewStrategy (methodology declaration)
     |        Reviewer B: reviewStrategy (methodology declaration)
     v
[3] SUB-ROUND LOOP (SR1..SRN):
     |
     |  STEP 1 — Review Pass
     |    Worker receives: both reviewStrategies (+ reviewArtifacts in SR2+)
     |    Worker produces: workerReviewsAnalysis
     |    Reviewers receive: workArtifact + reconciliationDoc (optional SR1)
     |    Reviewers produce: reviewArtifact
     |    [barrier: wait for 3/3 submissions, 10-min timeout]
     |
     |  STEP 2 — Integration + Refinement
     |    Worker receives: both reviewArtifacts
     |    Worker produces: workArtifact (updated) + reconciliationDoc
     |    Reviewers receive: workerReviewsAnalysis + cross-review (other reviewer's artifact)
     |    Reviewers produce: reviewStrategy (refined)
     |    [barrier: wait for 3/3 submissions, 10-min timeout]
     |
     |  [tier gate check — tier 3 gates every SR, tier 2 gates on finalization]
     v
[4] FINALIZATION — all nodes receive final workArtifact + task plan
     |    Worker produces: workArtifact (final) + completionDiff + vote
     |    Reviewers produce: vote (converged | blocked)
     |    [barrier: 3/3]
     |
     |  if ANY vote === 'blocked':
     |    → GATE: human reviews concern (reason shown on kanban), approves or rejects
     |    → reject: add another sub-round (max_subrounds++)
     |  if ALL non-blocked:
     |    → SESSION COMPLETE, parent task marked completed
     v
DONE
```

---

## 5. Layer 1: State Management

**File:** `lib/mesh-collab.js`

Pure state management. Zero NATS, zero LLM, zero prompt knowledge. All I/O goes through the `CollabStore` class which wraps JetStream KV.

### 5.1 Artifact Store

Artifacts live in `session.circling.artifacts` — a flat key-value map. Keys follow `sr{N}_step{S}_{role}_{type}`.

**`storeArtifact(sessionId, key, content)`** — Reads session, writes to artifacts map, persists. After writing, checks session blob size against JetStream KV limits:

```javascript
const blobSize = Buffer.byteLength(JSON.stringify(session), 'utf8');
if (blobSize > 950_000) {
  console.error(`[collab] CRITICAL: session ${sessionId} blob is ${(blobSize / 1024).toFixed(0)}KB — approaching JetStream KV 1MB limit`);
} else if (blobSize > 800_000) {
  console.warn(`[collab] WARNING: session ${sessionId} blob is ${(blobSize / 1024).toFixed(0)}KB — consider external artifact store`);
}
```

Growth math: 3 SRs x 2 steps x 3 nodes = 18 step-artifacts + init + finalization ≈ 27 artifacts. At 5-15KB each: 135-405KB. Tier 3 gate rejects that add sub-rounds push higher. The 800KB warning gives operators lead time before hitting the 1MB wall.

**`getArtifactByKey(session, key)`** — Direct lookup. Returns content or `null`.

**`getLatestArtifact(session, nodeRole, artifactType)`** — Backward scan from current sub-round:

```
For SR=2, looking for worker/workArtifact:
  sr2_step2_worker_workArtifact  ← most recent (integration output)
  sr2_step1_worker_workArtifact
  sr1_step2_worker_workArtifact
  sr1_step1_worker_workArtifact
  sr0_step0_worker_workArtifact  ← init fallback
```

Checks step 2 before step 1 at each sub-round because integration (step 2) produces the latest version. No explicit version numbers needed — the key encodes production time.

### 5.2 `compileDirectedInput(session, nodeId, taskDescription)`

The core of the information flow protocol. Builds a markdown string with only the artifacts a specific node should see at the current step.

Uses stored reviewer IDs with legacy fallback:

```javascript
const reviewerLabel = (nId) => {
  if (session.circling.reviewerA_node_id && session.circling.reviewerB_node_id) {
    return nId === session.circling.reviewerA_node_id ? 'reviewerA' : 'reviewerB';
  }
  // Legacy fallback
  const reviewerNodes = session.nodes.filter(n => n.node_id !== session.circling.worker_node_id);
  return reviewerNodes.findIndex(n => n.node_id === nId) === 0 ? 'reviewerA' : 'reviewerB';
};
```

**Init phase:** All nodes receive the task plan.

**Circling Step 1 (Review Pass):**
- **Worker:** Reviewer A Strategy (required) + Reviewer B Strategy (required). In SR2+, also Reviewer A Review Findings (optional) + Reviewer B Review Findings (optional). The review artifacts let the Worker assess whether strategies are producing useful reviews — methodology alongside evidence.
- **Reviewers:** Work Artifact (required) + Reconciliation Document (required in SR2+, silently skipped in SR1 where it doesn't exist yet).

**Circling Step 2 (Integration + Refinement):**
- **Worker:** Reviewer A Review (required) + Reviewer B Review (required).
- **Reviewers:** Worker Reviews Analysis (required) + Cross-Review from the other reviewer (optional). Reviewer A sees Reviewer B's review artifact and vice versa. This cross-review enables inter-reviewer learning — each reviewer sees what the other caught and can incorporate that lens into their own methodology refinement.

**Finalization:** All nodes receive original task plan + final work artifact.

The `addArtifact` helper manages required vs optional:

```javascript
const addArtifact = (label, nodeRole, artifactType, required) => {
  const content = this.getLatestArtifact(session, nodeRole, artifactType);
  if (content !== null) {
    parts.push(`## ${label}\n\n${content}`);
  } else if (required) {
    parts.push(`## ${label}\n\n[UNAVAILABLE: ${nodeRole}'s ${artifactType} — proceed with available inputs only]`);
  }
  // If not required and null, skip silently
};
```

Required artifacts that are missing show `[UNAVAILABLE: ...]` — the node knows something is missing and adjusts. Optional artifacts that are null are silently omitted.

### 5.3 `isCirclingStepComplete(session)`

Barrier check. Counts reflections in the current round tagged with `circling_step === current_step`. Returns true when count >= active (non-dead) nodes.

The `circling_step` tag is critical. Within a single round, Step 1 and Step 2 reflections coexist. Without the tag, 3 Step 1 reflections would satisfy the Step 2 barrier. The tag makes the barrier per-step.

Dead node exclusion (`n.status !== 'dead'`) means the barrier unblocks when a node is marked dead by stall detection or step timeout. 2 of 3 submissions is enough when one node is dead.

### 5.4 `advanceCirclingStep(sessionId)`

State machine transitions. Returns `{ phase, subround, step, needsGate }`.

| Current State | Next State | Gate Condition |
|--------------|-----------|----------------|
| init/step0 | circling/SR1/step1 | never |
| circling/step1 | circling/step2 (same SR) | never |
| circling/step2 (SR < max) | circling/SR+1/step1 | tier 3 |
| circling/step2 (SR == max) | finalization/step0 | tier >= 2 |
| finalization | complete | never (blocked votes handled separately) |

### 5.5 `recordArtifactFailure(sessionId, nodeId)` / `getArtifactFailureCount(session, nodeId)`

Tracks parse failures per node per step. Key: `nodeId_srN_stepS`. Incremented by the daemon when a reflection has `parse_failed: true`. The daemon logs a CRITICAL warning at 3 failures for the same node+step.

Current behavior: failed reflections still count toward the barrier (the step advances with degraded input). Active retry is a documented future enhancement.

---

## 6. Layer 2: Orchestration

**File:** `bin/mesh-task-daemon.js`

The decision-maker. Reads state from CollabStore, decides what happens next, publishes NATS events. Only process that writes to JetStream KV.

### 6.1 Constants and Timer Infrastructure

```javascript
const CIRCLING_STEP_TIMEOUT_MS = parseInt(
  process.env.MESH_CIRCLING_STEP_TIMEOUT_MS || String(10 * 60 * 1000)
); // 10 min default, env-configurable

const circlingStepTimers = new Map(); // sessionId → setTimeout handle
```

Two timeout mechanisms work together:
1. **In-memory timers** — fast, precise, but lost on daemon crash.
2. **Cron sweep** (`sweepCirclingStepTimeouts`, every 60s) — reads `step_started_at` from JetStream KV, rehydrates timeouts after restart.

### 6.2 `handleCollabJoin` — Role Assignment at Recruiting Close

When the last node joins and `isRecruitingDone()` returns true:

```javascript
const workerNode = freshSession.nodes.find(n => n.role === 'worker') || freshSession.nodes[0];
freshSession.circling.worker_node_id = workerNode.node_id;
const reviewers = freshSession.nodes.filter(n => n.node_id !== workerNode.node_id);
freshSession.circling.reviewerA_node_id = reviewers[0]?.node_id || null;
freshSession.circling.reviewerB_node_id = reviewers[1]?.node_id || null;
```

All three role IDs assigned once, persisted, never recomputed. The same logic runs in both code paths (join handler and recruiting deadline handler).

### 6.3 `handleCollabReflect` — Circling Branch

When a node submits a reflection for a circling session:

**1. Artifact storage** — Determines `nodeRole` from stored reviewer IDs, builds artifact keys (`sr{N}_step{S}_{role}_{type}`), writes each artifact to the session store.

**2. Parse failure handling** — If `parse_failed === true`:
- Calls `recordArtifactFailure()` to increment the counter
- Appends `artifact_parse_failed` audit entry with node, step, subround, failure count
- Logs CRITICAL warning at 3 failures
- The reflection still counts toward the barrier (advances with degraded input)

**3. Barrier check** — Calls `isCirclingStepComplete()`. If met:
- Clears in-memory step timer
- Calls `advanceCirclingStep()` to transition the state machine
- Routes to: `completeCirclingSession()` (phase=complete), gate event (needsGate=true), or `startCirclingStep()` (auto-advance)

### 6.4 `startCirclingStep(sessionId)`

Starts a new circling step:

1. Records `step_started_at` timestamp (for cron sweep rehydration after restart)
2. Creates a new round in the session (for reflection storage)
3. Compiles per-node directed inputs via `compileDirectedInput()`
4. Publishes NATS notification to each node: `mesh.collab.{sessionId}.node.{nodeId}.round`
5. Sets in-memory step timeout:

```javascript
clearCirclingStepTimer(sessionId);
const stepSnapshot = { phase, subround: current_subround, step: current_step };
const timer = setTimeout(
  () => handleCirclingStepTimeout(sessionId, stepSnapshot),
  CIRCLING_STEP_TIMEOUT_MS
);
circlingStepTimers.set(sessionId, timer);
```

The `stepSnapshot` capture enables the staleness check — if the step advances normally before the timer fires, the handler detects the mismatch and does nothing.

### 6.5 `handleCirclingStepTimeout(sessionId, stepSnapshot)`

Fires when a step doesn't complete within the timeout window.

**1. Staleness check** — Compares current session state against `stepSnapshot`. If phase, subround, or step differ, the timer is stale (step already advanced). Returns immediately.

**2. Identify unresponsive nodes** — Builds set of submitted node IDs from reflections tagged with current step. Any active node NOT in the set is marked dead.

**3. Re-check barrier** — With dead nodes excluded, `isCirclingStepComplete()` may now pass (e.g., 2/3 submitted, 1 dead → 2/2 active).

**4. Advance or abort** — If barrier met, normal advance logic. If no active nodes remain, aborts session and releases parent task for human triage.

### 6.6 `sweepCirclingStepTimeouts()`

Periodic sweep (every 60s) that provides timeout resilience across daemon restarts.

```javascript
async function sweepCirclingStepTimeouts() {
  const active = await collabStore.list({ status: COLLAB_STATUS.ACTIVE });
  for (const session of active) {
    if (session.mode !== 'circling_strategy' || !session.circling) continue;
    if (session.circling.phase === 'complete') continue;
    if (!session.circling.step_started_at) continue;
    if (circlingStepTimers.has(session.session_id)) continue; // already tracked

    const elapsed = Date.now() - new Date(session.circling.step_started_at).getTime();
    if (elapsed > CIRCLING_STEP_TIMEOUT_MS) {
      await handleCirclingStepTimeout(session.session_id, stepSnapshot);
    }
  }
}
```

Skips sessions that already have an in-memory timer (normal path). Only fires for sessions where:
- No in-memory timer exists (daemon restarted, or timer was somehow lost)
- `step_started_at` shows the step has been running longer than the timeout

This handles: daemon restart recovery, timer drift, missed `clearTimeout` calls.

### 6.7 `completeCirclingSession(sessionId)`

Called after the finalization barrier is met. Clears step timer, then:

**Blocked votes → escalation gate:** Any `vote === 'blocked'` triggers a gate regardless of automation tier. The blocked node IDs and summaries are captured in the audit log. A `circling_gate` event is published. The human must approve or reject.

**All non-blocked → completion:** Retrieves final `workArtifact` and `completionDiff` via `getLatestArtifact()`. Marks session converged and completed. Marks parent task completed. Publishes events.

### 6.8 `checkRecruitingDeadlines` — Node Count Guard

When the recruiting window expires (timeout path), applies a role-distribution guard for circling:

```javascript
const hasWorker = session.nodes.some(n => n.role === 'worker');
const reviewerCount = session.nodes.filter(n => n.role === 'reviewer').length;
if (session.nodes.length < 3 || !hasWorker || reviewerCount < 2) {
  await collabStore.markAborted(session.session_id, ...);
  await store.markReleased(session.task_id, ...);
  continue;
}
```

Catches misconfigured sessions where `min_nodes` was manually set below 3. Aborts the session and releases the parent task.

### 6.9 Gate Handlers

**`handleCirclingGateApprove`** — Human approves via `mesh.collab.gate.approve`. If in finalization, force-completes the session. If mid-protocol (tier 3), resumes the next step.

**`handleCirclingGateReject`** — Human rejects. Increments `max_subrounds`, resets to circling phase, starts a new step. The protocol loops again without a new session. Existing artifacts and context are preserved.

---

## 7. Layer 3: Execution

**File:** `bin/mesh-agent.js` + `lib/circling-parser.js`

### 7.1 `lib/circling-parser.js` — Standalone Parser

Extracted from `mesh-agent.js` so both production code and tests import the same module. Zero external dependencies.

```javascript
function parseCirclingReflection(output, opts = {}) {
  const log = opts.log || (() => {});
  // ...
}
module.exports = { parseCirclingReflection };
```

**`opts.log`** — Optional logger. Agent passes its `log()` function. Tests pass nothing (no-op default).

**`opts.legacyParser`** — Optional fallback for output without circling delimiters. Agent passes its existing `parseReflection` function. Without it, missing delimiters produce `parse_failed: true`.

**Reflection parsing:** Extracts `===CIRCLING_REFLECTION=== ... ===END_REFLECTION===` block. Reads `type`, `summary`, `confidence`, `vote` from YAML-like header. Validates vote against `{ 'continue', 'converged', 'blocked' }`.

**Single-artifact mode:** No `===CIRCLING_ARTIFACT===` delimiters → everything before `===CIRCLING_REFLECTION===` is the artifact body. Type comes from the reflection block's `type` field.

**Multi-artifact mode:** For each `===CIRCLING_ARTIFACT=== ... ===END_ARTIFACT===` block:

```
[artifact 1 content]           ← slice(0, firstMarkerIndex)
===CIRCLING_ARTIFACT===
type: workArtifact
===END_ARTIFACT===
[artifact 2 content]           ← slice(firstEndIndex, secondMarkerIndex)
===CIRCLING_ARTIFACT===
type: reconciliationDoc
===END_ARTIFACT===
```

Content for artifact N = `output.slice(prevEndPosition, thisMarkerPosition)`. For artifact 0, `prevEndPosition = 0`. This extracts content BETWEEN delimiters — no leakage between artifacts.

### 7.2 `buildCirclingPrompt(task, circlingData)` — Prompt Construction

Builds phase-specific instructions + output format. The `circlingData` contains `directed_input`, `circling_phase`, `circling_step`, `my_role`, and `circling_subround`.

**Init phase:**
- Worker: "Produce your initial work artifact (v0)"
- Reviewer: "Produce your reviewStrategy — methodology, focus areas, evaluation criteria"

**Circling Step 1 (Review Pass):**
- Worker: "Analyze review STRATEGIES (not findings). What they focus on well, what they miss."
- Reviewer: "Review the work artifact using your strategy. Produce concrete, actionable findings with issue/location/impact/recommendation."

**Circling Step 2 (Integration + Refinement):**
- Worker: "Judge each review finding: ACCEPTED/REJECTED/MODIFIED. Produce updated workArtifact + reconciliationDoc." (multi-artifact format)
- Reviewer: "Evaluate Worker's feedback on your strategy. Refine your reviewStrategy."

**Finalization:**
- Worker: "Produce FINAL formatted work artifact + completionDiff checklist." (multi-artifact format)
- Reviewer: "Final sign-off — vote converged or blocked."

**Output format:** Multi-artifact (Worker Step 2 + Finalization) uses explicit `===CIRCLING_ARTIFACT===` delimiters with type headers. Single-artifact uses implicit content-before-reflection.

**Anti-preamble rule (all phases):**
> "Begin your output with the artifact content DIRECTLY. Do NOT include any preamble, explanation, or commentary before the artifact. Any text before the artifact delimiters is treated as part of the artifact."

This prevents LLM prose ("Here's my updated code:") from contaminating code artifacts.

**Finalization vote restriction:** Only `converged` and `blocked` are offered during finalization. Other phases offer `continue | converged | blocked`. This eliminates the ambiguity of a `continue` vote during finalization (which would silently be treated as non-blocked).

### 7.3 Agent Parser Wrapper

The agent imports the standalone parser and wraps it with agent-specific options:

```javascript
const { parseCirclingReflection: _parseCircling } = require('../lib/circling-parser');

function parseCirclingReflection(output) {
  return _parseCircling(output, {
    log: (msg) => log(msg),
    legacyParser: parseReflection,
  });
}
```

8 lines replacing 100+ lines of inline parser code. Tests import the same `lib/circling-parser.js` — no inline copy drift.

---

## 8. Layer 4: Human Interface

**File:** `bin/mesh-bridge.js`

The bridge subscribes to NATS collab events and materializes state changes into the kanban (`active-tasks.md`).

### 8.1 `circling_step_started` Handler

Updates kanban with current phase label (`Init`, `SR1/3 Step1`, `Finalization`) and node count. Auto-tracks CLI-submitted circling tasks on first event via file read (subsequent events use the in-memory `dispatched` set — no repeated file I/O).

### 8.2 `circling_gate` Handler

When a gate event fires, the bridge updates kanban to `status: 'waiting-user'`. The `next_action` includes blocked reviewer summaries:

```javascript
const blockedVotes = lastRound?.reflections?.filter(r => r.vote === 'blocked') || [];
if (blockedVotes.length > 0) {
  const reason = blockedVotes.map(r => r.summary).filter(Boolean).join('; ').slice(0, 150);
  gateMsg = `[GATE] SR${cg.current_subround} blocked — ${reason}`;
} else {
  gateMsg = `[GATE] SR${cg.current_subround} complete — review reconciliationDoc and approve/reject`;
}
```

**Blocked path:** `[GATE] SR2 blocked — reentrancy guard missing on withdraw function`
**Non-blocked path (tier gate):** `[GATE] SR2 complete — review reconciliationDoc and approve/reject`

The 150-char truncation prevents kanban field overflow while preserving the most important diagnostic information.

---

## 9. Information Flow Matrix

**What each node RECEIVES at each step:**

| Phase | Step | Worker Receives | Reviewer A Receives | Reviewer B Receives |
|-------|------|----------------|--------------------|--------------------|
| Init | 0 | Task plan | Task plan | Task plan |
| Circling SR1 | 1 | RevA strategy, RevB strategy | workArtifact | workArtifact |
| Circling SR2+ | 1 | RevA strategy, RevB strategy, RevA findings*, RevB findings* | workArtifact, reconciliationDoc | workArtifact, reconciliationDoc |
| Circling | 2 | RevA review, RevB review | workerReviewsAnalysis, RevB cross-review* | workerReviewsAnalysis, RevA cross-review* |
| Finalization | 0 | Task plan, final workArtifact | Task plan, final workArtifact | Task plan, final workArtifact |

Items marked `*` are optional — silently skipped if null (not yet produced or parse failure).

**What each node PRODUCES at each step:**

| Phase | Step | Worker Produces | Reviewer A Produces | Reviewer B Produces |
|-------|------|----------------|--------------------|--------------------|
| Init | 0 | workArtifact | reviewStrategy | reviewStrategy |
| Circling | 1 | workerReviewsAnalysis | reviewArtifact | reviewArtifact |
| Circling | 2 | workArtifact + reconciliationDoc | reviewStrategy | reviewStrategy |
| Finalization | 0 | workArtifact (final) + completionDiff + vote | vote (converged/blocked) | vote (converged/blocked) |

**Multi-artifact output** (uses explicit delimiters): Worker Step 2 (workArtifact + reconciliationDoc), Worker Finalization (workArtifact + completionDiff).

**Single-artifact output** (content before reflection block): all other cases.

---

## 10. State Machine

```
          ┌─────────────────────────────────────────────┐
          │                                             │
          v                                             │
  [init/step0] ──advance──> [circling/SR1/step1]        │
                                    │                   │
                                 advance                │
                                    │                   │
                                    v                   │
                            [circling/SR1/step2]        │
                                    │                   │
                           ┌────────┴────────┐          │
                           │                 │          │
                     SR < max            SR == max      │
                           │                 │          │
                        advance           advance       │
                           │                 │          │
                           v                 v          │
                   [circling/SR+1/step1]  [finalization] │
                           │                 │          │
                          ...             advance       │
                                             │          │
                                             v          │
                                         [complete]     │
                                                        │
          gate reject: max_subrounds++, reset ──────────┘
```

**Tier gate behavior:**
- **Tier 1:** No gates. Fully autonomous.
- **Tier 2:** Gates on finalization entry (after last sub-round's step 2).
- **Tier 3:** Gates after every sub-round's step 2 AND on finalization entry.
- **All tiers:** Blocked votes in finalization always trigger a gate.

---

## 11. Error Handling and Recovery

### 11.1 Parse Failures (`artifact_failures`)

When an agent's LLM output can't be parsed:

1. Daemon calls `recordArtifactFailure()` — counter incremented per node+step
2. Audit entry: `artifact_parse_failed` with node, step, subround, count
3. CRITICAL warning at 3 failures
4. Reflection still counts toward barrier — step advances with degraded input
5. Downstream nodes see `[UNAVAILABLE: ...]` placeholders

**Known limitation:** No active retry. The failed reflection advances immediately. The degradation is visible (audit log, CRITICAL warning, UNAVAILABLE markers) but the node doesn't get a second chance.

### 11.2 Step-Level Timeout (Dual-Layer)

**Layer 1 — In-memory timer:** Set in `startCirclingStep()`, cleared when barrier is met or session completes. Fast and precise. Lost on daemon crash.

**Layer 2 — Cron sweep:** `sweepCirclingStepTimeouts()` runs every 60s. Reads `step_started_at` from JetStream KV. Fires timeout handler for any step running longer than `CIRCLING_STEP_TIMEOUT_MS`. Skips sessions with active in-memory timers.

**Recovery flow (both layers):**
1. Staleness check (step may have already advanced)
2. Identify nodes that haven't submitted
3. Mark unresponsive nodes as dead
4. Re-check barrier (dead nodes excluded)
5. If barrier met → advance normally
6. If all nodes dead → abort session, release parent task

**Why two layers:** In-memory timers are fast but ephemeral. The cron sweep is slower (60s granularity) but survives daemon restarts. Together they cover: normal operation (fast timer), daemon crash (cron rehydration), timer bugs (cron safety net).

### 11.3 Recruiting Guard

`checkRecruitingDeadlines` validates role distribution before starting circling:
- Needs `nodes.length >= 3`
- Needs at least 1 node with `role === 'worker'`
- Needs at least 2 nodes with `role === 'reviewer'`

Failure: session aborted, parent task released for human triage. Catches `min_nodes` misconfiguration.

### 11.4 Session Blob Size Warning

`storeArtifact` checks blob size after every write:
- **>800KB** → `console.warn` (early warning, plan external store)
- **>950KB** → `console.error` (critical, approaching 1MB JetStream KV limit)

---

## 12. Tier Gates and Human Intervention

### 12.1 Gate Trigger Points

| Trigger | When | Tier |
|---------|------|------|
| Sub-round completion | After step 2, SR < max | 3 only |
| Finalization entry | After last SR step 2 | 2 and 3 |
| Blocked vote in finalization | Any node votes `blocked` | All tiers |

### 12.2 Blocked Vote Escalation

During finalization, `completeCirclingSession` checks for blocked votes. If any exist:
- Audit log: `circling_escalation` with blocked node IDs and summaries
- NATS: `circling_gate` event with full session
- Bridge: kanban shows `[GATE] SR2 blocked — reentrancy guard missing on withdraw function`

The human sees the reviewer's reason directly on the kanban without running `mesh collab status`.

### 12.3 Gate Approve

`mesh.collab.gate.approve` → If finalization: force-complete. If mid-protocol: resume next step.

### 12.4 Gate Reject

`mesh.collab.gate.reject` → `max_subrounds++`, reset to circling phase, start new step. Existing artifacts and context preserved. No special recovery logic.

---

## 13. Test Infrastructure

### 13.1 NATS Mocking

Both test files mock the `nats` module via `Module._resolveFilename` + `require.cache` injection. `MockKV` provides an in-memory JetStream KV replacement. Tests run without any external dependencies.

### 13.2 `test/collab-circling.test.js` — 27 Tests, 6 Suites

| Suite | Tests | What It Covers |
|-------|-------|---------------|
| Session Creation | 3 | Schema fields, reviewer ID slots, non-circling null |
| Artifact Store | 4 | Store/retrieve, backward scan, init fallback, null on not-found |
| compileDirectedInput | 7 | Init plan, Step 1 strategies/workArtifact, SR2+ reviewArtifacts, cross-review in Step 2, reconciliationDoc optional/required, UNAVAILABLE markers |
| advanceCirclingStep | 6 | All 5 state transitions + tier-3 gate check |
| isCirclingStepComplete | 3 | Partial submissions, full submissions, wrong-step tag rejection |
| parseCirclingReflection | 4 | Single artifact, multi-artifact, missing delimiters, blocked vote |

The parser tests import from `lib/circling-parser.js` — same module the agent uses. No inline copy.

### 13.3 `test/daemon-circling-handlers.test.js` — 13 Tests, 5 Suites

| Suite | Tests | What It Covers |
|-------|-------|---------------|
| reflect → store → barrier → advance | 2 | Full 3-node cycle advances to step 2; partial (2/3) does not advance |
| parse_failed tracking | 2 | Failure counter increments; failed reflections count toward barrier |
| completeCirclingSession | 2 | Blocked vote triggers gate; all-converged retrieves final artifact |
| recruiting guard | 5 | min_nodes defaults (3 for circling, 2 for parallel), explicit override, reviewer ID schema, role distribution check |
| gate bridge message | 2 | Blocked summary extraction; generic fallback |

Tests use `simulateReflectHandler()` — a function that replicates the daemon's circling branch logic. This is necessary because `mesh-task-daemon.js` isn't importable as a module (it's a standalone script with closures over `nc`, `store`, etc.).

---

## 14. Known Gaps and Future Work

### 14.1 Adaptive Convergence (Early Exit)

`advanceCirclingStep` uses `current_subround >= max_subrounds` as the sole finalization trigger. A protocol that converges in SR1 still runs all sub-rounds.

**Fix:** After step 2, check if all nodes voted `converged`. If so, skip to finalization. Captures 80% of token savings with minimal implementation.

### 14.2 Active Retry for Parse Failures

Current behavior: degrade immediately, track for observability. The spec calls for retry 3x before degrading.

**Fix:** In the reflect handler, if `failCount < 3`, re-publish directed input to the failing node and return without counting the reflection toward the barrier.

**Assessment:** Acceptable for first production run. Failure is visible (CRITICAL log, UNAVAILABLE markers), not silent. Build retry when production data shows actual parse failure rates.

### 14.3 Reviewer Step 2 Dual Output

The information flow spec suggests Reviewers could produce both `reviewStrategy` (refined methodology) AND `reviewArtifact` (fresh findings using that methodology) in Step 2. Currently, only `reviewStrategy` is produced.

**Impact:** Without a fresh Step 2 reviewArtifact, the Worker in the next SR's Step 1 sees the Step 1 reviewArtifact (before strategy refinement). Adding dual output would give the Worker the post-refinement review, which better reflects the updated methodology.

**Assessment:** Protocol enhancement for v2. Current single-output flow works — the Worker sees strategies + Step 1 artifacts and can assess quality. Dual output adds ~20% per-sub-round token cost.

---

## 15. Changelog: V1 → V2 → V3

### V1 → V2 (March 28)

**Protocol fixes:**
- Worker Step 1 now receives reviewArtifacts in SR2+ (optional)
- Reviewer Step 2 now receives cross-review from other reviewer (optional)

**Robustness:**
- `artifact_failures` wired in daemon reflect handler (tracking + audit + critical warning)
- `min_nodes` defaults to 3 for circling (was 2)
- Recruiting guard validates 1 worker + 2 reviewers before starting
- Step-level timeout (10 min default, env-configurable)

**Race condition fix:**
- Reviewer IDs stored at recruiting close (`reviewerA_node_id`, `reviewerB_node_id`)

**UX:**
- Gate message includes blocked reviewer summary on kanban

**Testing:**
- `daemon-circling-handlers.test.js` — 12 tests (later 13)

### V2 → V3 (March 29)

**Parser extraction:**
- `parseCirclingReflection` moved to `lib/circling-parser.js` — standalone, zero deps
- Agent imports and wraps with legacy fallback
- Tests import production module directly — no inline copy drift

**Prompt hardening:**
- Anti-preamble rule: "Begin output with artifact content DIRECTLY"
- Finalization vote restricted to `converged | blocked` (no ambiguous `continue`)

**Timeout resilience:**
- `step_started_at` ISO timestamp in circling schema
- `sweepCirclingStepTimeouts()` cron (60s) rehydrates timeouts after daemon restart
- Dual-layer: in-memory timer (fast) + cron sweep (durable)

**Observability:**
- Session blob size warning at 800KB / critical at 950KB in `storeArtifact`

**Doc accuracy:**
- Produces table corrected: Worker finalization = workArtifact + completionDiff + vote
- Produces table corrected: Reviewer Step 2 = reviewStrategy only (matches code)
