# AUDIT_POST — step 4.4 · Scheduler heartbeat authentication

## 1. Verdict

PASS. Mission Control scheduler ticks no longer depend on an open browser and no longer fail the
mutation auth gate. The gate remains enforced: anonymous POST is still 401, while the deployed timer
authenticates from an internal token read and records HTTP 200 with exit 0.

## 2. Landed

- Added `bin/scheduler-heartbeat.mjs`: exact loopback-route validation, internal token read, no
  redirects, Bearer POST, bounded timeout, response evidence, and nonzero failure exits.
- Replaced direct curl in launchd/systemd templates with rendered Node/helper invocation. No token
  appears in unit files or process arguments.
- Added the helper to workspace installation and locked unit/installer ownership in tests.
- Set the measured timeout to 30 seconds, below the 60-second timer interval. The inherited 10-second
  cap produced one real false liveness miss while the broad suite saturated the host.

## 3. Code Evidence

- Helper/installer tests: 16/16 pass, covering auth header construction, empty token, exact loopback
  route, HTTP 401 handling without token echo, timeout bound, unit commands, and installer ownership.
- Mission Control auth suite: 102/102 pass; middleware and POST route are unchanged.
- Final root suite: 1938 pass / 0 fail / 1 skip of 1939.
- Launchd plist validates with `plutil`; installer module passes `bash -n`; diff check is clean.

## 4. Runtime Evidence

- Live anonymous `POST /api/scheduler/tick`: HTTP 401 with `{\"error\":\"token\"}`.
- Live helper call: HTTP 200 with `{triggered:[], dispatched:[], recurring:[], skipped:[]}`.
- Rendered unit executes `/usr/local/bin/node` plus the workspace helper; token is absent from argv.
- After final deploy, launchd advanced through runs 4 and 5 with last exit 0. Four success records in
  stdout carry HTTP 200 tick evidence. Source, workspace, and mesh SHA-256 values are identical.

## 5. Honest Boundaries

- One scheduled run hit the original 10-second timeout under full-suite host load and exited 1. This
  was not hidden: the runtime result drove the 30-second bounded adjustment, and two subsequent runs
  completed at exit 0.
- The helper proves the external tick reaches Mission Control; it does not claim any task was due in
  this window. All result arrays were correctly empty.
- Historical curl 401 lines remain in the existing stderr file; launchd's current exit state and new
  JSON stdout records distinguish pre-v4.4 history from current behavior.

## 6. Block 4 Global Review

Block 4 now closes four concrete runtime defects: queue-aware/authenticated consolidation launch,
single patched native dependency authority with isolated embedding probes, PID/freshness-based watch
verdicts, and authenticated browser-independent scheduler ticks. Each was deployed and observed.

The block does not make the node fully healthy. Consolidation still exceeds its five-minute hard cap;
gateway is retrying with stale request evidence; mesh-agent is not running; graph-cache freshness and
LLM latency remain variable; the retired single-node NATS unit still spawn-loops. These are recorded
as findings, not folded into Block 4 success language.

The next plan frontier returns to federation 2.6's five-task comparable blinded premise benchmark.
Its pre-screen must first establish the D11 worker/cohort runtime it actually needs; no management,
3.5 soak, or HyperAgent improvement claim follows from this repair block.
