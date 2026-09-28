# Node state recovery — roadmap

This supporting plan feeds node-readiness 1.3. Its data preservation is independent of the viewer's pending browser gate. It runs interactively in a separate checkout; both chains stay unloaded.

## Block 1 — Recoverable histories

- **Intent:** Preserve persisted application histories before topology or storage repair.
- **Exit criterion:** SQLite snapshots and both distinct JetStream histories restore in isolation with matching integrity and content/stream evidence.
- **Unblocks:** Node-readiness 1.3, then topology 1.4 and capture 3.1.

SQLite and JetStream have separate recovery-mechanism steps, followed by a coordinated recovery-point step that establishes their coupled consistency. No migration or history union is part of this plan. Browser vendor caches are outside its application-store inventory.
