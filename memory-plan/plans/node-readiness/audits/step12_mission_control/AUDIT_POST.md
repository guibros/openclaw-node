# Step 1.2 — Mission Control restoration

## Promised vs landed
The existing production service now serves current, authenticated Mission Control.
The restored source is fa54a0d5a66bb9b64b9983e3b871f225161b3a97; build
JoDmTRHsYJYZLQg5CKnKW uses the service's Node 22.22.0 / ABI 127.
All 194 tracked MC files and both runtime helpers match committed source hashes.
Final observation passed: 11 healthy samples over 605.21 seconds, from
2026-09-28 00:14:58 through 00:25:03 EDT. Managed PID 26400 and run count 2 stayed
unchanged, WAL remained 4 MB, and all samples retained 537 tasks. The restored
scheduler returned 200 with no dispatch, timed or recurring work. Final full task
comparison and scheduling hash at 00:25:42 remained unchanged. Sanitized evidence
is in evidence.json; full private backups and hash manifest remain local.

## Implementation and regression checks
- Correct SQLite quick_check result handling; no automatic REINDEX on startup or
  corrupt-index cleanup. Failed handles close. Confirmed integrity/corruption errors
  remain blocked, while temporary locks and permission failures can retry.
- launchd/systemd own automatic recovery. Maintenance reports failed health;
  explicit mc-health recovery restarts the existing service, never an unmanaged
  development server. Missing token and authentication failures do not cause restarts.
- Port the deployed mutation behavior from local commit 88be4f2 and authenticate
  every maintenance read, including graph statistics. Rejected HTTP outcomes cannot
  be reported as successful mutations.
- 129 MC tests and 19 focused helper tests pass; lint and isolated production build
  pass. The real SQLite regression holds a writer lock, observes BUSY, releases it,
  and initializes successfully in the same process. The HTTP fixture exercises the
  real maintenance CLI's seven requests and a rejected cycle.
- CI on fa54a0d passes root tests on Node 20/22 and MC tests/lint/build:
  https://github.com/moltyguibros-design/openclaw-node/actions/runs/36376813033.
  Claude independently reviewed the diff and reran the 19 focused tests, approving
  source subject to final runtime evidence in the designated review conversation.

## Runtime evidence
Private online SQLite backups pass integrity_check with 537 tasks; source/build/env
backups are retained under the operator's private backup directory. Rehearsal and
native dependencies use the same Node environment as launchd.

At 2026-09-28 00:14:48 EDT, authenticated health and cookie-authenticated UI returned
200; anonymous GET/POST returned 401; valid-token foreign Host and Origin returned
403. The only listener is 127.0.0.1:3000. No next dev process is running.

At 00:14:58, deliberate SIGTERM to the verified supervised listener recovered through
launchd KeepAlive in 2.41 seconds. Managed PID changed 26208 to 26400 and run count
1 to 2. Health was healthy, task count 537, and the existing token was unchanged.

All existing columns of all 537 tasks match the original backup exactly. The only
new task column is extra, and every value is NULL. Board/DB task IDs and scheduling
fields agree; no dispatchable, timed-queued or recurring-done tasks exist. Scheduling
state hash: 68c7047baea186af94ad341204551117e9c229f467b20209b3e2e05793bec6a6.

At 00:19:06, a real deployed maintenance pass made seven authenticated live dashboard
requests; all returned 200. Its unrelated filesystem checks used a private empty
workspace. HTTP observation recorded only method/path/status, never credentials.
Sync indexed 6, updated 1 and removed 0; consolidation merged 0 of 29 active facts;
graph seeded 0 and reported 25 entities / 6 active relations. Reports matched the
actual outcomes. A fresh consistent database backup preceded this pass.

## Carry-forwards and limits
This proves dashboard startup, authenticated maintenance and supervised recovery.
It does not prove task execution, autonomous memory quality or cluster coordination.
Those remain explicit later inventory rows. Local full root-suite execution remains
deferred to test isolation (2.1); CI runs the full suite. Fresh-clone plan lint remains
tracked in #70. The workplan viewer remains stopped pending 1.6. No bus migration,
worker enforcement or plan-chain activation occurred.

The manual recovery helper's coarse exit codes and disabled-unit handling remain
delivery review concerns (1.5); it is not an automatic controller. Persistent chmod
failure can repeat startup scanning. Other database writers, including telemetry,
are covered by the separate persisted-state work and recovery runbook.
