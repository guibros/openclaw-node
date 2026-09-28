# Node readiness — roadmap

The operator's 2026-09-27 request is a one-command, frontend-neutral node with autonomous durable memory, a structured harness, monitoring/control and real multi-node dynamic plans.

## Block 1 — Working local substrate
Repair startup and persisted-state recoverability before topology changes. Exit: gateway and dashboard respond; backups restore; one intentional bus topology survives restart; runtime revision is identifiable.

## Block 2 — Reproducibility and execution boundaries
Make test isolation, installation, upgrade/rollback and authorization reliable. Exit: clean macOS/Linux installs pass declared acceptance; no tests touch production; unauthorized execution fails closed.

## Block 3 — Autonomous memory
Prove capture, recoverable extraction and audience-correct retrieval for each declared frontend. Exit: controlled fresh sessions yield traceable memories recalled after restart, with measured quality and preserved original history.

## Block 4 — Harness and control
Prove the harness and dashboard operate the same durable task state. Exit: create, start, observe, cancel and independently verify a bounded task, with truthful failures. Foreman remains shadow until its own acceptance passes.

## Block 5 — Real cluster
Two distinct trusted machines execute a changing dependency plan. Exit: outage/rejoin produces no duplicate owner or lost result and the dashboard agrees. Three processes on one host are not this evidence.

## Block 6 — Release
Reconcile GitHub, package provenance and product claims with evidence. Exit: released revision installs/upgrades, required CI passes and instructions accurately describe support and limitations.
