# GRANULAR — Phase 1 micro-steps (the basic cluster)

The level beneath [PHASE1_TASKS.md](PHASE1_TASKS.md): each atomic task's concrete micro-steps —
exact schema fields with types, function signatures, test names, config lines, probe registry
entries, commands. **Grounded in the real code** (reads done 2026-07-06, MASTER_PLAN §4.5 —
reality before aspiration); speculative signatures are marked `‹propose›`.

**Why only Phase 1 is granularized now.** Phases 2–3 depend on facts Phase 1 *measures* — real
LLM step timings (task 2.4.3), the 8-node RAM budget (4.1.1), the telemetry collector shape
(Phase-1 hindsight, 5.1.1). Pre-specifying their signatures today is decaying fiction. Each
later phase is granularized at **phase entry**, from its predecessor's recorded reality; the seed
structure is [PHASE2_TASKS.md](PHASE2_TASKS.md) / [PHASE3_TASKS.md](PHASE3_TASKS.md) §"granular
at entry".

## Reality anchors (verified interfaces this phase extends)

| Interface | Reality (file) | Consequence for granular design |
|---|---|---|
| collab session | `lib/mesh-collab.js` (CJS `module.exports`): `createSession`, `CollabStore`, `COLLAB_STATUS`, `COLLAB_MODE`, `CONVERGENCE`, `COLLAB_KV_BUCKET` | new code is CJS `require()`; the `architecture` field (3.1) sits beside the existing `circling:{…}` sub-object; `COLLAB_MODE.CIRCLING_STRATEGY='circling_strategy'` is adversarial mode |
| circling state | `session.circling = {worker_node_id, reviewerA_node_id, reviewerB_node_id, max_subrounds, current_subround, current_step, phase, artifacts}` | cooperative/collaborative get sibling sub-objects `cooperative:{…}` / `collaborative:{…}`, NOT new schemas |
| signing | `lib/deploy-trigger-auth.mjs` (ESM) → `signEvent`/`verifyEvent` from `lib/node-identity.mjs` (ed25519, `signature`+`timestamp`+`event_id`, freshness + replay) | grappe membership + envelopes sign with `signEvent` directly — the **same ed25519 identity**, not a new scheme |
| join token | `bin/mesh-join-token.js` → HMAC shared-secret integrity | **reconcile (1.4.1):** token carries grappe-id/expiry with HMAC integrity; the *member record* is ed25519-signed by the joining node. Two mechanisms, two jobs — documented in the spec |
| watch probe | `lib/node-watch.mjs`: `{id, family, label, signal, slow?, timeoutMs?, async run({ctx,config})→ W()/B()/U()/OFF()}` | `fed.*` probes are new entries in this exact registry shape; UNKNOWN (`U()`) when unobservable, never green |
| notify | `bin/openclaw-notify.mjs --source --kind --title --message --url` (ledger + click-through) | `grappe` source = `--source grappe`; kinds map: gate→`block`/`warn`, failure→`error`, success→`success` |

---

## Block 0 — Spec + ground truth

### Task T0.1.1–T0.1.4 (crash-loop diagnosis)
- **g.0.1.a** For each of the 11 `.plist.disabled`, extract `Label`, `ProgramArguments[1]`, `StandardErrorPath` → build the table `{unit, script, err_path}`.
- **g.0.1.b** `log show --predicate 'eventMessage CONTAINS "openclaw" OR process CONTAINS "mesh"' --start "2026-07-03 00:00:00" --end "2026-07-03 23:59:59" --style compact` → grep per unit label; also tail each `err_path`.
- **g.0.1.c** For each unit assign class ∈ {A=nats-connect-loop, B=code-throw, C=stale-config} with the one deciding log line. Expected prior (2026-07-04b finding): several are class C (dead `-Users-moltymac-openclaw` project path from the pre-rename era).
- **g.0.1.d** DECISIONS **D2** table: `unit | class | evidence-line | revive-precondition`. Rule stated: a class-B/C unit's precondition must be met (fix committed) before task 1.2.2/2.1.2 starts it.

### Task T0.2.2 — grappe manifest schema
- **g.0.2.manifest** (KV bucket `grappe-registry`, key `g.<id>`):
```json
{ "v": 1, "id": "wg-alpha", "layer": "worker|management|savant",
  "mode": "adversarial|cooperative|collaborative",       // worker layer only; null for mgmt/savant
  "quorum": 3,                                            // meaningful for management (3-of-5)
  "members": [ { "node_id": "alpha", "role": null,        // role set for mgmt (coordinator|decomposer|assembler|verifierA|verifierB)
                 "joined_at": "ISO8601", "pubkey": "base64", "sig": "base64" } ],
  "status": "forming|active|degraded|dissolved",
  "formed_at": "ISO8601" }
```
- Member `sig` = `signEvent({grappe_id, node_id, joined_at}, memberPrivKey).signature`; verified against `pubkey` in the trusted set (1.4).

