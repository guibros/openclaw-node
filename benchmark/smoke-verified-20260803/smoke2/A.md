`node --version` exits 0 (v24.13.0). Verification passed.

The updated `startup-contract.txt` now covers all five required topics, grounded in `bin/mesh-agent.js` with explicit line citations:

- **NATS connection** — `natsConnectOpts()`, 5 s timeout, 10 reconnect attempts at 2 s each (lines 1755-1762)
- **Alive subject** — `mesh.agent.<NODE_ID>.alive` subscribed at line 1781; request/reply for daemon stall detection
- **Collab recruiting** — `mesh.collab.*.recruit` subscribed at line 1799; idle agents join, busy agents skip
- **Task polling** — `MESH_POLL_INTERVAL` = 15 000 ms (line 54); requests `mesh.tasks.claim` each cycle
- **Heartbeat cadence** — `MESH_HEARTBEAT_INTERVAL` = 60 000 ms (line 56); publishes `mesh.tasks.heartbeat` (line 691)
- **Worktree isolation** — fail-closed: worktree required before LLM invocation (lines 1481-1491); no shared-workspace fallback
