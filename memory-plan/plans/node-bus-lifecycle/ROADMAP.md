# node-bus-lifecycle — Roadmap

**Goal:** make deliberate task-daemon shutdown complete normally.
**Created:** 2026-09-28 10:05 America/Montreal.

## Block 1 — Planned task-daemon drain

- **Intent:** distinguish a requested shutdown from unexpected permanent NATS loss in the existing daemon.
- **Exit criterion (runtime-observable):** the deployed idle daemon emits `Shutdown complete.` on SIGTERM, exits 0, then resumes under its managed unit. The owned-process negative control still exits 1 after unexpected permanent NATS loss.
- **Unblocks:** node-state-recovery 1.2's guarded preservation window. This is not a general guarantee for arbitrary in-flight async handlers.