### Task T0.2.3 — envelope schemas
- **g.0.2.task**:
```json
{ "v": 1, "envelope_id": "uuid", "task_id": "uuid",
  "origin": "mgmt:<session_id> | operator", "grappe_id": "wg-alpha",
  "preferred_mode": "adversarial|cooperative|collaborative",
  "payload": { "title": "str", "brief": "str", "inputs": ["ref"], "acceptance": ["str"] },
  "deadline_s": 3600, "issued_at": "ISO8601", "event_id": "uuid",  // replay key (reuses node-identity)
  "signature": "base64" }                                          // signEvent over the above
```
- **g.0.2.result**:
```json
{ "v": 1, "envelope_id": "uuid", "task_id": "uuid", "grappe_id": "wg-alpha",
  "session_id": "collab-session-uuid", "status": "complete|failed|timeout",
  "artifacts_ref": ["kv:collab/<sid>/<key>"], "votes": { "converged": 2, "blocked": 0 },
  "metrics": { "wall_s": 0, "subrounds": 0, "degraded_nodes": 0 },
  "issued_at": "ISO8601", "event_id": "uuid", "signature": "base64" }
```
- **g.0.2.subjects** table: `mesh.grappe.registry.form|join|leave|list`, `mesh.grappe.<id>.task` (dispatch), `mesh.grappe.<id>.result`; reserve `mesh.mgmt.<id>.*` and `mesh.savant.<id>.*` with shapes. All extend the existing `mesh.*` namespace — no second root.

## Block 1 — Substrate

### Task T1.1.1 — nats-node-1.conf (exact)
```
server_name: openclaw-n1
listen: 127.0.0.1:4222
http: 127.0.0.1:8222                       # monitor
jetstream { store_dir: "~/.openclaw/nats/n1", max_memory_store: 64MB, max_file_store: 2GB }
cluster {
  name: openclaw-cluster
  listen: 127.0.0.1:6222
  routes: [ nats-route://127.0.0.1:6223, nats-route://127.0.0.1:6224 ]
}
```
- **g.1.1.a** node-2: server_name `openclaw-n2`, 4223/8223/6223, store `n2`, routes → 6222,6224.
- **g.1.1.b** node-3: `openclaw-n3`, 4224/8224/6224, store `n3`, routes → 6222,6223.
- **g.1.1.c** validate each: `nats-server -c services/nats/cluster/nats-node-N.conf -t` → "configuration OK".

### Task T1.1.3 — units
- **g.1.1.d** rewrite `services/launchd/ai.openclaw.nats.plist` ProgramArguments → `nats-server -c <repo>/services/nats/cluster/nats-node-1.conf`; add `ai.openclaw.nats-2`/`-3`; systemd equivalents; add all three to `services/service-manifest.json` role `both`. Remove the old single-node config path (§4.6).

### Task T1.1.4–T1.1.6 — bring-up + probes
- **g.1.1.e** `for p in 8222 8223 8224; do curl -s 127.0.0.1:$p/varz | jq '.cluster.name, (.cluster.urls|length)'; done` → each `"openclaw-cluster"`, 2.
- **g.1.1.f** R=3 probe: `nats stream add fedtest --replicas 3 --subjects "fedtest.>" …`; `nats stream info fedtest -j | jq '.cluster.replicas|length'` → 3.
- **g.1.1.g** quorum: `launchctl kill TERM …nats-2`; `nats pub fedtest.x hi` succeeds; `nats stream info` shows 1 replica offline; restart → back to 3.

### Task T1.3.1–T1.3.6 — grappe registry + CLI ‹propose›
- **g.1.3.a** `lib/grappe-registry.mjs` (CJS to match mesh-*): exports
  `formGrappe(nc, {id, layer, mode, members, quorum})`, `getGrappe(nc, id)`,
  `listGrappes(nc)`, `dissolveGrappe(nc, id)`, `validateManifest(m)` (throws on schema miss),
  `memberVerdict(member, now)` → `'LIVE'|'DEGRADED'|'DEAD'` from heartbeat age (LIVE < 60s).
