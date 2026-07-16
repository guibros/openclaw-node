# AUDIT_PRE — probe honesty remediation (P0/P1 from the 2026-07-16 deep review)

**Written:** 2026-07-16T11:22Z — **before** the code changes (unlike the 07-15 PREs, which were
written in the same minute as their POSTs and were therefore set dressing, not pre-audits).

**Trigger:** the 2026-07-16 deep review. These findings are mine, from steps 6.3/6.4/1.5.

## Pre-state — verified against the live box, not assumed (11:21Z)

### P0-1 · The quorum probe cannot detect quorum loss (inverts 6.4's headline)

- `lib/fed-probes.mjs` `gradeClusterQuorum` takes `{jszReachable, clusterSize, membersUp}`;
  callers compute `membersUp = 1 + Math.min(routes, connect_urls.length)`
  ([node-watch.mjs](lib/node-watch.mjs) fed.cluster.quorum, [node-acceptance-probes.mjs](lib/node-acceptance-probes.mjs) FED-L2-QUORUM).
- **Observed:** `:8222/varz` → `connect_urls = ["127.0.0.1:4222","127.0.0.1:4223","127.0.0.1:4224"]`
  where **4222 is this server's own client port**. `connect_urls` already includes self; the `1 +`
  counts self a second time.
- **Consequence (arithmetic on the live values):** both peers dead → `connect_urls` collapses to
  self (1) → `membersUp = 1 + min(2,1) = 2`, `needed = 2` → **WORKING, "quorum held 2/3"** while
  exactly ONE node is up. Quorum loss is structurally undetectable. 6.4 fixed the `.body`→`.json`
  read (real) and then shipped a formula that re-broke the thing it claimed to fix.
- **The authoritative signal was fetched and discarded.** `:8222/jsz` → `meta_cluster` =
  `{name, leader:"openclaw-nats-3", peer, cluster_size:3, pending}`. **Raft only elects a leader when
  a majority is present — `leader` IS the quorum signal.** `connect_urls` is gossip, not raft.
- **Why the test didn't catch it:** `test/fed-probes.test.mjs` feeds `gradeClusterQuorum` synthetic
  `{clusterSize, membersUp}` directly. It exercises the grader, never the varz parse that produces
  those numbers — so it stayed green while the real path lied. Green wired to nothing.

### P1-2 · `fed.grappe.members` WORKING branch is unreachable against production data

- `probeGrappeMembers` reads `h.value?.node_id` and `h.value?.timestamp || h.value?.updated_at`.
- **Observed** MESH_NODE_HEALTH value fields: `nodeId`, …, **`reportedAt`** (`2026-07-16T11:21:12.758Z`).
  No `node_id`, no `timestamp`, no `updated_at`.
- **Consequence:** `ts` is always undefined → `memberHealth` stays empty → every member reads
  `seenAt == null` → stale → **BROKEN is the only reachable verdict for any live grappe.**
  (`node_id` accidentally survives via the `|| h.key` fallback.) Written from assumption; never
  checked against a real heartbeat.

### P1-3 · The "read-only" watcher mutates state

- `readKvAll` calls `nc.jetstream().views.kv(bucket)` with no `bindOnly` — `views.kv` **creates** the
  bucket when absent. A watcher probe has a write side effect; plausibly why `GRAPPE_REGISTRY`
  reappeared empty.

### P1-4 · Unobservable topology grades green

- varz/jsz parse failure silently degrades to `clusterSize=1` → "single-node bus up" **WORKING** —
  the same defect class as the `.body` bug, violating fed-probes' own header rule ("UNKNOWN when
  unobservable; never green without evidence").

### P2-5 · Security: `services/nats/nats-cluster-node.conf` binds `0.0.0.0` with no cluster auth

- D2/D4 record "never all-interfaces; bind the Tailscale interface." The template binds `0.0.0.0` on
  client/monitor/**cluster**, cluster port unauthenticated, mitigated by a comment. I dropped cluster
  auth when NATS rejected the *token* form instead of using user/password, which NATS does support.
  No superseding DECISIONS entry (D10 requires one).

## Plan

1. Re-ground `gradeClusterQuorum` on `meta_cluster` (`cluster_size` + `leader`): no meta/size≤1 →
   single-node WORKING; size≥2 + leader → WORKING; size≥2 + **no leader → BROKEN (quorum lost)`;
   jsz unreachable/unparseable → **UNKNOWN**, not green.
2. Fix `probeGrappeMembers` to read `reportedAt`/`nodeId` (keep tolerant fallbacks).
3. `bindOnly: true` on probe KV opens; absent bucket → OFF/UNKNOWN, never create.
4. **Tests must exercise the PARSE against real captured shapes** (the live varz/jsz/health JSON
   above), not synthetic grader inputs — the failure mode that let P0-1 ship.
5. Cluster template: bind the node's own address (not `0.0.0.0`) + cluster user/password; DECISIONS
   entry for the deviation.
6. **Restart node-watch** so the probe code actually runs live (it has never loaded — the watcher
   predates the probes by ~23h), then **observe a real quorum loss** (kill 2 of 3 nats nodes, watch
   it flip BROKEN, restore). That is the observation 6.3/6.4 were closed without.

## Contract for this batch (no inference closes)

Nothing here gets marked done on reasoning. Each fix needs an observed runtime flip against the live
cluster, or it stays open. `Runtime-Evidence:` trailer on the commit. COMPONENT_REGISTRY updated
(it is in this batch's file list — the 07-15 batches omitted it, so the hook would have blocked it).
