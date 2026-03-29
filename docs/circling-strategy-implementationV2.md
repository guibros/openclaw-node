# Circling Strategy — Complete Implementation Reference

**Last updated:** 2026-03-29
**Test status:** 40 passing (27 collab-circling + 13 daemon-circling-handlers)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [File Map](#2-file-map)
3. [Session Schema](#3-session-schema)
4. [Workflow: End-to-End Lifecycle](#4-workflow-end-to-end-lifecycle)
5. [Layer 1: State Management — `lib/mesh-collab.js`](#5-layer-1-state-management)
6. [Layer 2: Orchestration — `bin/mesh-task-daemon.js`](#6-layer-2-orchestration)
7. [Layer 3: Execution — `bin/mesh-agent.js`](#7-layer-3-execution)
8. [Layer 4: Human Interface — `bin/mesh-bridge.js`](#8-layer-4-human-interface)
9. [Information Flow Matrix](#9-information-flow-matrix)
10. [State Machine](#10-state-machine)
11. [Error Handling and Recovery](#11-error-handling-and-recovery)
12. [Tier Gates and Human Intervention](#12-tier-gates-and-human-intervention)
13. [Test Infrastructure](#13-test-infrastructure)
14. [Known Gaps and Future Work](#14-known-gaps-and-future-work)

---

## 1. Architecture Overview

The Circling Strategy is an asymmetric multi-agent collaboration protocol for complex tasks (e.g., Solidity contract development). Three AI agents — one **Worker** and two **Reviewers** — iterate through structured sub-rounds of directed work, review, and integration. Each agent sees only what the protocol decides it should see at each step, creating cognitive separation that prevents groupthink.

The implementation is split across four layers, each with zero coupling to the others:

```
mesh-agent.js        (execution)     Builds prompts, runs LLMs, parses output
     |
     | NATS request/reply
     v
mesh-task-daemon.js  (orchestration) Reads state, makes decisions, publishes events
     |
     | JetStream KV read/write
     v
mesh-collab.js       (state)         Pure state management, zero I/O
     |
     | NATS pub/sub events
     v
mesh-bridge.js       (human UI)      Materializes state to kanban, handles gates
```

**Key design decisions:**

- **Single writer to session KV.** Only the daemon writes to JetStream KV. Agents submit artifacts as part of reflections (standard NATS request). The daemon stores them. No distributed write races.
- **Delimiter-based parsing.** LLM output uses `===CIRCLING_ARTIFACT===` / `===END_ARTIFACT===` delimiters instead of JSON embedding. LLMs produce clean delimiter-separated output reliably. JSON embedding of multi-line code artifacts would be a constant source of parse failures.
- **Per-step barriers.** Each step waits for all 3 nodes to submit before advancing. The `circling_step` tag on reflections distinguishes Step 1 vs Step 2 submissions within the same round.
- **Backward compatibility.** Non-circling sessions have `circling: null`. All existing code paths are untouched. Zero existing tests break.

---

## 2. File Map

| File | Layer | What It Does |
|------|-------|-------------|
| `lib/mesh-collab.js` | State | Session schema, artifact store, state machine, directed input compilation, barrier checks, failure tracking |
| `bin/mesh-task-daemon.js` | Orchestration | NATS handlers for reflect/join/gate, step lifecycle, timeout management, recruiting guards |
| `bin/mesh-agent.js` | Execution | Prompt construction (`buildCirclingPrompt`), delimiter parser (`parseCirclingReflection`), collab execution loop |
| `bin/mesh-bridge.js` | Human UI | NATS event subscriber, kanban materialization, gate message formatting |
| `test/collab-circling.test.js` | Tests | 27 unit tests for mesh-collab.js circling features |
| `test/daemon-circling-handlers.test.js` | Tests | 13 tests for daemon orchestration logic |

---

## 3. Session Schema

When `mode === 'circling_strategy'`, the session object gains a `circling` block. For all other modes, `circling` is `null`.

```javascript
// lib/mesh-collab.js — createSession()
circling: {
  worker_node_id: null,        // Assigned at recruiting close. The node that produces workArtifact.
  reviewerA_node_id: null,     // Assigned at recruiting close. First non-worker node.
  reviewerB_node_id: null,     // Assigned at recruiting close. Second non-worker node.
  max_subrounds: 3,            // Configurable. Each sub-round = 2 steps (review + integration).
  current_subround: 0,         // 0 = init. Incremented after each step-2 completion.
  current_step: 0,             // 0 = init/finalization. 1 = review pass. 2 = integration.
  automation_tier: 2,          // 1 = full auto. 2 = gate on finalization. 3 = gate every SR.
  artifacts: {},               // Flat map: "sr{N}_step{S}_{role}_{type}" → content string.
  phase: 'init',               // init | circling | finalization | complete
  artifact_failures: {},       // "nodeId_srN_stepS" → failure count. Tracks parse failures per step.
}
```

**Why `min_nodes` defaults to 3 for circling:**

```javascript
min_nodes: collabSpec.min_nodes || (collabSpec.mode === COLLAB_MODE.CIRCLING_STRATEGY ? 3 : 2),
```

Circling requires exactly 1 worker + 2 reviewers. If someone creates a circling session without setting `min_nodes`, the default of 2 (for other modes) would allow the recruiting deadline to start circling with insufficient nodes. The guard in `checkRecruitingDeadlines` provides a second layer of defense (see section 6).

**Why reviewer IDs are stored, not computed:**

Early versions computed reviewer identity from array position (`session.nodes.filter(n => n.node_id !== worker)[0]` = reviewerA). This is fragile — if the nodes array is mutated between step start and step completion (e.g., a node disconnect/reconnect), the identity mapping could flip. Storing `reviewerA_node_id` and `reviewerB_node_id` at recruiting close makes identity stable for the session lifetime.

All lookups use the stored IDs with a legacy fallback:

```javascript
const reviewerLabel = (nId) => {
  if (session.circling.reviewerA_node_id && session.circling.reviewerB_node_id) {
    return nId === session.circling.reviewerA_node_id ? 'reviewerA' : 'reviewerB';
  }
  // Legacy fallback: compute from array position
  const reviewerNodes = session.nodes.filter(n => n.node_id !== session.circling.worker_node_id);
  return reviewerNodes.findIndex(n => n.node_id === nId) === 0 ? 'reviewerA' : 'reviewerB';
};
```

---

## 4. Workflow: End-to-End Lifecycle

```
TASK SUBMITTED
     |
     v
[1] RECRUITING — 3 nodes join, roles assigned
     |
     v
[2] INIT STEP — all nodes receive task plan, produce initial artifacts
     |        Worker: workArtifact (initial implementation)
     |        ReviewerA: reviewStrategy (methodology declaration)
     |        ReviewerB: reviewStrategy (methodology declaration)
     v
[3] SUB-ROUND LOOP (SR1..SRN):
     |
     |  STEP 1 — Review Pass
     |    Worker receives: both reviewStrategies (+ reviewArtifacts in SR2+)
     |    Worker produces: workerReviewsAnalysis (feedback on review methodology)
     |    Reviewers receive: workArtifact + reconciliationDoc (optional SR1)
     |    Reviewers produce: reviewArtifact (findings + severity)
     |    [barrier: wait for 3/3 submissions]
     |
     |  STEP 2 — Integration + Refinement
     |    Worker receives: both reviewArtifacts
     |    Worker produces: workArtifact (updated) + reconciliationDoc
     |    Reviewers receive: workerReviewsAnalysis + cross-review (other reviewer's artifact)
     |    Reviewers produce: refined reviewStrategy + updated reviewArtifact
     |    [barrier: wait for 3/3 submissions]
     |
     |  [tier gate check — tier 3 gates every SR, tier 2 gates on finalization]
     v
[4] FINALIZATION — all nodes receive final workArtifact + task plan
     |    All nodes produce: final reflection with vote (converged | blocked)
     |    [barrier: 3/3]
     |
     |  if ANY vote === 'blocked':
     |    → GATE: human reviews concern, approves or rejects
     |    → reject: add another sub-round (max_subrounds++)
     |  if ALL votes === 'converged':
     |    → SESSION COMPLETE, parent task marked completed
     v
DONE
```

---

## 5. Layer 1: State Management

**File:** `lib/mesh-collab.js`

This file contains zero NATS code, zero LLM code, zero prompt knowledge. It's pure state management backed by JetStream KV via the `CollabStore` class.

### 5.1 Artifact Store

Artifacts are stored in `session.circling.artifacts` as a flat key-value map. Keys follow the pattern `sr{N}_step{S}_{role}_{type}`.

**`storeArtifact(sessionId, key, content)`** — Reads session, writes content to the artifacts map, persists. Single-writer guarantee (only daemon calls this).

**`getArtifactByKey(session, key)`** — Direct lookup. Returns the artifact content or `undefined`.

**`getLatestArtifact(session, nodeRole, artifactType)`** — Backward scan from the current sub-round. For each SR from current back to 0, checks step 2 first (integration produces the latest version), then step 1, then init. Returns the most recent version of the artifact.

```
Scan order for SR=2, looking for worker/workArtifact:
  sr2_step2_worker_workArtifact  ← check first (most recent)
  sr2_step1_worker_workArtifact
  sr1_step2_worker_workArtifact
  sr1_step1_worker_workArtifact
  sr0_step0_worker_workArtifact  ← init fallback
```

This eliminates the need for explicit version numbers. The artifact key encodes when it was produced, and the backward scan finds the freshest version.

### 5.2 `compileDirectedInput(session, nodeId, taskDescription)`

Builds the markdown string that a specific node receives at the start of a step. This is the core of the information flow protocol — each node sees only what it should see.

**Init phase:** All nodes receive the task plan.

**Circling Step 1 (Review Pass):**
- **Worker:** Reviewer A Strategy (required) + Reviewer B Strategy (required). In SR2+, also Reviewer A Review Findings (optional) + Reviewer B Review Findings (optional). The optional review artifacts let the Worker assess whether the strategies are *producing useful reviews*.
- **Reviewers:** Work Artifact (required) + Reconciliation Document (optional in SR1, required in SR2+). The reconciliationDoc doesn't exist in SR1 (no prior integration), so it's silently skipped. In SR2+, a missing reconciliationDoc shows `[UNAVAILABLE: ...]`.

**Circling Step 2 (Integration + Refinement):**
- **Worker:** Reviewer A Review (required) + Reviewer B Review (required).
- **Reviewers:** Worker Reviews Analysis (required) + Cross-Review from the other reviewer (optional). Reviewer A sees Reviewer B's review artifact and vice versa. This cross-review enables inter-reviewer learning — Reviewer A sees what Reviewer B caught and can incorporate that lens into their own methodology.

**Finalization:** All nodes receive the original task plan + final work artifact.

The `addArtifact` helper handles the required vs optional distinction:

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

### 5.3 `isCirclingStepComplete(session)`

Barrier check. Counts reflections in the current round that are tagged with the current `circling_step`. Returns true when the count >= active (non-dead) nodes.

```javascript
isCirclingStepComplete(session) {
  const activeNodes = session.nodes.filter(n => n.status !== 'dead');
  const stepReflections = currentRound.reflections.filter(
    r => r.circling_step === session.circling.current_step
  );
  return stepReflections.length >= activeNodes.length;
}
```

The `circling_step` tag is critical. Without it, the barrier can't distinguish 3 Step 1 reflections from a mix of Step 1 and Step 2 reflections within the same round.

Dead node exclusion means the barrier unblocks when a node is marked dead by stall detection or step timeout.

### 5.4 `advanceCirclingStep(sessionId)`

State machine transitions. Returns `{ phase, subround, step, needsGate }`.

```
Transition table:
  init/step0                       → circling/SR1/step1
  circling/step1                   → circling/step2 (same SR)
  circling/step2 (SR < max)        → circling/SR+1/step1  [tier 3: needsGate]
  circling/step2 (SR == max)       → finalization/step0    [tier >= 2: needsGate]
  finalization                     → complete
```

### 5.5 `recordArtifactFailure(sessionId, nodeId)` / `getArtifactFailureCount(session, nodeId)`

Tracks parse failures per node per step. Key format: `nodeId_srN_stepS`. Increments on each failure. Used by the daemon to log critical warnings after 3 failures.

---

## 6. Layer 2: Orchestration

**File:** `bin/mesh-task-daemon.js`

The daemon is the decision-maker. It reads state from CollabStore, decides what happens next, and publishes NATS events. It's the only process that writes to JetStream KV.

### 6.1 Constants and Timer Infrastructure

```javascript
const CIRCLING_STEP_TIMEOUT_MS = parseInt(
  process.env.MESH_CIRCLING_STEP_TIMEOUT_MS || String(10 * 60 * 1000)
); // 10 min default

const circlingStepTimers = new Map(); // sessionId → setTimeout handle
```

The step timer Map tracks active timeouts for each circling session. Only one timer per session is active at a time (cleared and re-set on each step start).

### 6.2 `handleCollabJoin` — Role Assignment at Recruiting Close

When the last node joins and `isRecruitingDone()` returns true, the daemon assigns all three role IDs before starting the first step:

```javascript
const workerNode = freshSession.nodes.find(n => n.role === 'worker') || freshSession.nodes[0];
freshSession.circling.worker_node_id = workerNode.node_id;
const reviewers = freshSession.nodes.filter(n => n.node_id !== workerNode.node_id);
freshSession.circling.reviewerA_node_id = reviewers[0]?.node_id || null;
freshSession.circling.reviewerB_node_id = reviewers[1]?.node_id || null;
```

This happens exactly once, at the natural synchronization point. The worker is the first node with `role === 'worker'`. Deterministic, no race condition.

### 6.3 `handleCollabReflect` — Circling Branch

When a node submits a reflection for a circling session, the daemon:

**1. Stores artifacts** — computes `nodeRole` from stored reviewer IDs, builds artifact keys, writes to session store.

**2. Handles parse failures** — if `reflection.parse_failed === true`, calls `recordArtifactFailure()` to increment the failure counter. Logs a critical warning after 3 failures. The failed reflection still counts toward the barrier (the step advances with degraded input — downstream nodes get `[UNAVAILABLE]` placeholders).

```javascript
} else if (reflection.parse_failed) {
  const failCount = await collabStore.recordArtifactFailure(session_id, reflection.node_id);
  log(`CIRCLING PARSE FAILURE: ${reflection.node_id} in ${session_id} (attempt ${failCount})`);
  await collabStore.appendAudit(session_id, 'artifact_parse_failed', {
    node_id: reflection.node_id,
    step: session.circling.current_step,
    subround: session.circling.current_subround,
    failure_count: failCount,
  });
  if (failCount >= 3) {
    log(`CIRCLING CRITICAL: ${reflection.node_id} failed ${failCount}x ...`);
  }
}
```

**3. Checks barrier** — calls `isCirclingStepComplete()`. If met, clears the step timer and advances:
- `phase === 'complete'` → calls `completeCirclingSession()`
- `needsGate === true` → publishes `circling_gate` event, waits for human
- Otherwise → calls `startCirclingStep()` for the next step

### 6.4 `startCirclingStep(sessionId)`

Starts a new round in the session (for reflection storage), compiles directed inputs for each node, and publishes per-node NATS notifications.

Each node receives a message on `mesh.collab.{sessionId}.node.{nodeId}.round` containing:
- `directed_input` — the node-specific compilation from `compileDirectedInput()`
- `circling_phase`, `circling_step`, `circling_subround` — so the agent knows what to do
- `my_role` — worker or reviewer

After notifying all nodes, sets a step-level timeout:

```javascript
clearCirclingStepTimer(sessionId);
const stepSnapshot = { phase, subround: current_subround, step: current_step };
const timer = setTimeout(
  () => handleCirclingStepTimeout(sessionId, stepSnapshot),
  CIRCLING_STEP_TIMEOUT_MS
);
circlingStepTimers.set(sessionId, timer);
```

### 6.5 `handleCirclingStepTimeout(sessionId, stepSnapshot)`

Fires when a step doesn't complete within `CIRCLING_STEP_TIMEOUT_MS` (default 10 min).

**1. Staleness check** — compares the current session state against the `stepSnapshot` captured when the timer was set. If the step already advanced (barrier was met normally), the timer is stale and does nothing.

**2. Identifies unresponsive nodes** — builds a set of `submittedNodeIds` from reflections tagged with the current step. Any active node NOT in this set is marked dead via `setNodeStatus()`.

**3. Re-checks barrier** — with dead nodes excluded, `isCirclingStepComplete()` may now return true (e.g., 2/3 submitted, 1 marked dead → 2/2 active nodes submitted).

**4. Force-advances or aborts** — if barrier met, advances normally. If no active nodes remain, aborts the session and releases the parent task.

```javascript
if (collabStore.isCirclingStepComplete(freshSession)) {
  const nextState = await collabStore.advanceCirclingStep(sessionId);
  // ... normal advance/gate/complete logic
} else {
  // All active nodes are dead — abort
  await collabStore.markAborted(sessionId, `All nodes timed out at ${phase}/...`);
  await store.markReleased(session.task_id, `Circling session aborted: all nodes timed out`);
}
```

### 6.6 `completeCirclingSession(sessionId)`

Called after the finalization step barrier is met. Clears the step timer, then inspects finalization votes:

**Blocked votes → escalation gate:** Any `vote === 'blocked'` triggers a gate event. The blocked nodes and their summaries are captured in the audit log. A `circling_gate` NATS event is published. The human must approve or reject.

**All converged → completion:** Retrieves the final `workArtifact` and `completionDiff` via `getLatestArtifact()`. Marks the session converged and completed. Marks the parent task completed. Publishes completion events.

### 6.7 `checkRecruitingDeadlines` — Circling Node Count Guard

When the recruiting window expires (timeout, not all-joined), this function fires. For circling sessions, it applies a role-distribution guard beyond `min_nodes`:

```javascript
const hasWorker = session.nodes.some(n => n.role === 'worker');
const reviewerCount = session.nodes.filter(n => n.role === 'reviewer').length;
if (session.nodes.length < 3 || !hasWorker || reviewerCount < 2) {
  // Abort and release — can't run circling without proper roles
  await collabStore.markAborted(session.session_id, ...);
  await store.markReleased(session.task_id, ...);
  continue;
}
```

This catches misconfigured sessions where `min_nodes` was set to 2 but the protocol needs 3 with specific roles.

### 6.8 Gate Handlers

**`handleCirclingGateApprove`** — Human approves via `mesh.collab.gate.approve`. If the session is in finalization, completes the session (force-complete). If mid-protocol (tier 3 gate), resumes the next step.

**`handleCirclingGateReject`** — Human rejects. Increments `max_subrounds`, resets to circling phase, starts a new step. The protocol loops again without requiring a new session. Existing artifacts and context are preserved.

---

## 7. Layer 3: Execution

**File:** `bin/mesh-agent.js`

The agent builds prompts, runs LLMs, and parses output. It has no knowledge of NATS orchestration or session state beyond what it receives in the per-step notification.

### 7.1 `buildCirclingPrompt(roundInfo, task)`

Constructs the system + user prompt for a circling step. The `roundInfo` contains `directed_input`, `circling_phase`, `circling_step`, `my_role`, and `circling_subround`. The prompt instructs the agent to produce output in the delimiter format.

### 7.2 `parseCirclingReflection(output)`

Parses LLM output into structured data. Returns:

```javascript
{
  circling_artifacts: [{ type: string, content: string }],
  summary: string,
  confidence: number,
  vote: 'continue' | 'converged' | 'blocked',
  parse_failed: boolean,
}
```

**Reflection block parsing:** Extracts the `===CIRCLING_REFLECTION=== ... ===END_REFLECTION===` block. Reads `type`, `summary`, `confidence`, `vote` fields from the YAML-like header.

**Single-artifact mode:** If no `===CIRCLING_ARTIFACT===` delimiters exist, everything before `===CIRCLING_REFLECTION===` is the artifact body. The `type` from the reflection block is used as the artifact type.

**Multi-artifact mode:** When multiple `===CIRCLING_ARTIFACT=== ... ===END_ARTIFACT===` blocks exist (e.g., Worker Step 2 produces workArtifact + reconciliationDoc):

```
[workArtifact content]           ← slice(0, firstMarkerIndex)
===CIRCLING_ARTIFACT===
type: workArtifact
===END_ARTIFACT===
[reconciliationDoc content]      ← slice(firstEndIndex, secondMarkerIndex)
===CIRCLING_ARTIFACT===
type: reconciliationDoc
===END_ARTIFACT===
===CIRCLING_REFLECTION===
...
```

The parser:
1. Strips everything after `===CIRCLING_REFLECTION===` (artifact content only).
2. Finds all `===CIRCLING_ARTIFACT=== ... ===END_ARTIFACT===` blocks with positions.
3. For artifact N: content = `output.slice(prevEndPosition, thisMarkerPosition)`.
4. For artifact 0: `prevEndPosition = 0` (start of output).

This correctly extracts content BETWEEN delimiters, not "before each marker."

**Fallback:** If no reflection delimiters found, returns `{ parse_failed: true, vote: 'parse_error' }`.

---

## 8. Layer 4: Human Interface

**File:** `bin/mesh-bridge.js`

The bridge subscribes to NATS collab events and materializes state changes into the kanban (`active-tasks.md`).

### 8.1 `circling_step_started` Handler

Updates kanban with the current phase label (`Init`, `SR1/3 Step1`, `Finalization`) and node count. Auto-tracks CLI-submitted circling tasks on first event.

### 8.2 `circling_gate` Handler

When a gate event fires, the bridge updates the kanban to `status: 'waiting-user'`. The `next_action` message includes the reviewer's reason for blocking:

```javascript
const blockedVotes = lastRound?.reflections?.filter(r => r.vote === 'blocked') || [];
if (blockedVotes.length > 0) {
  const reason = blockedVotes.map(r => r.summary).filter(Boolean).join('; ').slice(0, 150);
  gateMsg = `[GATE] SR${cg.current_subround} blocked — ${reason}`;
} else {
  gateMsg = `[GATE] SR${cg.current_subround} complete — review reconciliationDoc and approve/reject`;
}
```

The blocked path shows e.g. `[GATE] SR2 blocked — reentrancy guard missing on withdraw function`. The non-blocked path (tier gates without blocked votes) shows the generic approve/reject message. The 150-char truncation prevents kanban field overflow.

---

## 9. Information Flow Matrix

What each node receives at each step:

| Phase | Step | Worker Receives | Reviewer A Receives | Reviewer B Receives |
|-------|------|----------------|--------------------|--------------------|
| Init | 0 | Task plan | Task plan | Task plan |
| Circling SR1 | 1 | RevA strategy, RevB strategy | workArtifact | workArtifact |
| Circling SR2+ | 1 | RevA strategy, RevB strategy, RevA findings*, RevB findings* | workArtifact, reconciliationDoc | workArtifact, reconciliationDoc |
| Circling | 2 | RevA review, RevB review | workerReviewsAnalysis, RevB cross-review* | workerReviewsAnalysis, RevA cross-review* |
| Finalization | 0 | Task plan, final workArtifact | Task plan, final workArtifact | Task plan, final workArtifact |

*Items marked with `*` are optional — silently skipped if null (not produced yet or parse failure).

What each node produces at each step:

| Phase | Step | Worker Produces | Reviewer A Produces | Reviewer B Produces |
|-------|------|----------------|--------------------|--------------------|
| Init | 0 | workArtifact | reviewStrategy | reviewStrategy |
| Circling | 1 | workerReviewsAnalysis | reviewArtifact | reviewArtifact |
| Circling | 2 | workArtifact + reconciliationDoc | reviewStrategy | reviewStrategy |
| Finalization | 0 | workArtifact (final) + completionDiff + vote | vote (converged/blocked) | vote (converged/blocked) |

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
- Tier 1: No gates. Fully autonomous.
- Tier 2: Gates on finalization entry (after last sub-round step 2).
- Tier 3: Gates after every sub-round step 2 AND on finalization.

---

## 11. Error Handling and Recovery

### 11.1 Parse Failures (`artifact_failures`)

When an agent's LLM output can't be parsed (`parse_failed: true`):

1. **Daemon records the failure** via `recordArtifactFailure()`. Failure count is keyed per node per sub-round per step.
2. **Audit entry written** with node ID, step, subround, and failure count.
3. **Critical warning at 3 failures** for the same node+step.
4. **Reflection still counts toward barrier** — the step advances, but downstream nodes see `[UNAVAILABLE: ...]` placeholders for the missing artifacts.

**Current limitation:** There is no active retry (re-notifying the node to try again). The failed reflection advances the barrier with degraded input. This is a known gap — see section 14.

### 11.2 Step-Level Timeout

If a node hangs (LLM timeout, agent crash, network partition), the step-level timeout fires after `CIRCLING_STEP_TIMEOUT_MS` (default 10 min, configurable via env).

**Recovery flow:**
1. Timer fires → `handleCirclingStepTimeout()`
2. Staleness check (step may have already advanced)
3. Identify nodes that haven't submitted (compare reflections vs active nodes)
4. Mark unresponsive nodes as dead
5. Re-check barrier (dead nodes excluded from count)
6. If barrier met → advance normally
7. If all nodes dead → abort session, release parent task

**Why this is separate from task-level stall detection:**
The daemon's `detectStalls()` checks task heartbeats every 30s. But if an agent is alive (passing heartbeat) while stuck on a circling step (LLM call hanging), stall detection won't fire. The step timeout catches this case.

### 11.3 Recruiting Guard

`checkRecruitingDeadlines` applies a role-distribution guard for circling sessions. Even if `min_nodes` is met, circling won't start unless there is exactly 1 worker and at least 2 reviewers among the joined nodes. On failure, the session is aborted and the parent task is released for human triage.

---

## 12. Tier Gates and Human Intervention

### 12.1 Gate Trigger Points

Gates are triggered by `advanceCirclingStep()` returning `needsGate: true`. The daemon publishes a `circling_gate` NATS event. The bridge materializes it to kanban as `status: waiting-user`.

### 12.2 Blocked Vote Escalation

During finalization, if any node votes `blocked`, the daemon triggers a gate regardless of tier. The bridge message includes the reviewer's summary (truncated to 150 chars):

```
[GATE] SR2 blocked — reentrancy guard missing on withdraw function
```

### 12.3 Gate Approve → Complete or Resume

`mesh.collab.gate.approve` resumes the protocol. If in finalization, the session is force-completed. If mid-protocol (tier 3), the next step starts.

### 12.4 Gate Reject → Another Sub-Round

`mesh.collab.gate.reject` increments `max_subrounds`, resets to circling phase, and starts a new step. The human says "not good enough" and the protocol loops again. No special recovery logic — the gate reject handler is 10 lines.

---

## 13. Test Infrastructure

### 13.1 NATS Mocking

Both test files use the same pattern to mock the `nats` module:

```javascript
const Module = require('module');
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'nats') return 'nats';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['nats'] = { exports: mockNats };
```

This lets `CollabStore` import without a real NATS connection. The `MockKV` class provides an in-memory key-value store.

### 13.2 `collab-circling.test.js` — 27 Tests

**Session Creation (3 tests):** Schema fields, reviewer ID slots, non-circling null.

**Artifact Store (4 tests):** Store/retrieve, backward scan, init fallback, null on not-found.

**compileDirectedInput (7 tests):**
- Init: all nodes get task plan.
- Step 1 SR1: Worker gets strategies, Reviewers get workArtifact.
- Step 1 SR1: reconciliationDoc skipped silently.
- Step 1 SR2+: Worker also gets reviewArtifacts alongside strategies.
- Step 1 SR1: Worker does NOT get reviewArtifacts (none exist yet).
- Step 2: Reviewer gets cross-review from other reviewer.
- Step 1 SR2+: missing reconciliationDoc shows UNAVAILABLE.

**advanceCirclingStep (6 tests):** All 5 state transitions + tier-3 gate behavior.

**isCirclingStepComplete (3 tests):** Partial submissions, full submissions, wrong-step tag.

**parseCirclingReflection (4 tests):** Single artifact, multi-artifact (Worker Step 2), missing delimiters fallback, blocked vote.

### 13.3 `daemon-circling-handlers.test.js` — 13 Tests

These tests replicate the daemon's decision logic since `mesh-task-daemon.js` isn't importable as a module. A `simulateReflectHandler()` function mirrors the daemon's circling branch.

**reflect → store → barrier → advance (2 tests):** Full 3-node cycle advances to step 2. Partial (2/3) does not advance.

**parse_failed tracking (2 tests):** Failure counter increments. Failed reflections still count toward barrier (advances with missing artifacts).

**completeCirclingSession (2 tests):** Blocked vote triggers gate. All-converged retrieves final artifact.

**Recruiting guard (5 tests):** min_nodes defaults (circling=3, parallel=2), explicit override, reviewer ID schema, role distribution check.

**Gate bridge message (2 tests):** Blocked summary extraction. Generic fallback.

---

## 14. Known Gaps and Future Work

### Active Retry for Parse Failures

`artifact_failures` is tracked but the daemon doesn't re-notify the node to retry. A failed parse advances the barrier with degraded input. The spec calls for retry 3x, then degrade. Current behavior: degrade immediately, track failures for observability.

**Fix:** In the daemon's reflect handler, if `failCount < 3`, re-publish the directed input to the failing node and return without counting the reflection toward the barrier.

### Adaptive Convergence (Early Exit)

`advanceCirclingStep` uses `current_subround >= max_subrounds` as the sole finalization trigger. The spec calls for early exit when all nodes vote `converged` and stall escalation when unresolved items stop decreasing. A protocol that converges in SR1 still runs all `max_subrounds` sub-rounds.

### Parser Module Extraction

`parseCirclingReflection` in `mesh-agent.js` is tested via an inline copy in the test file (the agent has too many dependencies to require directly). Changes to the production parser won't be caught by tests. Should be extracted to `lib/circling-parser.js` as a standalone module.

### Preamble Corruption Edge Case

If the LLM adds preamble text before the first artifact ("Here's my updated code:"), it's included in the first artifact's content. Low probability with well-structured prompts, but could corrupt code artifacts.

### Session Blob Growth

All artifacts are stored in a single session JSON blob in JetStream KV. For a 3-SR protocol with complex contracts: ~27 artifacts x 5-15KB = 135-405KB. JetStream KV max value is 1MB. Monitor and consider external artifact store for production scale.
