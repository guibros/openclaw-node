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

## Final fixture correction and deployed rerun

2026-09-28 09:17:45 EDT: tools-v4 ran the complete fixture successfully from the
private runtime backup directory. It adds explicit state/config comparisons,
consumer-position checks after cold clone boot and idle waiting, hole digest
sensitivity, binary provenance and bounded health expiry. The copied directory's
parent is fsynced too. All owned servers stopped before publishing acceptance.

- recovery.mjs: 18a956bfcb483256ec93a3d2a95657993a243a45711ed4d531a297808ea11dfe
- test_recovery.mjs: 9d46f283e65667fe5eeea42da447a757d9d8bb6b6eacc597a6049291611c2d76
- take_snapshots.mjs: 067c538f2bc0ca3a8971bc84db270b00c2de31c8a796d93a762674afeaa36e8a
- CLI real path: /opt/homebrew/Cellar/nats/0.3.1/bin/nats;
  SHA256 6be41e7097aac6278c3b9e4f394fc1536996608e921aa14fceae1bf0e800da0f
- Server real path: /opt/homebrew/Cellar/nats-server/2.12.6/bin/nats-server;
  SHA256 c3a71e72f6fc5dd008988f34b57fd2ab1fe69ab18d409f0a0aeebc51160e76e1
- Fixture root: openclaw-jetstream-fixture-V2OvXG under the private macOS temp root;
  ten-message digest 20b9cf54d1bc5e2e390986dd4b6ea4dd515a0f5b17f7089a8033b43535e847b5.

The expiry fixture initially queried before the restored timer had aged out the
old health point. A bounded three-second poll now requires the expected empty
state; it does not alter TTL or restore timestamps. Readiness waits require an
actual known metadata leader rather than the truthy unknown sentinel. No source
history or production service was touched by these fixture corrections.

## Independent challenge and actual online restores

2026-09-28 09:40 EDT: Claude Messages 74/76 passed the pinned Linux fixture,
independently exercised the offline driver and demonstrated assignment deletion
wiping an unprotected R1 working copy on rejoin. D6/runbook now require durable
member-1 disable, assignment preservation and exact MC scheduler restart gates.
No live unit has been stopped yet. MC status is scheduled at/cron=0/0, ready=0,
running=3, overdue=0; the exact dispatchable and dependency-eligible sets are both
empty. Running owners are null/null/Gui; no rows were edited.

Actual online archives were taken 09:24:13–09:24:16 EDT into separate private
standalone-online and cluster-online directories. Eleven reachable stream
archives restored on two isolated empty loopback servers at online-restore-3.
80,156 non-expiring messages, detailed sequence/deletion state, exact configs
against matching source queries and durable consumer positions match. Original
health TTLs apply; expired points remain expired. R3-to-R1 affects only the
isolated OPENCLAW_SHARED restore. Masters unchanged and both owned servers
stopped gracefully before acceptance. This is not a common recovery point.

Earlier isolated attempts refused on serializer/query representation differences
and are retained. backup.json omits zero defaults and server metadata; restored
config matches the full live before/after config exactly apart from the recorded
replica override. Detailed STREAM.INFO reports a sequence-zero deleted marker on
a never-used empty stream; backup.json's non-detailed state omits it. Identical
API options agree. No production configuration or payload was changed.

The final deployed tools-v8 with spaces fixture passed at 09:40:34 EDT, root
openclaw-jetstream-fixture-zaASTh. It adds holes/deleted-list negative control,
empty-directory detection, paths with spaces, KV revision/delete/purge/TTL round
trip, empty R3 restore, exact non-default stream/consumer config, offline driver
and assignment-deletion refusal. All owned servers stopped. Bounded source TTL
polling removed an immediate-expiry test assumption without changing TTL.
