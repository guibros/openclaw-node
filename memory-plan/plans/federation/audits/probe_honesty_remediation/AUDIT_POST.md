# AUDIT_POST — probe honesty remediation

**Written:** 2026-07-16T11:35Z (PRE written 11:22Z, **before** the code — the gap is real this time).
**Result:** P0-1, P1-2, P1-3, P1-4 FIXED and each **observed against the live cluster**. P2-5
(security) NOT fixed — deferred, recorded in DECISIONS D12. **Step 6.3 REOPENED to [A]** (it was
closed on inference).

## P0-1 · Quorum loss is now detectable — PROVEN by inducing a real outage

**Fix:** `gradeClusterQuorum` re-grounded on the authoritative raft signal `jsz.meta_cluster`
(`cluster_size` + `leader`). Raft elects a leader only while a majority is reachable, so `leader` IS
the quorum test. Both callers (node-watch `fed.cluster.quorum`, acceptance `FED-L2-QUORUM`) now read
jsz and no longer touch varz at all. `jsz` unparseable ⇒ **UNKNOWN**, never green.

**Why the old code was unfixable-by-arithmetic:** `connect_urls` includes the local server (verified:
`["127.0.0.1:4222","127.0.0.1:4223","127.0.0.1:4224"]` from nats-1, whose own client port is 4222),
and it is gossip, not raft membership. `membersUp = 1 + min(routes, connect_urls.length)` counted
self twice ⇒ both peers dead still graded `WORKING "quorum held 2/3"`.

**Observed (the check 6.3/6.4 were closed without) — 11:28–11:31Z:**

| step | observation |
|---|---|
| before | `WORKING — R=3 quorum held — raft leader openclaw-nats-1` (3/3 up) |
| induce | `launchctl unload` nats-2 + nats-3 → **1 of 3 procs** |
| raft step-down | polled the survivor's `meta_cluster.leader`: held `openclaw-nats-1` through t+21s, went **`''` at ~t+24s** |
| **node-watch** | **`XX BROKEN  NATS bus quorum — R=3 quorum LOST — no raft leader elected (need 2/3)`**, HEALTH 25% |
| **acceptance** | **`FAIL  FED-L2-QUORUM — quorum LOST`** → **`GATE: REJECTED`** |
| restore | reloaded both units → 3/3, `WORKING — raft leader openclaw-nats-3` |

The old code, in that exact state, reported "quorum held 2/3, WORKING."

**Detection latency (honest characteristic, not a defect):** ~24s — raft's election timeout. For the
first ~24s after losing majority the survivor still advertises itself as leader and the probe reads
WORKING. Documented rather than hidden; a sub-24s claim would be false.

## P1-2 · The grappe WORKING branch is reachable again

Field mapping extracted to a pure exported `toMemberHealth(rows)` **so the layer that failed is
testable**, and fixed to read what the publisher actually writes: `nodeId` + `reportedAt` (it read
`node_id`/`timestamp`/`updated_at` — fields no writer produces, so every member had no `seenAt` ⇒
stale ⇒ BROKEN was the only reachable verdict for any live grappe).

**Limit — stated, not papered over:** verified by unit test against a **real captured heartbeat row**
(`{nodeId:'moltymacs-virtual-machine', reportedAt:'2026-07-16T11:21:12.758Z'}`, pulled from the live
bucket), NOT against a live grappe — no grappe exists on this box (publishers dead since 07-10). The
WORKING branch is proven reachable in principle; a live-grappe observation is still owed.

## P1-3 · The "read-only" watcher no longer mutates state — observed

`readKvAll` now opens with `bindOnly: true`; absent bucket ⇒ `[]` ⇒ OFF (never creates).
**Observed:** streams before probe = 7, after = 7, **created = NONE**. (Plain `views.kv(name)` creates
the bucket — the likely reason `GRAPPE_REGISTRY` reappeared empty.)

## P1-4 · Unobservable grades UNKNOWN, not green — observed

Under the induced quorum loss the KV-backed probes reported **`?? UNKNOWN  Grappe member heartbeats`**
and **`?? UNKNOWN  Collab session liveness`** ("unreadable") rather than degrading to a green
single-node reading. fed-probes' own header rule now holds under real failure.

## Runtime drift closed — the probes actually run now

The live watcher (PID 782) started **Jul 14 19:41**, ~23h before the probe code existed, and had
never loaded it: the live report contained **0 federation lines**. (`workspace/lib` and
`workspace/bin/node-watch.mjs` are symlinks to the repo, so the code was deployed — the long-running
process simply held the old modules.) Restarted the unit; the live report at **11:32:00Z (`Mode:
watch`)** now carries all four federation rows, including
`:8222/jsz meta_cluster — raft leader elected ⇒ majority reachable`.

## Tests — rewritten to exercise the layer that failed

The old tests fed `gradeClusterQuorum` synthetic `{clusterSize, membersUp}`; they never touched the
varz parse that produced those numbers, so they stayed green while the live path lied. Now:
- fed-probes: real `meta_cluster` fixtures captured verbatim from the live cluster; a **REGRESSION**
  test asserts a leaderless R=3 group MUST grade BROKEN; `toMemberHealth` tested with the real
  heartbeat row; unparseable jsz ⇒ UNKNOWN.
- fed-acceptance: the probe's **parse + grade** driven together via mock ctx with real jsz bodies —
  leaderless ⇒ FAIL, unparseable ⇒ SKIP (never PASS).
- **21/21 pass.**

## Not done (recorded, not silently dropped)

- **P2-5 security**: `services/nats/nats-cluster-node.conf` still binds `0.0.0.0` with an
  unauthenticated cluster port, against D2/D4. Correct fix (bind the node's own tailscale address +
  cluster user/password) needs `nats-cluster-config.js` route credentials + install changes — a
  coherent batch of its own, and the template is deployed nowhere (no second machine exists), so it
  is not currently exploitable. **Must land before any second machine joins.** See D12.
- A live-grappe member-kill (6.3's literal contract) — the substrate is cold; forming a grappe first
  is its own task.
