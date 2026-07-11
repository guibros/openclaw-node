# AUDIT_PRE — Step 2.3 · Paper gap 14.2 — parse-failure retry ×3 before degradation

## §0 Micro Re-Orient

- **Where:** Block 2 (adversarial circling), step 2.3 of 28 total steps.
- **Last step changed:** 2.2 — proved paper §14.1 early-exit (JSDoc + 6 tests, runtime NATS KV).
- **This step contributes:** parse reliability for real-LLM sessions (qwen3:8b drops delimiters; 2.4 needs retry before degradation to be viable).
- **North-star line:** Block 2 exit criterion = one real adversarial run via 2.4; this step is the prerequisite.
- **Still right?** Yes — first `[ ]` in INVENTORY, all Needs present.

## §1 Intent

Implement paper §14.2: when a node's LLM output fails circling-artifact parsing, the daemon retries that node (re-publishes the directed input) up to 3 times before counting the failure as a degraded contribution and logging CRITICAL. A node that eventually parses successfully is not degraded; the barrier advances only once all active nodes have either succeeded or been degraded (≥3 failures).

**Current behavior (pre-step):** every parse-failed reflection is immediately submitted to the round and counted toward the barrier, regardless of failure count. The CRITICAL log fires on failCount ≥ 3 but is purely cosmetic — the reflection was already counted.

**New behavior (this step):**
- `failCount < 3` → do NOT submit the reflection; publish a retry round message to the node; return early from the handler (barrier does not advance for that node)
- `failCount ≥ 3` → submit the reflection (barrier advances for that node), log CRITICAL

## §2 Design (consuming 2.2 carry-forwards)

Carry-forwards from 2.2:
- Retry is in the daemon reflect handler, not in `advanceCirclingStep` — correct, this is the right layer.
- `artifact_failures` tracking (`recordArtifactFailure`, `getArtifactFailureCount`) is already in `lib/mesh-collab.js` and already called in the daemon handler.

**Changed files:**

### `bin/mesh-task-daemon.js`

In `handleCollabReflect`, parse-failure branch (currently lines ~914-930):

```
} else if (reflection.parse_failed) {
  const failCount = await collabStore.recordArtifactFailure(session_id, reflection.node_id);
  // ... log, audit ...
  if (failCount < 3) {
    await retryCirclingNodeStep(session_id, reflection.node_id, failCount, session);
    return;  // ← NEW: barrier does not advance for retried node
  }
  log(`CIRCLING CRITICAL: ... degraded`);
  // fall through → submitReflection + barrier check (degraded node counts)
}
```

New helper function `retryCirclingNodeStep(sessionId, nodeId, failCount, session)`:
- Re-publishes the same round data to `mesh.collab.${sessionId}.node.${nodeId}.round`
- Adds `parse_retry: failCount` to the message (context for the agent's future prompt)
- Does NOT create a new round (existing round stays open)
- Does NOT reset `step_started_at` (existing timeout still applies — if retries exhaust the timeout, the stall handler degrades the node as before)

### `test/daemon-circling-handlers.test.js`

Update `simulateReflectHandler` and the existing "parse_failed" tests:
- The existing test "parse_failed reflection still counts toward barrier" describes OLD behavior; update it to the NEW behavior (parse_failed with failCount=1 → retry event, NOT submitted to round).
- Keep the existing failure-counter-increment test (behavior unchanged).

### `test/circling-parse-retry.test.mjs` (NEW)

Suite 1 (unit, mock KV, 4 tests):
1. Single parse failure (failCount=1) → NOT in round's reflections (retry was issued)
2. Two failures, then success → reflection IS in round, barrier satisfies with 3/3 nodes, node not degraded
3. Three failures → reflection IS in round (degraded), CRITICAL logged
4. Degraded node: barrier advances when other 2 also submit (failure counts as one active-node slot)

Suite 2 (NATS integration, 1 test):
- Real NATS server (ephemeral, port 14880)
- Full session lifecycle: 3 nodes, worker injects 2 parse failures then succeeds
- Observed: session KV `status=completed`, failure count = 2 (not 3, so no degradation), worker's success reflection in the round

## §3 Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `submitReflection` duplicate-check now matters for retries | Low | We don't call `submitReflection` on retry; the agent re-publishes from fresh — no duplicate in round |
| Step timeout fires during retry attempts | Low | The existing stall handler marks unresponsive nodes dead and force-advances; retry does not reset the timer. Same timeout applies. |
| The `parse_retry` field changes agent prompt behavior | None | Agent ignores unknown fields in round data; the prompt does not change without explicit `buildCirclingPrompt` changes |
| Existing test "parse_failed counts toward barrier" contradicts new behavior | Certain | Will update the test explicitly |

## §4 Needs pre-screen (PROTOCOL §11)

| Need | Check |
|------|-------|
| 2.1 baseline — COMPONENT_REGISTRY Family 2 LIVE | ✓ |
| `bin/mesh-task-daemon.js` reflect handler (parse_failed branch) | ✓ present lines 914-930 |
| `collabStore.recordArtifactFailure()` | ✓ lib/mesh-collab.js:793 |
| `collabStore.getArtifactFailureCount()` | ✓ lib/mesh-collab.js:809 |
| `startCirclingStep` round-message format (for retry message shape) | ✓ daemon lines 1295-1307 |

All Needs present.

## §5 Pre-screen decision

Proceed. No Needs missing. Working tree clean. VERSION=v2.2 (clean). Step is atomic (one independent outcome: parse failures retry before degradation).

## §6 File-delta outline

| File | Change |
|------|--------|
| `bin/mesh-task-daemon.js` | Modify parse-failure branch; add `retryCirclingNodeStep` helper |
| `test/daemon-circling-handlers.test.js` | Update `simulateReflectHandler` + 1 existing test title/assertion |
| `test/circling-parse-retry.test.mjs` | NEW — 5 tests (4 unit + 1 NATS integration) |
| `memory-plan/plans/federation/VERSION` | v2.3-pre → v2.3-mid → v2.3 |
| `memory-plan/plans/federation/INVENTORY.md` | flip 2.3 `[ ]` → `[A]` → `[x]` |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` | update Family 2 status |
| `memory-plan/plans/federation/audits/step23_parse-retry/AUDIT_PRE.md` | this file |
| `memory-plan/plans/federation/audits/step23_parse-retry/AUDIT_POST.md` | Phase 7 |
