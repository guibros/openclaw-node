# IMPLEMENTATION_PHASES — federation plan, three-phase execution detail

> **⚠ D11 (2026-07-13):** wherever this document runs workers/agents on qwen3:8b via the ollama queue, that is **scaffold config, superseded** — a grappe worker is the node's OpenClaw agent on an advanced LLM, never qwen. See DECISIONS D11.

**Authored 2026-07-06 (operator-directed).** This document elaborates
[ROADMAP.md](ROADMAP.md) into the three delivery phases the operator set: each phase ends with
its cluster **operationally proven** — built, extensively tested, observable, and soaked — before
the next layer stands on it. It maps phases → ROADMAP blocks → INVENTORY steps and specifies the
testing programs (steps 3.5, 4.6, 5.5) in exhaustive detail.

| Phase | Delivers | ROADMAP blocks | INVENTORY steps | Ops-testing step |
|---|---|---|---|---|
| **1** | The basic cluster: substrate + one worker grappe running all three modes | 0, 1, 2, 3 (+ Block 6 slices: CI census, worker probes/notify) | 0.1–3.4 | **3.5** |
| **2** | The manager cluster: 5-node management grappe commanding worker grappes | 4 (+ 6 slices: fleet join, mgmt probes/MC view) | 4.1–4.5 | **4.6** |
| **3** | The savant cluster: overview → operator-gated change-sets | 5 (+ 6 slices: savant probes/MC review UI) | 5.1–5.4 | **5.5** |

**Atomic task decomposition** (the per-step implementation checklists — file to touch, function
to write, observable that proves it) lives in the per-phase task docs:
[PHASE1_TASKS.md](PHASE1_TASKS.md) · [PHASE2_TASKS.md](PHASE2_TASKS.md) ·
[PHASE3_TASKS.md](PHASE3_TASKS.md).

Block 6's steps execute **inside** the phases as noted (6.4 CI census lands in Phase 1; 6.1
fleet-join in Phase 2; 6.2/6.3 grow incrementally each phase and close in Phase 3). The
test-tier vocabulary below is shared by all three phases:

- **T1 unit** — pure-logic tests, no I/O (node:test, existing conventions).
- **T2 integration** — ephemeral NATS servers per suite (federation-2node precedent), real
  JetStream, mocked LLM.
- **T3 live-local** — the real spawned-node grappe on this machine, real daemons, mock LLM.
- **T4 live-LLM** — T3 with qwen3:8b through the ollama queue (single-GPU aware).
- **T5 chaos** — failure injection against T3 (kill -9, partitions, timeouts, forgeries).
- **T6 soak** — unattended multi-hour/day runs; the watcher + notification ledger are the
  witnesses (no green-by-assertion: soak evidence is ledger + snapshot artifacts).