- **g.1.3.b** `memberVerdict` is pure → its own unit test (fixture heartbeats at 10s/90s/dead).
- **g.1.3.c** `bin/openclaw-grappe.mjs` subcommands: `form --id --mode --members a,b,c`,
  `status [id]`, `dissolve <id>`, `join --token <t>`. `status` renders grappe + `memberVerdict`
  per member using the node-watch color vocabulary.
- **g.1.3.d** package.json `bin["openclaw-grappe"]="./bin/openclaw-grappe.mjs"`; install.sh copies to workspace bin.

### Task T1.4.1–T1.4.4 — signed membership
- **g.1.4.a** `mesh-join-token.js --grappe wg-alpha --expires 48h` → token payload gains `grappe_id`, `exp`; HMAC unchanged (integrity of the invite).
- **g.1.4.b** `join --token`: (1) HMAC-verify the token (invite integrity, not expired); (2) the joining node `signEvent({grappe_id, node_id, joined_at}, privKey)`; (3) `formGrappe`/registry appends the member with its `pubkey`+`sig`; (4) registry `validateManifest` + verify member sig against the grappe's trusted pubkeys.
- **g.1.4.c** reject paths (each logs + `openclaw-notify --source grappe --kind block`): bad HMAC, expired token, member sig fails `verifyEvent`, pubkey not trusted.
- **g.1.4.d** `test/grappe-membership.test.mjs`: `it('mints a grappe-bound token')`, `it('accepts a valid signed join')`, `it('rejects expired token')`, `it('rejects a forged member signature')`.

## Block 2 — Adversarial (circling revival)

### Task T2.1.1 — mock-LLM seam
- **g.2.1.a** Inspect how `test/*circling*` fakes the LLM (constructor injection vs module mock). If injection-only, add a process seam in `bin/mesh-agent.js`: `if (process.env.MESH_AGENT_MOCK) llm = loadMockScript(process.env.MESH_AGENT_MOCK)` where the script is a JSON map `{role_step: artifactText}`. Keep the delimiter output (`===CIRCLING_ARTIFACT===`) intact so the real parser is exercised.

### Task T2.1.3–T2.1.4 — live session + evidence
- **g.2.1.b** driver: `nats req mesh.collab.create '{"mode":"circling_strategy","task_id":"…","min_nodes":3}'`; three mock agents `nats … mesh.collab.join`.
- **g.2.1.c** evidence pulls (quote in audit): `CollabStore.get(sid).circling.current_subround` advances 0→3; each `reflect` tagged `circling_step` 1 then 2; barrier fired at 3/3 (count reflections where `circling_step===current_step`); finalization votes present; artifacts at `kv:collab/<sid>/*`.

### Task T2.2.1 — adaptive convergence (paper §14.1)
- **g.2.2.a** in `advanceCirclingStep` (lib/mesh-collab.js ~line 620+), after the step-2 barrier: if every live node's latest vote `=== CONVERGENCE.CONVERGED`, set phase→finalization instead of incrementing `current_subround`. Guard: only when `current_step===2`.
- **g.2.2.b** `test/collab-circling.test.js`: `it('finalizes early when all vote converged after a sub-round')` + `it('continues when votes are mixed')`; assert the existing 27 still pass.

### Task T2.3.1 — parse-retry (paper §14.2)
- **g.2.3.a** in the daemon reflect handler (bin/mesh-task-daemon.js), on parser failure: read `failCount` for `{sid, node, subround, step}`; if `< 3` → `nats pub` the directed input back to that node, increment failCount, **return without counting toward the barrier**; at 3 → existing degrade + `CRITICAL` log.
- **g.2.3.b** `test/daemon-circling-handlers.test.js`: `it('retries a parse failure up to 3x then degrades')` (2-fail-then-success = barrier satisfied; 3-fail = degraded).

### Task T2.4.* — first real run
- **g.2.4.a** operator picks the task (AskUserQuestion); write brief to the create payload.
- **g.2.4.b** agents point at qwen3:8b via the ollama queue (existing LLM_MODEL wiring); **serialize** — one live agent inference at a time per host (single-GPU law).
- **g.2.4.c** record `metrics.wall_s`, per-step timings, `subrounds`, `degraded_nodes` → DECISIONS as Phase-2 planning constants (management dispatch budgets against these).

## Block 3 — Modes B + C

