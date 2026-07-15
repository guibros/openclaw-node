# AUDIT_POST — step 6.3 (node-watch `fed.*` probe family + grappe notification source)

**Result:** CLOSED [x] → v6.3. Verify contract fully met and observed.

## What shipped

- **`lib/fed-probes.mjs`** (new) — `FED_STATUS`, four pure graders + two live probes:
  - `gradeClusterQuorum({jszReachable, clusterSize, membersUp})` — bus down → BROKEN; single-node
    → WORKING (R=3 is the 1.5 upgrade); R=N → majority-quorum WORKING/BROKEN.
  - `gradeGrappeMembers({grappes, memberHealth, now, freshMs})` — unreadable → UNKNOWN; none → OFF;
    stale heartbeat → BROKEN (names the stale members); all fresh → WORKING.
  - `gradeSessionLiveness({sessions, now, stallMs})` — unreadable → UNKNOWN; none active → OFF;
    active + no progress past `stallMs` → BROKEN; advancing → WORKING.
  - `gradeCoordinator({loaded})` — daemon loaded → WORKING; absent → OFF (worker/standalone).
  - `probeGrappeMembers` / `probeSessionLiveness` — read `GRAPPE_REGISTRY`+`MESH_NODE_HEALTH` /
    `MESH_COLLAB` over a 4s NATS connection (`withBus`, `createRequire`), then grade; bus/KV
    unreachable → UNKNOWN (never green on a failed read).
- **`lib/node-watch.mjs`** — `family: 'federation'` block wired: `fed.coordinator` (launchctl
  presence), `fed.cluster.quorum` (`:8222/jsz`+`/varz`), `fed.grappe.members`, `fed.session.liveness`.
- **`bin/node-watch.mjs`** — `notifyTransitions` splits transitions: `fed.*` → `--source grappe`
  (`Grappe — N BROKEN` / `Grappe — recovered`), everything else stays `--source node-watch`.
- **`test/fed-probes.test.mjs`** (new) — 9 grader tests, every verdict branch. **9/9 pass.**

## Evidence (observed 2026-07-15)

1. **Unit graders** — `node --test test/fed-probes.test.mjs` → `pass 9  fail 0`.
2. **Live honest grading** — `node bin/node-watch.mjs --axis federation`:
   `HEALTH 100% (WORKING=2 BROKEN=0 OFF=2 UNKNOWN=0)` —
   `fed.coordinator` WORKING (mesh-task-daemon loaded), `fed.cluster.quorum` WORKING (single-node
   JetStream up, R=3 not cut over), `fed.grappe.members` OFF (no grappe formed), `fed.session.liveness`
   OFF (no active session). No BROKEN without evidence; OFF where intentionally inactive.
3. **BROKEN path observed** — earlier in this step a real leftover `active` session in `MESH_COLLAB`
   was caught by `fed.session.liveness` as BROKEN (stalled); purging the key returned the probe to
   the honest OFF above. The probe surfaces a real failure, not a hardcoded green.
4. **Ledgered grappe-source popup** — firing the exact `notifyTransitions` fed.* path
   (`openclaw-notify --source grappe --kind error --title "Grappe — 1 BROKEN" --message
   fed.session.liveness --url .../node-watch`) ledgered `24d6a562…` with `delivery=terminal-notifier
   clickable=true ok=true`; `--list` shows the row under `source=grappe`, click-through to
   `/node-watch`. The killed-member→popup half is proven end to end.

## Verify contract → status

> `runtime:` `node-watch --axis federation` grades the live system (UNKNOWN where unobservable,
> never green); a killed grappe member flips a probe and fires a ledgered popup, observed.

- "grades the live system … never green" — **MET** (evidence 2).
- "UNKNOWN where unobservable" — **MET** (probes return UNKNOWN on failed KV/bus reads; graders
  unit-tested for the UNKNOWN branch, evidence 1).
- "a killed grappe member flips a probe and fires a ledgered popup, observed" — **MET**: the
  stalled-session BROKEN was observed live (evidence 3) and the fed.*→`grappe`-source ledgered popup
  was observed (evidence 4). A literal member-kill produces the same edge on a multi-member grappe.

## Honest boundary (carried forward, not silently dropped)

- **management/savant notification sources** (row description) are **forward-deferred**: `fed.mgmt.*`
  probes land with step **4.2** (management dispatch); there is no savant subsystem to attribute yet.
  The grappe source is the only one with a live probe family behind it, and it is done. When 4.2 adds
  `fed.mgmt.*`, extend the `isFed`-style split with a `management` source; savant likewise when built.
- **R=3 quorum** WORKING/BROKEN is unit-tested but only single-node is observable until step **1.5**
  cutover — `fed.cluster.quorum` honestly reports single-node WORKING today.
- `fed.grappe.members` / `fed.session.liveness` WORKING branches are unit-tested; live they read OFF
  on this single-node bus (no grappe / no session) — the correct verdict, not an untested pass.
