# DECISIONS — foreman plan (append-only)

Architectural decisions for this plan. Newest at bottom. Never rewrite an entry; supersede with
a new one.

Entry shape: **Decision** (what was chosen) · **Why** (the constraint or evidence that forced it)
· **Consequences** (what this commits us to / rules out).

---

## D1 — Adopt Foreman's assess/decide split over mesh workers, as a library inside the agent, shadow-first (2026-09-21, operator instruction "integrate the Foreman tech")

**Decision.** Port the supervisory design of `thruwire/foreman` (reviewed 2026-09-19, seven
findings, fixes rebased on its `a7d21d1`) into `lib/foreman/` and wire it into
`bin/mesh-agent.js` at `runLLM`/`executeTask`: a debounced observer builds a bounded snapshot of
the worker (output tails, `git status`/diff in the task worktree, elapsed, attempt, prior
decision); a fast assessor answers the same ten fixed yes/no questions with probabilities; a
deterministic, pure policy maps (state, assessment) → one of CONTINUE · STEER_WORKER ·
STOP_WORKER · RETRY_WORKER · START_VERIFIER · START_WORKER · FINISH · ESCALATE in a fixed
safety-first precedence. Default mode is **shadow**: decisions are recorded to a per-task JSONL
timeline and `mesh.foreman.*` bus events and not enforced; enforcement is a later block behind
`MESH_FOREMAN_ENFORCE=1` through the supervisor's `onIntervention` seam.

Three rules from the review are baked in rather than inherited: the intervention ceiling counts
actions other than CONTINUE (never assessments — upstream's ceiling killed healthy workers at
~100s); only a verifier that ran after the latest coding pass and PASSED satisfies the completion
gate; a rejected steer is retried and does not spend the steer budget.

**The assessor.** The local model through the existing analysis lane
(`lib/llm-client.mjs` `generateAnalysis` → `ollama-queue` `requestAnalysis`): short wait ceiling,
small output, JSON mode only where `useJsonFormat` says it is safe. **An unavailable assessor
degrades to passthrough — no assessment, no decision, the worker runs as it does today.** This
inverts upstream Foreman, which escalates on model failure; there Foreman is the only gate, here
the metric, harness and review gates stay downstream, so killing healthy work over an Ollama
outage would be strictly worse than not supervising.

**Why.** (1) Federation D16 ruled consensus gating dead and defined federation as a deterministic
pipeline; Foreman is a working instance of exactly that shape, and the management layer (Block 4
there) never started. (2) MASTER_PLAN §4.6 forbids a sibling daemon — the supervisor lives where
the worker's stream, worktree and lifecycle already are, in-process, which is also Foreman's own
architecture. (3) MASTER_PLAN §5 and this repo's evidence culture: a supervisor that can stop
workers must first prove, on real work, that its decisions are sane. Shadow mode is that proof and
doubles as the calibration substrate the hyperagent-evidence plan needs.

**Consequences.** `MESH_FOREMAN=0` disables supervision entirely; on by default because shadow
mode cannot alter a task's outcome. Timelines live in `~/.openclaw/foreman/` (`MESH_FOREMAN_DIR`),
one JSONL per task, lifecycle + assessments + decisions only (never per-output-line — measured
upstream at one full state rewrite per line). The worker for `claude -p` has no live input
channel, so `supports_steering` is false and drift/stuck resolve to STOP in shadow; a steerable
backend flips one flag. The metric result is recorded as this pipeline's verification signal, so
the verification gate has a real input from day one. `FINISH`/`START_WORKER` are advisory here —
the agent's attempt loop and the daemon's review own completion; enforcement (Block 2) maps STOP
onto the process group and ESCALATE onto release, nothing else.

## D2 — Enforcement is the default, not a later gate; the verifier pass owns no-metric completion (2026-09-21, operator instruction "implement the thing")

**Decision.** `MESH_FOREMAN_ENFORCE` defaults to on. The supervisor terminates the worker's process
group itself on STOP_WORKER and ESCALATE (SIGTERM, then SIGKILL after `MESH_FOREMAN_STOP_GRACE_MS`);
`bin/mesh-agent.js` spawns workers `detached` so the whole tree ends, records a stopped attempt as
`stopped by Foreman — <reason>` with the steering guidance as its result (which `buildRetryPrompt`
already renders), and on ESCALATE stops spending attempts and releases the task with the reason.
After a coding worker exits cleanly on a task with **no metric**, the agent asks the supervisor for
its post-exit decision (`assessNow()`): START_VERIFIER runs an independent, read-only verification
worker whose `FOREMAN_VERDICT: PASS|FAIL` line gates completion (FAIL or no verdict → failed attempt
with the findings → retry); ESCALATE releases. Tasks **with** a metric are verified by the metric —
the supervisor's post-exit decision is advisory there, and a passed metric wins.

**Why.** D1's shadow-first posture was the agent's caution, not the operator's requirement; the
operator ruled that integrating Foreman means the supervisor acts. The safety argument still holds
in the other direction: a false STOP costs one attempt (the loop retries with guidance), repeated
ones end in the pipeline's existing *released* state for human triage, and an unavailable
assessor is still a passthrough — so the worst case of enforcement is bounded by machinery that
already exists, while the no-metric path today completes on nothing but the worker's own word.

**Consequences.** Shadow mode remains one switch away (`MESH_FOREMAN_ENFORCE=0`) and the
timelines record `mode` per decision, so calibration (Block 3) reads enforced and shadow runs
alike. Steps 2.1 and 2.2 shipped in one commit on this instruction — a deliberate departure from
one-step-per-commit, recorded here rather than hidden. Step 1.2 (first live timeline on the
operator's node) is unchanged in substance: deploy, run a task, read the file.
