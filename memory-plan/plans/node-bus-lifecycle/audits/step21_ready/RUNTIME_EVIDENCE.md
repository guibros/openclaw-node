# Task readiness — owned evidence

At 2026-09-28 23:28:42 EDT, a preconnected, flushed client made mesh.tasks.list
in the real daemon stdout ready callback, without retry or delay. Both code
copies were private archives of dad1e7b; candidate adds only await nc.flush()
immediately before ready. One authenticated, isolated loopback NATS2.12.6
server served empty owned stores and per-start isolated HOME/identity.

- Unpatched:66/100 no-responders503;34/100 successful; no other errors.
- Candidate:100/100 successful; no other errors.
- All200 daemons and the owned server stopped normally; each former daemon
  connection was absent before the next start. Cleanup failures:0.

OWNED_STARTUP.json is the sanitized result. Private evidence lives under
~/.openclaw/backups/node-readiness/task-ready-20260928-1/. No production
service, bus policy or task changed.

The focused three-test fixture uses real daemon/server connections and sends
its request at ready without retry. A daemon-only preloader wraps the real
NatsConnectionImpl.connect and final nc.flush: it first awaits the actual
flush, then holds its return. No ready is permitted during that hold; release
permits ready and the immediate RPC. A separate injected rejection after
real flush requires exit1 and no ready. These tests verify control-flow
ordering/failure semantics, not a wire-delay or real-server-loss scenario.

The first fixture run failed two controls because its preloader inferred
the NATS internal module path from index.js incorrectly; the normal startup
control passed. Resolving relative to nats/package.json corrected the fixture.
All3 then passed on actualNode24.13.0,3.954s, normal owned cleanup.
The same final-flush controls fail on the unpatched real dad1e7b source:
held-return publishes ready before the barrier; injected failure publishes
ready and stays alive until the test deadline. Both owned controls clean up
without force. Private unpatched-barrier-control.json/log retain that run.
Latest isolated full CI, independent exact-source review and managed
cumulative-release deployment remain pending. Step2.1[A]/v2.1-pre.
