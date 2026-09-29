# node-bus-lifecycle — Roadmap

**Goal:** make deliberate idle mesh-client shutdown complete normally.
**Created:** 2026-09-28 10:05 America/Montreal.

## Block 1 — Planned mesh-client drains

- **Intent:** distinguish a requested shutdown from unexpected permanent NATS loss in the existing task daemon, bridge and worker; each service has its own atomic step.
- **Exit criterion (runtime-observable):** the deployed idle daemon emits `Shutdown complete.` on SIGTERM, exits 0, then resumes under its managed unit. Each service’s owned-process negative control still exits 1 after unexpected permanent NATS loss. The separate 1.4 follow-up rejects task-daemon false completion or silent success when bus loss overlaps requested drain. The bridge and worker must emit their own completion lines before a preservation retry.
- **Unblocks:** node-state-recovery 1.2's guarded preservation window. This is not a general guarantee for arbitrary in-flight async handlers.

## Block 2 — Verifiable service readiness

- **Intent:** each readiness declaration must follow the operation that makes the service available to clients.
- **Exit criterion:** the real task daemon registers its request subscriptions before publishing ready, with owned timing controls and a narrow managed deployment.
- **Unblocks:** preservation restoration checks and root lifecycle CI. This does not establish active-handler draining or repair worker boot policy.
