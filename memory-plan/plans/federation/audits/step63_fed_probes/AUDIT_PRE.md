# AUDIT_PRE — step 6.3 (node-watch `fed.*` probe family + grappe notification source)

**Step:** 6 / 6.3 → v6.3
**Verify contract (INVENTORY):** `runtime:` `node-watch --axis federation` grades the live
system (UNKNOWN where unobservable, never green); a killed grappe member flips a probe and
fires a ledgered popup, observed.

## Pre-state (what exists before this step)

- `lib/node-watch.mjs` — the watcher engine (`runWatch`, targets, `formatTable/Report/Html`,
  `STATUS`). Families present: process, mesh, memory, llm, mc, daemon. **No `federation` family.**
- `bin/node-watch.mjs` — CLI shim. Imports `runWatch` from lib; owns `notifyTransitions`
  (WORKING→BROKEN edge detection → `openclaw-notify`). **Single source tag `node-watch` for
  every family.** No per-family attribution.
- `bin/openclaw-notify.mjs` — ledgered click-through notifier; every event → `~/.openclaw/
  notifications/ledger.jsonl`; `--source NAME` accepted and shown in `--list`.
- KV shapes stable from Blocks 1–5: `GRAPPE_REGISTRY` (grappe manifests), `MESH_NODE_HEALTH`
  (heartbeats), `MESH_COLLAB` (sessions), `:8222/jsz`+`/varz` (JetStream monitor).
- No `lib/fed-probes.mjs`. No federation probe unit tests.

## Plan

1. `lib/fed-probes.mjs` — four **pure graders** (data→verdict, unit-testable without a bus):
   `gradeClusterQuorum`, `gradeGrappeMembers`, `gradeSessionLiveness`, `gradeCoordinator`,
   each returning `{status, detail}` over `FED_STATUS {WORKING,BROKEN,OFF,UNKNOWN}` honoring the
   NODE_WATCH honesty rules (green only on evidence; OFF when intentionally inactive; UNKNOWN when
   unobservable). Plus two **live probes** (`probeGrappeMembers`, `probeSessionLiveness`) that read
   KV via a short-lived NATS connection then grade.
2. `lib/node-watch.mjs` — a `family: 'federation'` block: `fed.coordinator`, `fed.cluster.quorum`,
   `fed.grappe.members`, `fed.session.liveness`.
3. `bin/node-watch.mjs` — route `fed.*` transitions in `notifyTransitions` to `--source grappe`
   (non-federation stays `node-watch`).
4. `test/fed-probes.test.mjs` — grader unit tests covering every verdict branch.

## Honest boundary (declared up front)

- The row description names `grappe/management/savant` sources. Only **grappe** is buildable now:
  `fed.mgmt.*` probes (management dispatch) land with step 4.2, and there is no savant subsystem.
  management/savant sources are **forward-deferred** — nothing to attribute yet. The **Verify
  contract** requires only the grappe-sourced fed.* popup, which this step delivers.
- On this single-node bus, `fed.grappe.members` and `fed.session.liveness` grade **OFF** (no grappe
  formed / no active session) — that OFF is the *correct* verdict, not an untested WORKING. Their
  WORKING/BROKEN branches are covered by the pure-grader unit tests; the R=3 quorum WORKING/BROKEN
  branch is unit-tested but only single-node is observable live until step 1.5 cutover.
