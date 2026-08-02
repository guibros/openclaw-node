# COMPONENT_REGISTRY — federation plan

Current state of the components that determine whether federation can enter its Phase-1 evidence
gate. Probed 2026-08-02 EDT; implementation history lives in audits and DECISIONS.

## Family 1: transport substrate

### NATS R=3 cluster — :4222, ai.openclaw.nats-{1,2,3}

| | |
|---|---|
| **Status** | LIVE on one machine — transport quorum exists, machine-loss resilience remains unproven |
| **Verified** | 2026-08-02 — nats-1/2/3 processes live; federation watcher reads `jsz.meta_cluster`, leader `openclaw-nats-3`, majority >=2/3 reachable |

### Per-node local event stream

| | |
|---|---|
| **Status** | BROKEN NAME DERIVATION — hostname dots produce invalid NATS stream names |
| **Verified** | 2026-08-02 — full watcher attempted `local-events-MoltyMacs-Virtual-Machine.local`; NATS stream names reject `.` |

## Family 2: grappe runtime

### Coordinator — bin/mesh-task-daemon.js

| | |
|---|---|
| **Status** | LIVE — coordinator process is running, but this alone is not a worker grappe |
| **Verified** | 2026-08-02 — stack reports PID 56662; federation watcher `fed.coordinator=WORKING` |

### Advanced-LLM worker — bin/mesh-agent.js

| | |
|---|---|
| **Status** | DOWN — no authenticated advanced-LLM worker process; D11 therefore blocks real grappe evidence |
| **Verified** | 2026-08-02 — stack reports mesh-agent DOWN; loaded unit has no process |

### Grappe registry + member heartbeats — GRAPPE_REGISTRY / MESH_NODE_HEALTH

| | |
|---|---|
| **Status** | EMPTY OR UNREADABLE — no live grappe can be observed; historical wg-alpha evidence does not describe the current bus |
| **Verified** | 2026-08-02 — federation watcher `fed.grappe.members=UNKNOWN`; `fed.session.liveness=OFF` because no active session |

### Grappe CLI + signing implementation

| | |
|---|---|
| **Status** | BUILT AND HISTORICALLY PROVEN, CURRENT RUNTIME EMPTY — form/status/dissolve/token/join code exists; no current registered grappe |
| **Verified** | 2026-08-02 code inventory; last live valid/forged join evidence remains the 2026-07-11 step 1.4 audit and is not promoted to current runtime status |

## Family 3: Phase-1 evidence gates

### Premise benchmark — step 2.6

| | |
|---|---|
| **Status** | REOPENED at `v2.6-pre` — one blinded hand-run is qualified evidence, not the contracted five-task result |
| **Verified** | 2026-08-02 — AUDIT_POST records one comparable pair and abandonment of the automated run; inventory contract still requires >=5 tasks |

### Worker-cluster operational gate — step 3.5

| | |
|---|---|
| **Status** | IN-FLIGHT, BLOCKED ON 2.6 — matrix, chaos, soak, and T7 evidence do not yet exist |
| **Verified** | 2026-08-02 — inventory contract and live substrate probe; no mesh agent, no registry, no active collab session |

### Federation operator surface — step 6.2

| | |
|---|---|
| **Status** | IN-FLIGHT — page/API implementation landed; operator visual close gate remains outstanding |
| **Verified** | 2026-08-02 ledger reconciliation; no new visual acceptance claimed |

### Federation watcher/notification gate — step 6.3

| | |
|---|---|
| **Status** | IN-FLIGHT — quorum detection works; literal grappe-member kill and resulting ledgered notification remain unobserved |
| **Verified** | 2026-08-02 watcher: 2 WORKING / 0 BROKEN / 1 OFF / 1 UNKNOWN, health 67%; no live grappe member exists to kill |

## Family 4: downstream layers

### Management grappe — Block 4

| | |
|---|---|
| **Status** | NOT STARTED — 4.1 cannot open before 3.5 closes |
| **Verified** | 2026-08-02 inventory Needs contract; no `mesh.mgmt.*` runtime evidence |

### Savant grappe — Block 5

| | |
|---|---|
| **Status** | NOT STARTED — HyperAgent is separate node-local substrate and does not close federation 5.1 |
| **Verified** | 2026-08-02 inventory/ROADMAP separation; no federation-wide feed or savant session |
