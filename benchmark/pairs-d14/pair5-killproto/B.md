---

## Kill Protocol — Federation 6.3: Live Grappe Member Termination During <phase>

**Selected scenario:** kill `<role>` during <phase> phase, step 1 (Review Pass), <phase> 1.

---

### Preconditions

**Registry (GRAPPE_REGISTRY KV):**
- Key `grappe.<id>` exists; `status: "live"`; `members: ["<role>", "<role>", "<role>"]`
- Formed via `openclaw-grappe form --mode adversarial --members <role>,<role>,<role>`

**Member health (MESH_NODE_HEALTH KV):**
- All three node entries present; each `reportedAt` within the last 90 s; `gradeGrappeMembers()` returns `WORKING`

**Session (MESH_COLLAB KV):**
- `status: "active"`, `mode: "circling_strategy"`
- `<phase>.phase: "<phase>"`, `<phase>.current_subround: 1`, `<phase>.current_step: 1`
- `<phase>.step_started_at` set to a timestamp ≤ 60 s ago (fresh <phase>)
- `nodes[]` — all three entries carry `status: "active"`
- `recruited_count: 3`, `min_nodes` derived from convergence config (≥ 2 for degraded continuation)

**Roles:**
- `<role>` — assigned `node_roles[0]`; `<role>` — `node_roles[1]`; `<role>` — `node_roles[2]`

**PID:**
- `mesh-task-daemon` running; PID confirmed via `launchctl print ai.openclaw.mesh-task-daemon | grep pid` (non-zero)
- `<role>` agent process PID recorded; heartbeat loop running

---

### Signal and Timing

Send `SIGKILL` to `<role>`'s PID immediately after `step_started_at` is written but before `<role>` has published a reflection for step 1. Confirm process exit with `kill -0 <pid>` returning non-zero.

---

### Expected Heartbeat-Freshness Delay

`<role>`'s MESH_NODE_HEALTH entry retains its last `reportedAt`. After 90 s without a new write, `gradeGrappeMembers()` classifies `<role>` as stale; the probe returns `BROKEN` or `WORKING` with `stale_members: ["<role>"]`. This lag is unavoidable; probes do not race the kill.

---

### Watcher/KV/Session Evidence

| Observable | Expected value after kill |
|---|---|
| `MESH_NODE_HEALTH["<role>"].reportedAt` | Frozen at kill time; age grows past 90 s |
| `gradeGrappeMembers()` | `stale_members: ["<role>"]`, overall status `BROKEN` |
| Stall detection (≤ 5 min from last heartbeat) | `mesh.agent.<role>.alive` probe → no response → timeout |
| `MESH_COLLAB[session].nodes[<role>].status` | Written to `"dead"` by daemon |
| `CIRCLING_STEP_TIMEOUT_MS` timer (10 min from `step_started_at`) | Fires; handler marks any non-submitting node dead, re-evaluates <phase> |
| Session `status` | Remains `"active"` if <phase> now satisfied; `"aborted"` if not |

---

### Deadline-Sweep Behavior

The 60 s periodic sweep (`sweepCirclingStepTimeouts`) catches any session whose `step_started_at` age exceeds `CIRCLING_STEP_TIMEOUT_MS`. On fire it marks non-submitting nodes dead, then calls `advanceCirclingStep()` if active reflection count meets the (now-reduced) <phase>, or calls `markAborted()` if no active nodes remain.

---

### Expected Outcome: Degradation (Not Abort)

With `<role>` dead, two active nodes remain. If `<role>` and `<role>` have both submitted step-1 reflections before or by timeout, `isRoundComplete()` — which filters `status: "dead"` nodes — evaluates to true. The session advances to step 2 with `<role>` receiving only `<role>`'s review artifacts. The final artifact will carry degraded <role> coverage but the session reaches completion. The watcher transitions from `BROKEN` to `WORKING` if both surviving members remain fresh.

**Abort is expected instead** if `min_nodes` was set to 3 at session creation (convergence config requiring all voices). In that case, `sweepCollabRoundTimeouts` reaches `alive < min_nodes`, writes `status: "aborted"` to MESH_COLLAB, marks the parent task `RELEASED`, and appends an `session_aborted` audit log entry.

---

### Alternate Outcomes That Expose Defects

1. **Session hangs indefinitely** — <phase> never re-evaluated after <role> death; `sweepCirclingStepTimeouts` did not fire or failed silently. Defect in the 60 s sweep.
2. **Session marked `aborted` despite 2 active nodes and `min_nodes: 2`** — premature abort; <phase> check does not correctly filter dead nodes from quorum.
3. **Session marked `completed` but `<role>` reflection counted** — stale data read; CAS race allowed a phantom reflection to persist.
4. **`gradeGrappeMembers()` returns `WORKING` indefinitely** — probe reads cached KV without TTL enforcement; freshness threshold not applied.
5. **Daemon crashes on `<role>` alive-probe timeout** — unhandled rejection in `detectStalls`; node is never marked dead and session stalls permanently.

---

### Cleanup

1. `kill -9 <daemon-pid>` if daemon is in an inconsistent state.
2. Delete MESH_COLLAB key for the session: `nats kv del MESH_COLLAB <session_id>`.
3. Delete MESH_NODE_HEALTH entries for all three test nodes.
4. Delete GRAPPE_REGISTRY key: `nats kv del GRAPPE_REGISTRY grappe.<id>`.
5. Confirm `gradeGrappeMembers()` returns `OFF` (no members found) and `gradeSessionLiveness()` returns `OFF`.
