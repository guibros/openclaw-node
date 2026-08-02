# COMPONENT_REGISTRY — hyperagent-evidence plan

Current state of every component needed to start the first evidence cohort. Probed
2026-08-02 EDT; no learning or improvement claim is permitted from these counts.

## Family 1: HyperAgent substrate

### Store + CLI — lib/hyperagent-store.mjs · bin/hyperagent.mjs

| | |
|---|---|
| **Status** | LIVE SUBSTRATE, EVIDENCE-EMPTY — mechanical mesh telemetry, strategy consultation/attribution, reflection scheduling, notification outbox, cohort report, and CLI-only approval paths are built |
| **Verified** | 2026-08-02 — deployed CLI reports telemetry=1, strategies=0, reflections=0, pending proposals=0, unreflected tasks=1; focused HyperAgent suites previously re-run 48/48 in this review window |

### Harness rules — config/harness-rules.json + deployed ~/.openclaw/harness-rules.json

| | |
|---|---|
| **Status** | RETIRED — repository tombstones prevent managed-rule resurrection; deployed set contains no HyperAgent prompt rules |
| **Verified** | 2026-08-02 — repository entries carry `retired:true`; deployed-file grep has no `hyperagent` match |

### Operator signals — ha_notify_outbox + notification ledger

| | |
|---|---|
| **Status** | BUILT, IDLE — pending reflections/proposals have a durable idempotent signal path; there are currently no rows to signal |
| **Verified** | 2026-08-02 — store schema includes `ha_notify_outbox`; CLI status has zero reflections/proposals |

### Mission Control — /hyperagent

| | |
|---|---|
| **Status** | LIVE READ-ONLY SURFACE — approval remains CLI-only |
| **Verified** | 2026-08-02 — Mission Control live on :3000; `/hyperagent` returns HTTP 200 |

## Family 2: cohort execution dependencies

### Mesh-primary D11 worker path — mesh-agent + mesh-task-daemon

| | |
|---|---|
| **Status** | BLOCKED — coordinator live, advanced-LLM mesh worker down; no current grappe registry or active session |
| **Verified** | 2026-08-02 — task daemon PID 56662; mesh-agent DOWN; federation watcher grappe=UNKNOWN, session=OFF |

### Companion lane — LOCAL_LANE_DESIGN.md + external companion-bridge

| | |
|---|---|
| **Status** | DESIGN ONLY — I1-I5 unopened; no lane schema, daemon strategy GET, explicit task boundary, or managed bridge unit |
| **Verified** | 2026-08-02 — companion bridge port 8787 closed; design remains the only implementation record |

### Cohort manifest — step 2.1

| | |
|---|---|
| **Status** | NOT SIGNED — next operator-gated step; no eligible run_id exists |
| **Verified** | 2026-08-02 — inventory first open row is 2.1; scope idle; production telemetry remains one pre-cohort row |