- **T7 acceptance** — the operator-observed gate closing the phase (`visual:` + a recorded
  checklist in the step's AUDIT_POST).

Nothing in a later phase may consume an interface a T-tier didn't cover in the earlier phase.

---

## PHASE 1 — The basic cluster, operationally proven

**Objective.** One worker grappe of three logical nodes on this machine, executing tasks in all
three architectures over a replicated substrate, surviving the chaos matrix, soaked overnight,
CI-guarded, watch-graded, and notifying.

### 1.A Substrate deliverables (steps 0.1–1.4)

**0.1 — crash-loop diagnosis.** Before any unit is revived: `log show --predicate` over the
2026-07-03 window for each disabled/zombie unit across both launchd domains (the 11 user-domain
`.disabled` + the system-domain `com.openclaw.agent` — D4); classify each as (a) NATS-dependency
crash (connect-fail tight loop), (b) code fault (stack trace), or (c) config fault (bad path/env
from the pre-rename era). Output: the DECISIONS crash-loop triage entry (appended at 0.1 close —
"D2" is already taken) with per-unit verdict + log excerpt. **Nothing in
Phase 1 starts a previously-disabled unit whose class is (b) or (c) without its fix landing
first.**

**0.2 — FEDERATION_SPEC.md.** The contract for everything below. Must contain, concretely:
- Grappe model: definition, layers, lifecycle (FORMING → ACTIVE → DEGRADED → DISSOLVED).
- The three mode flow diagrams at circling-paper fidelity (steps, who-sees-what, barriers).
- Schemas (JSON, versioned `v: 1`):
  - **Grappe manifest** — KV bucket `grappe-registry`, key `g.<id>`:
    `{v, id, layer: worker|management|savant, mode, members: [{node_id, joined_at, sig}],
    formed_at, status, quorum}` (quorum meaningful for management: 3-of-5).
  - **Task envelope** — `{v, envelope_id, task_id, origin (mgmt session id | operator),
    grappe_id, preferred_mode, payload: {title, brief, inputs[], acceptance[]},
    deadline_s, issued_at, nonce, sig}`.
  - **Result envelope** — `{v, envelope_id, task_id, grappe_id, session_id,
    status: complete|failed|timeout, artifacts_ref[] (KV keys), votes, metrics: {wall_s,
    subrounds, degraded_nodes}, sig}`.
- Subject map, extending the existing `mesh.*` namespace (never a second namespace):
  `mesh.grappe.<id>.task` (dispatch), `mesh.grappe.<id>.result`, `mesh.grappe.registry.*`
  (form/join/leave), management + savant subjects reserved with shapes (used in Phases 2–3).
- Signing: every cross-grappe message signed per the deploy-trigger-auth pattern (ed25519,
  trusted-keys registry, nonce + issued_at replay window — the C2 lessons applied from day one).
- Layer contracts: what a worker grappe owes management (result envelope semantics), what
  management owes the savant (outcome telemetry), what the savant owes the operator
  (change-set schema — full detail lives in Phase 3 but the schema is locked here).

**1.1 — NATS cluster.** Per docs/NATS_CLUSTER.md local-dev mode: three server configs
(4222/4223/4224 client, 6222-6224 route mesh, 8222-8224 monitors), cluster `openclaw-cluster`,
JetStream enabled on all three. The existing `ai.openclaw.nats` unit is *reconfigured* into
node-1 of the cluster + two sibling units (§4.6: no parallel single-node NATS left behind).
Consumer-hardware budget: ~64MB JetStream memory cap per node, file store under `~/.openclaw/nats/`.

**1.2 — logical nodes.** `spawn-node.mjs --id alpha|bravo|charlie` trees; each runs the minimum
member set: mesh-agent + health heartbeat, connected round-robin across the three cluster URLs.
Units generated per spawned tree (launchd label `ai.openclaw.node-<id>-agent`), OFF by default,
started by the grappe CLI or openclaw-stack.

**1.3 — grappe registry + CLI.** `lib/grappe-registry.mjs` (KV read/write, manifest validation)
+ `bin/openclaw-grappe.mjs` (`form`, `status`, `dissolve`, `join --token`). `status` renders the
same honest verdicts vocabulary as node-watch (LIVE member = fresh heartbeat < 60s; DEGRADED
grappe = 2/3 live; DEAD = <2).

**1.4 — signed membership.** Join tokens minted by `mesh-join-token` bound to grappe id +
expiry; membership records carry the joining node's signature; registry rejects unsigned/expired
joins loudly (log + ledgered notification, kind `block`).

### 1.B Worker modes deliverables (steps 2.1–3.4)

**2.1 — circling revived live.** mesh-task-daemon + mesh-bridge on the operator node (revived
per the 0.1 triage verdicts), agents on alpha/bravo/charlie, LLM mocked (`MESH_AGENT_MOCK=1` — reuse
whatever seam the 44 tests use; if none exists at process level, adding the env seam is part of
this step). One full session: create → recruit (3 roles stored) → SR1 step 1 barrier 3/3 → SR1
step 2 barrier 3/3 → … → finalization votes → COMPLETE. Every state transition read back from
session KV and quoted in the audit.

**2.2 — adaptive convergence (paper §14.1).** After step-2 barrier: if all live nodes' latest
votes are `converged`, jump to finalization. T1 tests + a scripted T3 run finalizing after SR1.

**2.3 — parse-failure retry (paper §14.2).** Reflect handler: `failCount < 3` → re-publish
directed input to that node, do not count toward barrier; 3rd failure → degrade (existing path).
T1 tests both sides of the boundary; T3 run with injected double-failure completes un-degraded.

**2.4 — first real adversarial run.** Task chosen with the operator (small, real, useful — e.g.
"review + harden one repo doc"). qwen3:8b via the ollama queue; expect step wall-times near the
LLM budget — 10-min step timeouts hold (measured in 2026-07-04 probes: extract ~120s each call).
Record per-step timings + subround count in the audit; they become Phase 2 planning constants.

**3.1 — `architecture` dispatch seam.** `mesh-collab.js` session gains
`architecture: 'adversarial'|'cooperative'|'collaborative'` (default adversarial; `circling`
field becomes the adversarial-mode config). Daemon advances sessions through a per-mode strategy
table — one dispatch point, no forked daemons.

**3.2 — cooperative mode.** Round = [all 3 propose (barrier 3/3)] → [integrator merges
(barrier 1/1)] → rotate integrator (stored order, like stored role ids). `max_rounds` default 3;
finalization votes as in circling. Directed-input rule: proposers see the current merged
artifact + all previous proposals; the integrator sees everything (co-authoring wants shared
context — the asymmetry that defines adversarial is deliberately absent, per the operator's
definitions).

**3.3 — collaborative mode.** Session opens with a decomposition artifact (from the envelope or
a decomposition step), registers subtasks via `mesh.plans.*`, assigns one per node, nodes work
in parallel (per-subtask artifacts, no cross-barriers until merge), then merge step (assembler =
the node with the largest subtask, stored) + one merge-review barrier (both other nodes vote).
Timeout per subtask, not per session.

**3.4 — mode selection contract.** Spec section: decision table (single high-stakes artifact →
adversarial; exploratory/unowned → cooperative; decomposable-by-shape → collaborative; default
adversarial). Envelope `preferred_mode` honored by session creation; unknown value rejected.

### 1.C Phase-1 operational testing program — step 3.5 (the gate)

**T1 unit** (target: every new lib function; existing 44 circling tests stay green):
registry/manifest validation, token mint/verify/expiry, envelope schema + signature round-trip,
mode dispatch table, integrator rotation, subtask assignment, convergence early-exit, retry
boundary.

**T2 integration** (ephemeral 3-node NATS per suite): R=3 stream create/replicate; KV manifest
CRUD with concurrent writers; barrier semantics under duplicate + out-of-order reflections;
session state machine per mode driven end-to-end with scripted agents.

**T3 live-local matrix** — on the real grappe, mock LLM; every cell OBSERVED (KV + kanban +
ledger evidence, quoted in the audit):

| # | Scenario | Expected |
|---|---|---|
| L1 | adversarial: 3 SRs to converged | COMPLETE, artifacts per SR |
| L2 | adversarial: converge in SR1 | early finalization (2.2) |
| L3 | adversarial: blocked vote | tier gate raised, operator approve resumes |
| L4 | cooperative: 3 rounds | integrator differs each round; merged artifact provenance from all 3 |
| L5 | collaborative: 3 subtasks | concurrent timestamps; merge + 2 merge-review votes |
| L6 | mode field: each of 3 values | lands in matching protocol; unknown → rejected |

**T5 chaos matrix** — each injected against a running T3 session:

| # | Injection | Required behavior |
|---|---|---|
| C1 | `kill -9` one member mid step-1 barrier | dual-layer timeout fires; node marked dead; session degrades per paper, completes 2/3 or gates — never hangs |
| C2 | kill one NATS node (follower) | R=3 stream stays writable; session continues; probe flips + recovers |
| C3 | kill the NATS meta-leader | new leader elected; in-flight barrier completes after reconnect |
| C4 | LLM stall > step timeout (mock sleep) | timeout path, UNAVAILABLE marker, no zombie timers after daemon restart (cron sweep rehydration proven) |
| C5 | duplicate reflection replay | barrier counts once (idempotency) |
| C6 | forged join / forged task envelope | rejected + `block` notification ledgered |
| C7 | daemon restart mid-session | state rehydrates from KV; session resumes (paper's dual-layer timeout design proven live) |
| C8 | KV blob approaching 1MB (oversized artifacts) | 800KB warning fires (paper §5 guard) before the wall |

**T6 soak.** ≥12h unattended: a cron feeder submits a mock task every 20 min, cycling the three
modes. Pass = 0 hung sessions, 0 crash-loops (launchd restart counters flat), heartbeats
unbroken, every session terminal (COMPLETE/GATED/FAILED — no zombies), memory of daemons flat
(±20%). Witnesses: node-watch snapshots, notification ledger, session KV census script.

**Ops slices landed in this phase:** CI federation census (6.4 — nats-binary-gated, visible
skips); node-watch `fed.cluster.quorum`, `fed.grappe.<id>.members`, `fed.session.liveness`
probes; notification source `grappe` (gate raised / session failed / member dead → ledgered
popups); `openclaw-stack` knows the cluster + spawned-node units.

**T7 acceptance — Phase-1 exit gate (all observed, checklist in 3.5's AUDIT_POST):**
1. `openclaw-grappe status`: 1 worker grappe, 3/3 LIVE, on the 3-node cluster (quorum survives
   one NATS kill).
2. One real-LLM adversarial session converged (2.4 evidence).
3. All six T3 cells + all eight chaos cells green-by-observation.
4. Soak report clean; CI green including federation census.
5. Operator has watched one live session end-to-end from MC/kanban and approves.

---

## PHASE 2 — The manager cluster, operationally proven

**Objective.** A 5-node management grappe that owns complex tasks end-to-end — quorum-approved
decomposition, signed dispatch to worker grappes, monitoring with reassignment, assembly,
quorum verification, delivery or operator escalation — proven against its own chaos matrix and
soaked with concurrent complex tasks.

### 2.A Deliverables (steps 4.1–4.5)

**4.1 — management session type + quorum decomposition.** Second grappe (`mg-one`, layer
`management`, 5 spawned nodes — total 8 logical nodes + 3 NATS on this machine: measured RAM
budget recorded before proceeding; if the box can't carry 8, the fallback is 5 shared-process
agents, decided with the operator and logged as a DECISION). Roles stored at formation:
coordinator, decomposer, assembler, verifierA, verifierB. State machine:
`INTAKE → DECOMPOSING → DECOMP_VOTE → DISPATCHED → ASSEMBLING → VERIFY_VOTE →
DELIVERED | GATED`, single-writer KV like the paper. Decomposer proposes
`{subtasks: [{id, brief, preferred_mode, acceptance[]}], rationale}`; all five vote; ≥3 approve
→ advance; <3 → one revision round (decomposer sees the objections — adversarial input reuse);
second failure → GATED to operator.
**4.2 — signed dispatch + result deferral.** Coordinator turns approved subtasks into task
envelopes (schema from 0.2), signs, publishes `mesh.grappe.<id>.task`. Worker grappe validates
signature/nonce/deadline → creates its session in `preferred_mode` → on terminal state publishes
the signed result envelope. Management correlates by `envelope_id`; late/duplicate results
idempotent.
**4.3 — assembly + verification quorum.** Assembler merges result artifacts into the delivery
artifact (+ an assembly note: what came from where — provenance). VerifierA/B independently
review against the intake acceptance criteria (directed inputs: they see intake + assembly, NOT
each other's review — the paper's asymmetry where it counts). Five votes; ≥3 accept →
DELIVERED (artifact + provenance to the origin; ledgered `success` notification); any verifier
reject with <3 accepts → GATED with both reviews attached.
**4.4 — failure handling.** Per-dispatch deadline timers (in-memory + cron-sweep rehydration —
the proven pattern); missed deadline or grappe DEGRADED→DEAD ⇒ reassign to another registered
worker grappe (or re-queue with backoff if none), max 2 reassignments then GATED; every
reassignment ledgered (`warn`).
**4.5 — end-to-end proof.** Real 2-subtask task (operator-chosen; subtasks shaped for two
different modes), two worker grappes formed, full lifecycle observed with one injected mid-run
worker-grappe kill absorbed by reassignment.

### 2.B Phase-2 operational testing program — step 4.6

**T1:** quorum arithmetic (3/5, 2/5+revision, tie-impossible proof for 5, dead-voter counting —
quorum is of LIVE members with floor 3), state-machine legality (no transition skips), envelope
correlation idempotency, reassignment policy boundaries (0, 1, 2, then gate).
**T2:** full management session against scripted worker grappes (ephemeral NATS): happy path;
revision path; gated-decomposition path; verifier-reject path; duplicate result envelope;
late result after reassignment (must be discarded — the reassigned result wins, deterministic
rule: first terminal result per envelope_id accepted, logged).
**T3 live-local:** management grappe of 5 + one worker grappe, mock LLM: M1 happy 2-subtask; M2
decomposition revision round; M3 verifier reject → GATE → operator approve from MC; M4 both
worker modes dispatched per `preferred_mode`.
**T5 chaos:** X1 kill worker grappe mid-subtask (→ reassignment, task completes); X2 kill the
COORDINATOR mid-DISPATCHED (management grappe is itself 3/5-quorate for role succession: the
spec must define coordinator succession — implement + prove here); X3 forged result envelope
(rejected + `block` ledger); X4 replayed old envelope (nonce window rejects); X5 management
daemon restart mid-VERIFY_VOTE (rehydrates, vote completes); X6 NATS follower kill during
dispatch (no envelope loss — JetStream ack discipline proven).
**T6 soak:** ≥24h: feeder submits a complex task (2–3 subtasks) every 2h, mixed modes, one
scheduled chaos injection midway. Pass = every task terminal, zero orphaned worker sessions,
reassignment counter matches injections, ledger tells the whole story without reading KV.
**Ops slices:** 6.1 fleet join-by-token proven (a clean spawned tree joins wg-bravo via token);
MC management view (sessions, votes, gates actionable); `fed.mgmt.*` probes; `management`
notification source.
**T7 acceptance — Phase-2 exit gate:** 4.5's end-to-end run observed by the operator; all T3/T5
cells observed; soak clean; MC gate approval exercised for real; RAM budget for 8 logical nodes
recorded and sustainable (or the fallback decision logged).

---

## PHASE 3 — The savant cluster, operationally proven

**Objective.** A savant grappe that watches the entire federation, argues with itself about what
should change (adversarial protocol over proposals), and delivers concrete, signed,
operator-gated change-sets — with structural proof it can never modify the system directly.

### 3.A Deliverables (steps 5.1–5.4)

**5.1 — telemetry substrate.** `lib/savant-feed.mjs`: one queryable feed over (a) node-watch
JSON snapshots (all nodes), (b) the notification ledger, (c) session KV outcomes (worker +
management: modes, durations, subrounds, votes, gates, reassignments), (d) tick digests /
plan-lint summaries. Collector decision (JetStream mirror vs periodic scrape) made in Phase-1
hindsight and logged; feed entries carry `{source, node, ts, kind, ref}` and are themselves
append-only.
**5.2 — change-set sessions.** Savant grappe `sv-one` (3 nodes, adversarial protocol — the
Worker drafts the change-set, two Reviewers attack it: is the evidence real? is the edit
minimal? is the level right? does the expected-evidence line make it falsifiable?). Work
artifact = **change-set**:
`{v, id, level: substrate|worker|management|policy, target_plan, rationale (telemetry-cited:
feed refs required, uncited claims are a reviewer-rejectable offense), edit: {type:
patch|scope-addendum, content}, expected_evidence (the runtime probe that would prove the edit
worked), votes, sig}`. Schema-invalid or evidence-free change-sets cannot reach finalization.
**5.3 — proposal pipeline.** Terminal converged change-set → signed → (a) ledgered notification
(`savant`, click-through to the MC review view), (b) PROPOSED entry appended to the TARGET
plan's OUT_OF_SCOPE.md (the always-writeable drift-capture file — savant proposals ARE captured
drift, definitionally). The pipeline process runs with write access to OUT_OF_SCOPE.md paths
only (enforced in code + test — attempt to write elsewhere throws and is a T5 case). Approved
proposals proceed as normal operator-scoped work; the savant never applies.
**5.4 — first real cycle.** ≥7 days of accumulated real telemetry (Phases 1–2 soaks provide
it); savant emits ≥1 change-set per level, each reaching the gate; operator verdicts recorded.

### 3.B Phase-3 operational testing program — step 5.5

**T1:** feed query correctness (source filters, time windows, ref resolution); change-set
schema validation incl. fuzzed inputs (missing evidence, wrong level enum, oversized patch);
signature verify; OUT_OF_SCOPE-only write jail.
**T2:** scripted savant session over a synthetic telemetry fixture with a KNOWN planted defect
(e.g. fixture shows a probe flapping on a 30s timeout) — the converged change-set must target
it; a fixture with NO defect — the honest outcome is a `no-change` verdict (savant must be
allowed to conclude nothing needs changing; a forced-proposal savant is a noise generator).
**T3 live-local:** S1 change-set end-to-end to the gate over seeded telemetry; S2 reviewer
rejection loop (Worker's uncited rationale rejected, revised, converges); S3 no-change verdict
session.
**T5 chaos/security (the gate is the attack surface):** G1 pipeline attempts a write outside
OUT_OF_SCOPE → throws, ledgered `error`; G2 unsigned change-set → refused at pipeline entry; G3
tampered edit content (sig mismatch) → refused; G4 a change-set targeting the gate/pipeline
code itself → allowed to PROPOSE (policy level) but flagged `self-referential: true` in the
notification — the operator sees it for what it is; G5 savant session flooding (feeder bug) →
rate limit: ≤N proposals/day, excess GATED as a batch, ledgered.
**T6 soak:** savant on its real cadence (e.g. daily session) for 7 days across live Phase-1/2
traffic. Pass = every emission schema-valid, cited, gated; zero write events outside
OUT_OF_SCOPE (audited from fs events + git status); no proposal storms.
**Ops slices:** `fed.savant.*` probes (feed freshness, session cadence, gate backlog);
`savant` notification source; MC change-set review view (rationale, telemetry refs, diff
render, approve/reject buttons writing the operator verdict back).
**T7 acceptance — Phase-3 exit gate = plan-done (ROADMAP):** 5.4's real cycle reviewed by the
operator; at least one approved change-set has been implemented through normal scope/commit
discipline and its `expected_evidence` probe observed true — the loop closes: the system
improved itself *through* the operator, never around them.

---

## Cross-phase rules

1. **Phase gates are hard.** A later phase's first step's Needs includes the earlier phase's T7
   checklist — plan-lint's Needs pre-screen makes skipping structurally visible.
2. **Every T3/T5/T6 claim is evidence-backed** (KV excerpts, ledger lines, snapshots quoted in
   audits) — never "the test passed" alone (MASTER_PLAN §4.7/§5).
3. **The single-GPU budget is a scheduling law:** at most one live-LLM session per host;
   management dispatch serializes T4 work; soaks use mock LLM except where the step says
   otherwise.
4. **Consumer-hardware ceilings are measured, not assumed:** RAM/CPU recorded at each phase's
   soak start; a phase that doesn't fit the box forces a documented DECISION (shared-process
   agents, smaller grappes), never a silent quality drop.
5. **Everything ships through install.sh as it lands** (a fresh node can always reproduce the
   current phase — the 2026-07-05 deploy-parity discipline).
