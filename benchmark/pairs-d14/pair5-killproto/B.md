## Kill-Protocol Specification: Reviewer Kill During Circling Step 1

**Federation 6.3 — Grappe Member Kill Test Protocol**
**Target role:** `reviewerB` · **Target phase:** `circling` / step 1 (review pass)

---

### Preconditions

**Registry (`GRAPPE_REGISTRY` KV)**
Key `grappe.wg-alpha` must exist with `status: "live"` and exactly three members: `node-worker`, `node-revA`, `node-revB`. Verify with `openclaw-grappe.mjs status wg-alpha`.

**Member health (`MESH_NODE_HEALTH` KV)**
All three keys must be present with `reportedAt` within the last 30 s (well under the 90 s freshness threshold). Each entry's `services` array must include `mesh-agent` with a non-null integer `pid`. Record `node-revB`'s PID from this entry — this is the kill target.

**Session (`MESH_COLLAB` KV)**
A circling session must be `status: "active"` with `circling.phase === "circling"` and `circling.current_step === 1`. The `nodes` array must show all three members as `status: "active"`. Capture `circling.step_started_at`; the deadline sweep fires at `step_started_at + CIRCLING_STEP_TIMEOUT_MS` (10 min default). Confirm that `node-revB` has **not yet submitted** a step-1 reflection (no entry in `current_round.reflections` with `circling_step === 1` for that node). Confirm `node-worker` and `node-revA` have both submitted step-1 reflections — this places the barrier one submission short.

---

### Signal and Timing

Issue `kill -9 <pid>` (SIGKILL) to the `mesh-agent` process on `node-revB`. SIGKILL is chosen deliberately: it bypasses any graceful-shutdown handler, leaving no last-words message on any NATS subject and producing no voluntary KV update. Record wall-clock `T_kill`.

---

### Expected Heartbeat-Freshness Delay

The `MESH_NODE_HEALTH` TTL is 120 s. The probe's stale threshold is 90 s. The killed node's health entry will persist in KV for up to 120 s post-kill; `gradeGrappeMembers` will continue to report `WORKING` for up to 90 s (`T_kill + 90 s`), then flip to `BROKEN` ("1/3 member(s) heartbeat stale (>90s)"). The KV key auto-expires at `T_kill + 120 s` and disappears from the watcher entirely.

---

### Watcher / KV / Session Evidence

| Time | `MESH_NODE_HEALTH/node-revB` | `MESH_COLLAB/<sid>` node status | `gradeGrappeMembers` |
|---|---|---|---|
| `T_kill + 0–90 s` | present, `reportedAt` frozen | all three `active` | WORKING |
| `T_kill + 90–120 s` | present, now stale | all three `active` | BROKEN |
| `T_kill + 120 s+` | **deleted by JetStream TTL** | updated by sweep | BROKEN |
| `T_kill + 600 s` (sweep) | absent | revB → `dead` | BROKEN |

---

### Deadline-Sweep Behavior

At `step_started_at + 600 000 ms`, `sweepCirclingStepTimeouts()` runs. It verifies phase/subround/step match the captured snapshot (guards against stale timers). It collects nodes that did not submit a step-1 reflection: only `node-revB`. It sets `node-revB.status = "dead"` and writes back via CAS. It then calls `isCirclingStepComplete()`: `activeNodes = [worker, revA]`; both have reflections; barrier is satisfied. **Action: ADVANCE** — the session moves to step 2 without aborting. The session is now operating in a degraded 2-of-3 configuration.

---

### Outcome: Advance (Degraded)

The implementation advances, not aborts. The missing reviewer does not break the minimum quorum because `isRoundComplete` counts only `status !== "dead"` nodes, and the remaining two have both reflected. The session continues through step 2 and finalization with `node-revB` permanently excluded. There is no explicit "degrade" status in the state machine; the session remains `status: "active"` with an internal dead-node marker.

---

### Abort Criteria

An abort would require the sweep to find that `activeNodes` after marking `node-revB` dead cannot satisfy the barrier — i.e., if `node-worker` or `node-revA` also failed to submit. If both survivors had not submitted by sweep time, all three would be marked dead, `activeNodes.length === 0`, `isRoundComplete` returns `false`, and the action flips to `abort`. A second abort trigger: if the overall session reaches `max_subrounds` with no convergence vote from surviving nodes.

---

### Alternate Outcomes That Expose a Defect

1. **Action returns `abort` when only one reviewer is killed and the other two submitted** — indicates the sweep is not correctly excluding dead nodes from the active-node count, re-introducing the original regression fixed in the `isRoundComplete` guard.
2. **`gradeGrappeMembers` never flips to BROKEN** — indicates `toMemberHealth` is misreading field names (`timestamp` instead of `reportedAt`), re-introducing the F-C3 regression; the 90 s window would never trigger.
3. **Session `status` transitions to `aborted` immediately at node death** — indicates an out-of-band SIGKILL handler that was not expected to exist; verify no such handler is registered in `mesh-agent`.
4. **`node-revB` KV entry persists beyond 130 s post-kill** — indicates the KV TTL is not set on the bucket, removing the automatic dead-peer detection mechanism.

---

### Cleanup

After protocol completion: (a) delete `GRAPPE_REGISTRY/grappe.wg-alpha` via `openclaw-grappe.mjs dissolve wg-alpha`; (b) manually delete `MESH_COLLAB/<sid>` if status is `aborted` and no downstream consumer needs it; (c) confirm `MESH_NODE_HEALTH/node-revB` has auto-expired (should be absent >120 s post-kill); (d) restart `mesh-agent` on `node-revB` to restore the node to full health before the next test run.
