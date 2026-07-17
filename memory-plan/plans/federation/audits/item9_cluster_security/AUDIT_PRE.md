# AUDIT_PRE — item 9: multi-machine cluster security (closes D12 §3 / review finding #4)

**Written:** 2026-07-17, before the code.

## The violation (recorded in D12 §3, not yet fixed)

`services/nats/nats-cluster-node.conf` binds `0.0.0.0` on client/monitor/CLUSTER ports with the
cluster port UNAUTHENTICATED — against D2/D4's explicit "never all-interfaces; bind the Tailscale
interface." Mitigation was a comment. On a roaming laptop this exposes JetStream (memory events
included) and a task-execution channel to any network peer that can reach 6222. The auth was
dropped when NATS rejected the *token* form for cluster blocks — the user/password form NATS DOES
support was never tried.

## Fix design

1. **Template**: `listen: ${OPENCLAW_NATS_BIND_ADDR}:4222` and
   `cluster.listen: ${OPENCLAW_NATS_BIND_ADDR}:6222` — the machine's OWN tailnet address, never
   0.0.0.0. Monitor moves to `127.0.0.1:8222` (peers never need it). Cluster block gains
   `authorization { user: "openclaw-route", password: ${OPENCLAW_NATS_CLUSTER_PASS} }`; routes
   carry credentials (`nats-route://user:pass@peer:6222`).
2. **lib/nats-cluster-config.js**: `peerToRoute`/`renderClusterRoutes` accept `{user, pass}` and
   embed credentials in route URLs. Unit-tested.
3. **install.sh**: `--cluster-peers=` now REQUIRES `--cluster-bind=<own-ip>` (auto-detected from
   `tailscale ip -4` when available, loudly logged; hard error if neither). Generates + persists
   `OPENCLAW_NATS_CLUSTER_PASS` (openssl rand, shared across the council like the client token) and
   rewrites `OPENCLAW_NATS=nats://<bind>:4222` so every local consumer targets the bound address.
4. **Docs**: MULTI_NODE_DEPLOY §2.2 — bind flag + which secrets to copy to each machine.
5. **DECISIONS**: D12 §3 closure appended (violation fixed; D2/D4 conformance restored).

## Verification (live, one box — the mechanism, not the topology)

Render two configs binding 127.0.0.1 on scratch ports with the SAME cluster credentials → servers
form an authed cluster (routes connect, jsz meta shows 2). Then start a third with a WRONG cluster
password → its route is REJECTED (auth error in logs, cluster stays size 2). That is the security
property itself, observed. Real multi-machine formation remains hardware-gated (T7).

---

# AUDIT_POST (appended) — 2026-07-17

## Delivered

- Template: binds `${OPENCLAW_NATS_BIND_ADDR}` (never 0.0.0.0), monitor loopback-only, cluster
  port authenticated (user `openclaw-route` + `${OPENCLAW_NATS_CLUSTER_PASS}`), routes credentialed.
- `nats-cluster-config.js`: `peerToRoute`/`renderClusterRoutes` embed route credentials (7/7 tests
  incl. the credential case + legacy no-cred form unchanged).
- install.sh: `--cluster-bind=` (tailscale auto-detect; HARD ERROR rather than 0.0.0.0),
  generates/persists `OPENCLAW_NATS_CLUSTER_PASS`, rewrites `OPENCLAW_NATS` to the bound address.
- Docs (MULTI_NODE_DEPLOY §2.2) + openclaw.env.example; DECISIONS D12 §3 closure appended.

## Live proof (the security property itself, one box, scratch ports — drill-output.txt)

- n1+n2 with the CORRECT shared password: authed cluster **formed** — routez shows n2 connected,
  `jsz meta_cluster {cluster_size: 2, leader: n1}`.
- n3 with a WRONG password routing at n1: **`authentication error - User "openclaw-route"` →
  `Router connection closed: Authentication Failure`** — rejected; cluster stayed size 2.
- Scratch servers torn down; the live production bus untouched throughout.

## Honest limits
- Real multi-machine formation + failover remain hardware-gated (operator T7) — this proves the
  auth/bind mechanism, not cross-machine topology.
- The localhost DEV cluster (nats-{1,2,3}.conf) intentionally keeps loopback binds + tokenless
  routes — loopback is unreachable off-box, which is D2-conformant for the dev sim.
