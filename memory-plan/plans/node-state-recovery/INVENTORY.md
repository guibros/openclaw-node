# Node state recovery — inventory

| Block | Step | Version | Status | Description |
|---|---|---|---|---|
| 1 | 1.1 | v1.1 | [x] | Establish verified application SQLite recovery snapshots |
| 1 | 1.2 | v1.2 | [A] | Establish verified JetStream history recovery snapshots |
| 1 | 1.3 | v1.3 | [ ] | Establish a coordinated application and bus recovery point |

> **1.1 — Goal:** Establish verified application SQLite recovery snapshots.
> **Needs:** Twelve application stores enumerated; SQLite backup API and installed sqlite-vec available; private backup storage with sufficient space.
> **Feeds:** Node-readiness 1.3 and later storage/capture repair.
> **Verify:** runtime/code: Read-only source transactions feed SQLite's backup API; offline restores pass integrity_check with identical schema, user_version, per-table row counts and content digests. Services stay running; no application initialization or source repair. Backup/restore directories 0700 and files 0600.

Closed 2026-09-28: twelve stores / 116 physical tables restored with matching fingerprints, six native FTS checks and eight vector probes; private deployed tools; unchanged service PIDs/runs; green isolated CI and Claude Message 68 acceptance. See step11_sqlite/AUDIT_POST.md. Individual points only; parent 1.3 remains open.

> **1.2 — Goal:** Establish verified JetStream history recovery snapshots.
> **Needs:** Four distinct store directories and four configurations inventoried; offline R=1 directories intact; installed NATS CLI/server available; independent review of snapshot/restore sequence.
> **Feeds:** Node-readiness 1.3 and topology 1.4.
> **Verify:** runtime/code: Reachable streams snapshot/restore on isolated loopback servers; stopped-server copies preserve all four stores including unavailable R=1 streams. Restored counts, messages and last sequences match captured originals, with explicit treatment of expiring health streams. No isolated server routes to production; histories remain separate.

In flight 2026-09-28 21:33 EDT: offline member-1 master/restore and eleven online archives accepted; revised owned recovery/admission tests pass after a retained refused run. Lifecycle prerequisite repairs are merged. Crash recovery did not close this step. Durable intent and account-group observations now have owned fault/election evidence. A managed driver with real stop gates, the three healthy cold masters, their isolated restores and truthful service resumption are still required. Full-baseline restoration, a shared node lock/unresolved fence and an immutable sealing mechanism now have owned evidence. The detached managed driver, actual unit/process identity bindings, real stop controls and degraded-history resolution procedure remain pending. A fixed persistent parent, complete explicit inventory and recoverable receipts now have owned fault evidence; Claude review of the new patch is pending. See step12_jetstream/RUNTIME_EVIDENCE.md and D7–D10.

Third-round checkpoint 2026-09-28 23:49 EDT: Claude accepted bbbc883's eight fixes and lineage; exact CI36516935187 is green. Its new creation-interruption and static-identity findings have source/deployed53-test evidence. Setup now prepares the full receipt before mkdir and reopens restore-only; Finder metadata is explicit. Exact new CI/review and the managed driver/healthy cold masters remain pending. See D11.

Fourth-round checkpoint 2026-09-29 00:58 EDT: ab7097c exact CI36518928261
is green; Claude accepted N1/N2 and identified owned regular Finder metadata
inside an initializing root. tools-v31 passes55 fresh tests, old source fails
the added recovery regression, and invalid metadata remains fenced. Main
55131b8's verified readiness prerequisite is integrated before fresh CI. This
checkpoint remains1.2[A]/v1.2-pre; managed driver/cold masters still pending.
See D12 and FINDER_SETUP_EVIDENCE.json.

Managed-stop checkpoint 2026-09-29 01:11 EDT: tools-v33 passes six actual
owned Mac controls and eleven read-only owner bindings. The obsolete private
driver is retired without service operations. Source N3 checkpoint0b96e93
has green exact CI and Claude Message38 acceptance. Stop-adapter CI/review
and the complete detached production orchestration remain pending;1.2 stays[A].
See D13 and MANAGED_STOP_EVIDENCE.json.

Fixture checkpoint 2026-09-29 01:21 EDT: tools-v36 passes the complete owned
recovery suite after tightening its placement cohort gate; an actual missing
member refuses. Prior f3bb44f CI failed before the Mac adapter ran; exact new
CI/review required.1.2 remains[A]; no production cold-copy acceptance.

> **1.3 — Goal:** Establish a coordinated application and bus recovery point.
> **Needs:** 1.1 and 1.2 recovery mechanisms verified; all writers and their service ownership identified; inventory ENOENT robustness addressed; primary/derived file sources, configs and browser-profile policy enumerated; quiescence/restart sequence independently challenged.
> **Feeds:** Node-readiness 1.3, then topology repair 1.4.
> **Verify:** runtime/code: With application and bus writers quiesced, take one final application/JetStream recovery set, including or explicitly excluding each non-SQLite canonical source; record its common quiet window, cursor/consumer states and hashes. Prove isolated recovery while keeping original owners/configuration/history intact; all services resume their prior state. Do not resume task execution from a mismatched set.
