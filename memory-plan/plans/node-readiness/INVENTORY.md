# Node readiness — inventory

One row is one verified outcome. Open rows are unproven. Reuse existing issue IDs.

| Block | Step | Version | Status | Description |
|---|---|---|---|---|
| 1 | 1.1 | v1.1 | [x] | Restore gateway startup with schema-valid streaming configuration — 2026-09-27: 703s stable PID/run count, validator, healthy loopback and anonymous 401 |
| 1 | 1.2 | v1.2 | [x] | Restore installed Mission Control — fa54a0d deployed; 605.21s healthy, supervised recovery 2.41s, auth/maintenance verified, 537 tasks preserved |
| 1 | 1.6 | v1.6 | [A] | Restore the plan viewer with authenticated control endpoints — b4bbac2 deployed/source approved; 603.38s healthy stability and 0.447s crash recovery pass; production browser acceptance pending |
| 1 | 1.3 | v1.3 | [ ] | Establish restorable persisted-state backups |
| 1 | 1.4 | v1.4 | [ ] | Reconcile message-bus topology |
| 1 | 1.5 | v1.5 | [ ] | Make deployment revision and services reproducible |
| 2 | 2.1 | v2.1 | [ ] | Isolate tests from production resources |
| 2 | 2.2 | v2.2 | [ ] | Validate clean one-command installation |
| 2 | 2.3 | v2.3 | [ ] | Close execution authorization gaps |
| 3 | 3.1 | v3.1 | [ ] | Make autonomous memory capture recoverable |
| 3 | 3.2 | v3.2 | [ ] | Prove durable bounded audience-correct recall |
| 3 | 3.3 | v3.3 | [ ] | Measure autonomous memory quality |
| 4 | 4.1 | v4.1 | [ ] | Verify structured harness lifecycle |
| 4 | 4.2 | v4.2 | [ ] | Verify dashboard task control |
| 4 | 4.3 | v4.3 | [ ] | Bound workplan history loading |
| 5 | 5.1 | v5.1 | [ ] | Establish explicit peer trust |
| 5 | 5.2 | v5.2 | [ ] | Execute changing plan across two machines |
| 6 | 6.1 | v6.1 | [ ] | Publish evidence-aligned release |

> **1.1 — Goal:** Restore gateway startup with schema-valid streaming configuration.
> **Needs:** Installed gateway 2026.5.27, issue #66 and private live config.
> **Feeds:** Gateway and subsequent plugin acceptance.
> **Verify:** runtime/code: Rendered template and live config validate; loopback gateway health succeeds; launchd PID/run count remain stable through a ten-minute observation window; anonymous chat POST returns 401; unrelated config and permissions unchanged.

> **1.2 — Goal:** Restore installed Mission Control.
> **Needs:** Existing service and deployed project inventoried.
> **Feeds:** Dashboard and scheduler.
> **Verify:** runtime/code: Deploy a known source revision and hash manifest; preserve task IDs, scheduling fields, token and existing data; serve authenticated UI/API and reject anonymous GET/POST plus foreign Host/Origin. Prove supervised crash recovery and ten minutes of healthy stable PID/run count, observe the authenticated scheduler with zero dispatch candidates, and confirm no unmanaged next dev.

> **1.3 — Goal:** Establish restorable persisted-state backups.
> **Needs:** SQLite and NATS stores enumerated.
> **Feeds:** Safe topology and storage changes.
> **Verify:** runtime/code: SQLite backup API (not a raw live file copy) and JetStream snapshots or stopped-server backups preserve both histories; restore in isolation and compare integrity_check, row counts, stream counts and last sequences.

> **1.4 — Goal:** Reconcile message-bus topology.
> **Needs:** 1.3 verified; #68/#88 and distinct histories reviewed; migration decision recorded.
> **Feeds:** Local event and task coordination.
> **Verify:** runtime/code: Intended topology survives restart; histories accounted for; retired service no longer contends for port.

> **1.5 — Goal:** Make deployment revision and services reproducible.
> **Needs:** 1.4 closed; #44–#50/#58 reviewed.
> **Feeds:** Install, upgrade and rollback.
> **Verify:** runtime/code: Deploy and roll back an immutable revision; observe matching service code and restored operation.

> **2.1 — Goal:** Isolate tests from production resources.
> **Needs:** #52/#61 reproduced in disposable fixtures.
> **Feeds:** All regression suites.
> **Verify:** runtime/code: Full required suite passes in isolated home/database/bus; production task counts and files unchanged.

