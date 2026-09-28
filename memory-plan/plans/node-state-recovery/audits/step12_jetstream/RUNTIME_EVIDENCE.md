# Step 1.2 — Runtime evidence (in flight)

2026-09-28 09:16 EDT. No production NATS unit has been stopped, no physical
production store copied, and no topology/configuration changed at this point.

## Deployed mechanism

The source tools were copied privately to
`~/.openclaw/backups/node-readiness/jetstream-20260928-1/tools-v2/` and executed
there with installed Node 24.13.0, NATS CLI 0.3.1 and server 2.12.6. SHA256:

- recovery.mjs: 6b9f9c81d10ede1a4cf3a12dbc5170fa071110c61b01804a32ea50374b41e370
- test_recovery.mjs: 25f44e0a302d88b74df81bca2d72850379227145d37fbc6451fa705eec332163
- take_snapshots.mjs: 067c538f2bc0ca3a8971bc84db270b00c2de31c8a796d93a762674afeaa36e8a

The deployed test creates only owned scratch servers. Observed successful run:
`/var/folders/52/24gckfjn2vd3yyz5smhmwhx00000gn/T/openclaw-jetstream-fixture-4kk2O0/acceptance.json`.
All owned servers stopped gracefully before the final success report.

- Ten binary records restore with holes 3/8, duplicate headers and exact timestamps.
- Message digest 779cd996a56cd7cc1d5a62e9aee822eeb59e2fa9741a73ebfcbcdbfde71d26aa.
- Changed subject/nanosecond timestamp/raw headers/payload independently change
  the digest; both durable consumer positions match; unacked sequence redelivers.
- Health TTL expires: zero messages, last sequence 1. No revived liveness claim.
- Snapshot driver runs against the owned source and produces checked manifests.
- Stopped standalone working copy recovers matching contents; master unchanged.
- R3 snapshot restores to isolated R1 using the explicit replicas flag.
- Offline R1 seven-message history restores in a remapped three-member clone;
  master hashes unchanged; peer IDs/loopback boundaries pass.
- Unexpected peer allowlist is rejected. An offline member's separate working
  store also reads correctly without cluster routing on this installed version.

Initial fixture failures were test timing/readiness assumptions, then an actual
upstream CLI --config bug. They are preserved privately; the final driver uses
--replicas only. No production replica override or software upgrade occurred.

## Read-only production preflight

At 09:12 EDT: mesh agent alive=false/task_id=null; no child executor under it or
the task daemon; 395/397 task subjects are tombstones, other two failed/completed;
221/227 collaboration subjects are tombstones, other six aborted/completed.
All enumerated standalone consumers have ack-pending 0. These are observations,
not a drain lock; reverify immediately before any shutdown.

MC has three local, unlinked running rows last updated 2026-03-05, and no mesh
node/task link. No row was changed. Their owner provenance needs independent
challenge before interpreting the stale statuses as idle execution.

At 09:15 EDT standalone has six clients, no routes/leaves. Members 2/3 have no
clients and only local peer routes. Member 1 fails at monitoring bind on 8222,
before JetStream. Private preflight-owners.json and idle-preflight.json record
actual evidence. Quiescence, all four production masters, isolated production
restores and service resumption are outstanding. VERSION remains v1.2-pre;
child 1.3 and parent node-readiness 1.3 remain open.
