# Step 1.2 — JetStream history recovery

## 0 — Micro Re-Orient
- Block 1 preserves histories before topology/storage repair.
- Step 1.1 delivered twelve verified per-store SQLite snapshots, merged PR #143.
- This step proves both split JetStream histories recover, including offline R1.
- It serves local-first durable memory and trustworthy optional federation.
- Yes: histories must survive before competing listeners are repaired.

## 1 — Needs and current evidence
Four distinct directories/configs were inventoried 2026-09-28 08:37 EDT.
Standalone has seven streams; cluster has six, two unavailable R1 on member 1.
Installed CLI 0.3.1 and server 2.12.6 are available. Claude Message 70 supplied
independent challenge before any service stop. Actual live units all name
/opt/homebrew/bin/nats-server, unlike template differences. At 08:56 EDT the
member-1 fatal line is monitor 8222 already in use: recovery has not opened its
store on that attempt. No prior stopped copy or topology change is claimed.

## 2 — Design
Use installed official CLI snapshots with consumers; never create ordered
consumers on production for digesting. Verify raw sequence, subject, exact
server timestamp, headers and payload via read-only message-get APIs on isolated
restores. Record snapshot metadata and consumer delivered/ack/pending state.
Owned fixtures cover deleted holes, binary payload/duplicate headers, pending
acks, TTL expiry, R1 offline-member recovery and route confinement.

After fixtures: boot out failing member 1, verify no owner, copy/fsync/hash its
intact store and config privately. Persistently disable it and verify print-disabled (D6). Take reachable online
CLI snapshots. Before the other cold copies, prove idle executors/leases, all
consumer ack-pending zero, all clients/timers quiesced and connz empty; stop
members 2/3 before standalone. Copy only after verified exit/clean shutdown.
Resume standalone and verify both 4222/8222 plus JetStream ready, then members
2/3, then original client/timer set. Never resume member 1 into contested ports.

All recovered servers use working copies; immutable private masters are never
opened. Generate configs with original names/global account, sufficient limits,
fresh unique loopback client/monitor/route ports, route credentials and
no_advertise. Verify routez/leafz/gatewayz and actual listeners. Start clone 2/3,
verify COLLAB/PLANS assignments, then clone 1; preserve offline originals even
if catch-up would discard a working copy. Snapshots restore into distinct empty
servers, never an existing-history clone. Record any R3->R1 isolated override.
Compare snapshot restore to cold clone at snapshot high-water mark, accounting
for retention changes explicitly; mismatch refuses acceptance. Health TTL
expiry is expected and separately recorded, never called restored liveness.

## 3 — Risk register
- Client fallback can cross histories: resolve URLs, drain timers, stop cluster
  before standalone; no application workers on clones.
- Stop timeout can force a crash: record signal/exit/log evidence; label crash
  consistency and do not claim clean shutdown without evidence.
- Stale metadata can delete R1 copies: protected masters + assignment check.
- Snapshot state differs from later stream info: use backup metadata and compare
  isolated contents, not a count taken at another time.
- TTL/consumer inactivity/redelivery can change state: fixtures and explicit
  treatment; drained production consumers have zero pending acknowledgements.
- Copies remain on this disk: logical rollback, not machine-loss protection.

## 4 — Verification
Focused owned fixtures only locally; isolated CI retains the existing suite.
Actual snapshots restore to independent instances with matching non-expiring
message digests/sequences/holes and durable positions. All four cold copies
carry path/config/binary/hash provenance. Sanitize public proof, keep payloads
and tokens only in 0700 directories / 0600 files. Inspect deployed tools.
No topology repair, history union, requeue, source deletion or application
initialization. Parent coordinated recovery remains open.

## 5 — Runtime landing
Private tools and immutable/working backup sets under
~/.openclaw/backups/node-readiness/jetstream-20260928-<run>/, consumed by child
1.3 and topology 1.4. Both plan tick chains remain unloaded.

## 6 — File deltas
- This audit directory: official CLI wrapper, digest verifier, focused fixtures,
  operational runbook and pre/post/runtime evidence.
- Plan inventory/version/registry/decisions: current carrier and verified state.
- .github/workflows/test.yml: run isolated recovery fixtures with pinned tools.
- No production application source or NATS configuration change.

## Mid-Implementation Findings
Installed CLI 0.3.1 ignores `stream restore --config`: its restoreAction shadows
`cfg` inside the input-file branch (upstream cli/stream_command.go:1272), leaving
the outer override unset. The owned R3 fixture confirmed a config declaring R1
still fails with replicas>1 on a standalone server. Use the explicit `--replicas`
flag without --config; test it. No upstream fix or tool upgrade in this step.
Original health TTL remains intact; restored expired points are not liveness.
Source: https://github.com/nats-io/natscli/blob/v0.3.1/cli/stream_command.go#L1271

Claude Message 74 independently passed the pinned Linux fixture and actual
offline-driver path. Its operational blocker was the reboot race left by bootout:
D6 now requires a persistent reversible disable. The assignment deletion negative
case, deleted-list cross-check, empty-directory hashing and path decoding refine
the same preservation outcome. Production snapshot restore exposed the explicitly
listed serializer differences in RECOVERY.md; compare equivalent API queries,
never weaken policy or content checks to get a pass.