> **2.2 — Goal:** Validate clean one-command installation.
> **Needs:** 2.1 closed; supported platform/version contract; #20/#46/#53/#70/#71 reviewed.
> **Feeds:** New-node onboarding.
> **Verify:** runtime/code: Clean macOS and Linux environments install from one documented command and survive restart with passing acceptance.

> **2.3 — Goal:** Close execution authorization gaps.
> **Needs:** 1.4, 1.5 and 2.1 closed; #123–#127 reverified against merged repairs.
> **Feeds:** Safe workers and cluster.
> **Verify:** runtime/code: Unauthorized task, plan, reply and state transitions rejected; authorized lifecycle succeeds on isolated bus.

> **3.1 — Goal:** Make autonomous memory capture recoverable.
> **Needs:** 1.3, 1.4, 1.5 and 2.1 closed; frontend sources declared; #102/#120 reviewed.
> **Feeds:** Durable extraction.
> **Verify:** runtime/code: Controlled frontend sessions ingest and extract automatically, including restart during pending work.

> **3.2 — Goal:** Prove durable bounded audience-correct recall.
> **Needs:** 3.1 closed; #115/#118 and retention/privacy reviewed.
> **Feeds:** Frontend injection.
> **Verify:** runtime/code: Known facts recalled after restart at supported corpus size; restricted facts stay outside forbidden audiences.

> **3.3 — Goal:** Measure autonomous memory quality.
> **Needs:** 3.2 closed; #101/#113 reviewed; nonprivate multilingual corpus fixed.
> **Feeds:** Honest memory release claim.
> **Verify:** runtime/code: Reproducible precision and coverage meet preregistered thresholds; failures reported.

> **4.1 — Goal:** Verify structured harness lifecycle.
> **Needs:** 1.4, 1.5 and 2.3 closed; persistent gateway authentication verified; Foreman decisions and #128–#139 reverified.
> **Feeds:** Bounded execution.
> **Verify:** runtime/code: Real task passes independent verification; cancellation, failure and escalation preserve work and report truthful state.

> **4.2 — Goal:** Verify dashboard task control.
> **Needs:** 1.2, 1.4, 1.5 and 4.1 closed; current Kanban schemas reviewed.
> **Feeds:** Operator workflow.
> **Verify:** runtime/code: Create, observe, cancel and inspect controlled tasks through actual UI; UI matches durable state.

> **4.3 — Goal:** Bound workplan history loading.
> **Needs:** 1.6 source deployed; 2.1 closed; Claude's whole-file pinned-log observation reverified in a disposable fixture.
> **Feeds:** Responsive history viewing on consumer hardware.
> **Verify:** runtime/code: A 512 MiB synthetic pinned log serves a bounded tail while an authenticated discovery request completes within one second on the declared test machine; additional resident memory stays below 32 MiB and the response clearly identifies truncated history. Run against the staged and deployed viewer without changing production logs.

> **5.1 — Goal:** Establish explicit peer trust.
> **Needs:** 1.4, 1.5 and 2.3 closed; two distinct accessible machines identified.
> **Feeds:** Optional membership.
> **Verify:** runtime/code: Intended peers authenticate; unauthorized peer rejected; stable node identities after restart.

> **5.2 — Goal:** Execute changing plan across two machines.
> **Needs:** 5.1 closed; bounded dependencies and retry policy fixed.
> **Feeds:** Cluster acceptance.
> **Verify:** runtime/code: Dynamic plan completes on two machines through peer outage/rejoin, no duplicate owner or lost result.

> **6.1 — Goal:** Publish evidence-aligned release.
> **Needs:** All required rows closed; backlog and PR notes reconciled; provenance checked.
> **Feeds:** Installation and support.
> **Verify:** runtime/code: Released artifact installs/upgrades, CI passes and instructions accurately state limitations.

> **1.6 — Goal:** Restore the existing plan viewer with authenticated control endpoints.
> **Needs:** 1.2 closed; private review of viewer request handling and current unit; no active tick jobs.
> **Feeds:** Safe operator plan monitoring/control.
> **Verify:** runtime/code: authorized viewer reads and controls work; foreign Host/Origin and missing/invalid credentials fail closed; existing service survives restart and uses the reviewed source.
