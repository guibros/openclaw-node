# AUDIT_POST — step 6.4 (federation census + NODE_ACCEPTANCE federation axis)

**Result:** [A] — the `code:` deliverables are DONE and locally green; the `runtime:` half
("one observed green CI") is PENDING an operator push (not observable from this session). Not
closed [x]; no CI-green claimed without the run.

## What shipped

- **`lib/node-acceptance-probes.mjs`** — a `federation` axis: two substrate-fitness probes reusing
  the 6.3 pure graders (`gradeCoordinator`, `gradeClusterQuorum`), plus a `mapFedVerdict` mapper
  (WORKING→PASS, OFF/UNKNOWN→SKIP, BROKEN→FAIL):
  - `FED-L2-COORD` (required:false) — launchctl → `gradeCoordinator`. Loaded→PASS; absent→SKIP.
  - `FED-L2-QUORUM` (required:false, 6s) — `jsz`/`varz` topology → `gradeClusterQuorum`. Bus down
    pre-checks to SKIP (network axis owns it). Uses an **honest minority parse**:
    `membersUp = 1 + min(routes, connect_urls.length)` — an isolated node reads as quorum LOST, not a
    masked WORKING.
- **`test/fed-acceptance.test.mjs`** — 5 mock-ctx tests: axis surface (exactly 2, both non-required),
  COORD loaded→PASS/absent→SKIP (darwin-branched), QUORUM single-node→PASS, bus-down→SKIP,
  R=3-quorum-LOST→FAIL. **5/5 pass.**
- **`test/mesh-skip-census.test.mjs`** — census **completeness guard**: HARD-FAILS if any test file
  gates on nats with a skip reason but the file lacks the canonical census marker
  `'nats-server not found on PATH'`. Prevents a future nats-gated suite from vanishing with
  `skipped 0`. (File-granular, matching how the census greps.)
- **`lib/node-watch.mjs`** — **fixed a 6.3 honesty bug** in `fed.cluster.quorum` (see finding below).

## Evidence (observed 2026-07-15)

1. **Live federation acceptance axis** — `node bin/node-acceptance.mjs --axis federation` →
   `GATE: ACCEPTED (exit 0)`, `FED-L2-COORD PASS` (mesh-task-daemon loaded), `FED-L2-QUORUM PASS`
   (R=3 quorum held: 3/3 up).
2. **Census present + guarded** — `node --test test/mesh-skip-census.test.mjs`: Class 1 (7 mesh
   files) + Class 2 (5 nats-binary federation files) censuses run; completeness guard **passes** (no
   nats-gated suite escapes the canonical marker). On CI (no nats-server) Class 2 turns into a visible
   skip listing those 5 filenames.
3. **No regression** — all touched suites: `74 tests, 73 pass, 0 fail` (1 expected mesh-census skip).
   Acceptance suites alone: `38/38`.

## FINDING (operator decision needed) — the R=3 cluster is LIVE; docs say "single-node / 1.5 not cut over"

Building the QUORUM probe surfaced a contradiction between runtime and documented plan state:

- **Runtime truth:** 3 `nats-server` processes are running (`nats-1/2/3.conf`); `:8222/varz` shows
  `cluster.name=openclaw-cluster`, `cluster.urls`=2 routes, `connect_urls`=3 members; `:8222/jsz`
  `meta_cluster` shows `cluster_size:3`, `leader:openclaw-nats-3`. **The NATS/JetStream cluster is
  genuinely R=3 and quorate, all 3 up.** (Built in step 1.1 nats-cluster-harden.)
- **node-watch was lying about it:** `fed.cluster.quorum` read `varz.body` (the ctx exposes the parsed
  body as `.json`, so `.body` was `undefined`) → `v=null` → routes=0 → it **always reported
  "single-node JetStream bus (R=3 cluster not cut over — step 1.5)"** regardless of reality, and could
  never have detected a quorum loss. Fixed under this step (`.json` + honest minority parse); node-watch
  and acceptance now agree: `R=3 quorum held: 3/3 up`.
- **What "step 1.5" actually is, then:** the SERVER cluster is up (1.1 done). The open 1.5 question is
  narrower — whether the JetStream STREAMS are R=3-replicated or still R=1 (`jsz?streams=true` showed
  OPENCLAW_SHARED / KV_MESH_COLLAB / KV_MESH_NODE_HEALTH but did not surface `num_replicas`). That is a
  separate check neither tool makes yet, and a plan-state question for the operator — NOT rewritten
  here. The documented "single-node" framing was propagated from the node-watch bug and is stale.

## Verify contract → status

> `code:` CI run: nats absent ⇒ visible census skip with filenames; nats present ⇒ suites run —
> **MET** (census Class 2 does exactly this; guard prevents escapes; runs in `npm test`).
> `+ NODE_ACCEPTANCE federation axis` — **MET** (evidence 1, unit-tested).
> `runtime:` one observed green CI including the federation census — **PENDING** an operator push.
> No green claimed without the observed run → step stays **[A]**.

## Deferred / noted

- Shared varz→topology parser: acceptance and node-watch now carry parallel copies of the honest
  parse. Extracting one helper into `lib/fed-probes.mjs` is a cleanup (needs that file in scope).
  Captured, not done here.
- JetStream stream replication factor (R=1 vs R=3) — the real step 1.5 substance — is unmeasured;
  operator's call whether 1.5 is partially done.