### Task T3.1.1–T3.1.2 — dispatch seam
- **g.3.1.a** `createSession` (lib/mesh-collab.js:54): add `architecture: collabSpec.architecture || 'adversarial'`. Keep `circling:{…}` as the adversarial-mode config (built only when architecture==='adversarial'); add `cooperative:null`/`collaborative:null` siblings, populated per mode.
- **g.3.1.b** daemon advance: `switch(session.architecture){ case 'adversarial': advanceCirclingStep; case 'cooperative': advanceCooperativeRound; case 'collaborative': advanceCollaborativeSubtasks; default: reject }`. One function per mode, one dispatch point.
- **g.3.1.c** regression gate: the 44 existing circling tests green + `it('defaults architecture to adversarial')` + `it('rejects an unknown architecture')`.

### Task T3.2.* — cooperative ‹propose›
- **g.3.2.a** `session.cooperative = { integrator_order: [n1,n2,n3], current_round: 0, max_rounds: 3, integrator_idx: 0 }`.
- **g.3.2.b** round: barrier[all 3 propose] → integrator = `integrator_order[current_round % 3]` merges (barrier 1/1) → `current_round++`. Directed input (compileInput branch): proposers see `merged_artifact` + all prior `proposals`; integrator sees everything.
- **g.3.2.c** `test/cooperative.test.js`: rotation (`integrator differs each round`), barrier counts, `it('final artifact draws provenance from all three nodes')`.

### Task T3.3.* — collaborative ‹propose›
- **g.3.3.a** `session.collaborative = { subtasks:[{id, assignee_node, artifact_ref, status}], assembler_node, merge_review_votes:{} }`.
- **g.3.3.b** open with a decomposition artifact → for each subtask `mesh.plans.subtask` create + assign one per node; nodes work in parallel (no cross-barrier); per-subtask timeout.
- **g.3.3.c** merge: assembler = node with the largest subtask (stored); barrier[other two merge-review vote].
- **g.3.3.d** `test/collaborative.test.js`: `it('assigns one subtask per node')`, `it('isolates per-subtask artifacts')`, `it('gates delivery on a merge-review quorum')`; live: overlapping subtask timestamps.

### Task T3.4.* — mode selection
- **g.3.4.a** FEDERATION_SPEC decision table (rows: single high-stakes artifact→adversarial; exploratory/unowned→cooperative; decomposable-by-shape→collaborative; default adversarial).
- **g.3.4.b** create honors `preferred_mode`; unknown → reject; `it('routes each preferred_mode to its protocol')`.

### Task T3.5.* — Phase-1 GATE (worker probes, notify, matrices, soak)
- **g.3.5.probes** three new entries in the `lib/node-watch.mjs` registry (exact shape):
  - `{ id:'fed.cluster.quorum', family:'federation', label:'NATS cluster quorum', signal:'≥2/3 cluster peers up', async run({ctx}){ …curl the 3 /varz; W if 3, B if <2, else DEGRADED-as-B with note } }`
  - `{ id:'fed.grappe.members', family:'federation', label:'Grappe member liveness', signal:'all members heartbeat <60s', run(){ registry → memberVerdict per member; B if any DEAD in an active grappe } }`
  - `{ id:'fed.session.liveness', family:'federation', label:'Collab session progress', slow:true, signal:'no session stalled past step timeout', run(){ U if no active session, B if any past-deadline } }`
- **g.3.5.notify** daemon emits `openclaw-notify --source grappe` on: gate raised (`--kind block --url <MC>/federation`), session failed (`--kind error`), member dead (`--kind warn`).
- **g.3.5.matrix** the 6 T3 cells (L1–L6) + 8 chaos cells (C1–C8) from IMPLEMENTATION_PHASES §1.C, each run + its KV/ledger evidence quoted in AUDIT_POST.
- **g.3.5.soak** `test/soak/worker-feeder.mjs`: every 20 min submit a mock task cycling the 3 modes; run ≥12h; census script asserts every session terminal, `launchctl list | grep openclaw` restart counters flat, daemon RSS ±20%.
- **g.3.5.ci** `.github/workflows/test.yml`: federation suites gated behind a `nats-server` presence check (existing census pattern); visible skip lists the file names when absent.
- **g.3.5.t7** operator watches one live session end-to-end from MC/kanban; signs the 5-point Phase-1 checklist in AUDIT_POST.

---

## What granular buys, and its honesty limit

At this grain a tick (or a human) implements without re-deriving: the file, the function name,
the field types, the test name, the command, the observable. The `‹propose›` marks are the
honest edge — signatures I'm proposing against real neighbors but that Phase-1 implementation
may refine; they are design intent, not a promise the code will read exactly so. Everything
un-marked is anchored to a verified interface. Nothing here is "done" until its observable is
witnessed live (MASTER_PLAN §5) — granularity sharpens the work, it does not pre-complete it.
