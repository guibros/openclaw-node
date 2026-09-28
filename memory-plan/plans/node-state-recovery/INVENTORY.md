# Node state recovery — inventory

| Block | Step | Version | Status | Description |
|---|---|---|---|---|
| 1 | 1.1 | v1.1 | [x] | Establish verified application SQLite recovery snapshots |
| 1 | 1.2 | v1.2 | [ ] | Establish verified JetStream history recovery snapshots |
| 1 | 1.3 | v1.3 | [ ] | Establish a coordinated application and bus recovery point |

> **1.1 — Goal:** Establish verified application SQLite recovery snapshots.
> **Needs:** Twelve application stores enumerated; SQLite backup API and installed sqlite-vec available; private backup storage with sufficient space.
> **Feeds:** Node-readiness 1.3 and later storage/capture repair.
> **Verify:** runtime/code: Read-only source transactions feed SQLite's backup API; offline restores pass integrity_check with identical schema, user_version, per-table row counts and content digests. Services stay running; no application initialization or source repair. Backup/restore directories 0700 and files 0600.

Closed 2026-09-28: twelve stores / 116 physical tables restored with matching fingerprints, six native FTS checks and eight vector probes; private deployed tools; unchanged service PIDs/runs; green isolated CI and Claude Message 68 acceptance. See step11_sqlite/AUDIT_POST.md. Individual points only; parent 1.3 remains open.

> **1.2 — Goal:** Establish verified JetStream history recovery snapshots.
> **Needs:** Four stores and both configurations inventoried; offline R=1 histories preserved; independent review of snapshot/restore sequence.
> **Feeds:** Node-readiness 1.3 and topology 1.4.
> **Verify:** runtime/code: Reachable streams snapshot/restore on isolated loopback servers; stopped-server copies preserve all four stores including unavailable R=1 streams. Restored counts, messages and last sequences match captured originals, with explicit treatment of expiring health streams. No isolated server routes to production; histories remain separate.

> **1.3 — Goal:** Establish a coordinated application and bus recovery point.
> **Needs:** 1.1 and 1.2 recovery mechanisms verified; all writers and their service ownership identified; inventory ENOENT robustness addressed; primary/derived file sources, configs and browser-profile policy enumerated; quiescence/restart sequence independently challenged.
> **Feeds:** Node-readiness 1.3, then topology repair 1.4.
> **Verify:** runtime/code: With application and bus writers quiesced, take one final application/JetStream recovery set, including or explicitly excluding each non-SQLite canonical source; record its common quiet window, cursor/consumer states and hashes. Prove isolated recovery while keeping original owners/configuration/history intact; all services resume their prior state. Do not resume task execution from a mismatched set.
