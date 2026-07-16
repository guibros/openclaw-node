# AUDIT_POST — step 1.5 (multi-machine cluster: deployability enabler)

**Scope of THIS work:** make a real cross-MACHINE NATS cluster *deployable* — the config
generation + install path the documented multi-machine design (MULTI_NODE_DEPLOY.md Part 2)
described but never automated. Row 1.5 stays **[D]**: the actual live cutover, "retire single-node,"
and — critically — proving failover are the operator's, on real hardware.

## The gap this closes

The whole NATS cluster was a single-machine dev simulation: `nats-{1,2,3}.conf` hardcode
`127.0.0.1` for listen + cluster + peer routes. Three procs on ONE box replicate to each other —
if that machine dies, all copies die. It **structurally cannot span machines** (loopback bind =
unreachable by peers; routes point at itself). The multi-machine design was doc-only, done by hand.

## What shipped (config side — testable without real machines)

- **`lib/nats-cluster-config.js`** (CJS, consumed by both the CJS daemon and ESM libs) — pure
  helpers: `parsePeers`, `peerToRoute`, `renderClusterRoutes` (peers → `nats-route://…` block),
  `replicasForPeers` (self+peers, capped 3), `clampReplicas`, `resolveKvReplicas` (env-driven).
- **`test/nats-cluster-config.test.mjs`** — 6 tests, every branch (solo→1, 3-node→3, cap, ipv6, etc.).
- **`services/nats/nats-cluster-node.conf`** — parameterized template: `0.0.0.0` binds (peers can
  reach it), `${…SERVER_NAME}`, `${…CLUSTER_ROUTES}`, token client-auth. No cluster-route token
  (NATS rejects it — caught by the nats-server config check); tailnet gates route access.
- **`install.sh --cluster-peers=<ip>,<ip>`** — renders THIS machine's `nats.conf` (routes → peers,
  0.0.0.0 binds) replacing the single-node default, and writes `OPENCLAW_KV_REPLICAS` from council
  size. **Additive + guarded**: no flag → single-node default path untouched.
- **`docs/MULTI_NODE_DEPLOY.md`** §2.2 — leads with the automated command; notes the boot ordering
  (all nats-server up BEFORE daemons, so R=3 streams can form). **`openclaw.env.example`** documents
  `OPENCLAW_KV_REPLICAS`.

## Evidence (observed 2026-07-15)

- `node --test test/nats-cluster-config.test.mjs` → 6/6.
- `bash -n install.sh` OK; `--help` lists `--cluster-peers`.
- The exact install render invocation, run for machines alpha/bravo/charlie with 2 peers each →
  valid config every time (`nats-server --config … -t` → "configuration file is valid"), routes to
  both peers, `OPENCLAW_KV_REPLICAS=3`. The token-in-cluster-auth bug was caught by that same check
  and fixed.
- Earlier this session: the 5 live mesh KV buckets migrated R=1→R=3 on the running (single-machine)
  cluster, message counts preserved — proves the replication mechanism; does NOT prove machine-loss
  failover (all 3 procs are on one VM).

## Honest limits (NOT done here — do not read as failover-proven)

1. **Real failover is unproven.** I have one machine. Three localhost procs surviving a killed proc
   is not a machine dying. Proving "lose a machine, lose 1 of 3 copies" needs ≥2 real machines
   (operator T7). This is the substance of the 1.5 [D] gate.
2. **Runtime replica-at-create wiring is DEFERRED** (reverted this turn, out of scope): making
   `ensureSharedStream` + the daemon KV buckets create at `OPENCLAW_KV_REPLICAS` is coupled to a
   `process.exit(1)` verify path (memory-daemon.mjs:1457) and a first-node-boots-alone ordering
   problem (can't create R=3 with 1 member up). Getting that right safely needs the real
   multi-machine boot sequence to validate — rushing it risks crash-looping the daemon. The install
   now records the target (`OPENCLAW_KV_REPLICAS`); wiring it into stream creation is the follow-up.
   Meanwhile the existing hardcoded-R=3 shared stream + the manual/live KV migration cover the
   already-formed cluster.
3. **Single-machine dev cluster** (`nats-{1,2,3}.conf`) is unchanged and still valid for local dev.

## Follow-ups (queued, need real machines / careful sequencing)

- Runtime `resolveKvReplicas()` wiring into `ensureSharedStream` + daemon bucket creation, with the
  boot-ordering handled (form cluster → then create R=3), validated on real machines.
- A post-formation `openclaw-cluster-replicate` provisioning command (productize this session's live
  migration) so buckets go R=3 AFTER the cluster is up — sidesteps the create-time ordering problem.
- Operator T7 on real hardware: 3 machines, `--cluster-peers` each, kill one, prove survival.
