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

## D3 — Enforcement is opt-in; enforcing, a no-metric attempt completes only on one well-formed PASS from a verifier that left the tree unchanged (2026-09-26, operator instruction after the audit of main; supersedes D2's default)

**Decision.** `MESH_FOREMAN_ENFORCE` unset — or anything but `1` — is shadow; `1` enforces. The
knob is rendered into the mesh-agent launchd/systemd templates from `openclaw.env` (both
renderers — `install.sh` and `openclaw-node-init` — know it; unset renders empty, which is
shadow). Enforcing, the no-metric gate (`foremanVerify`) no longer keys off the policy's
START_VERIFIER: after a clean coding exit only ESCALATE short-circuits (release); otherwise an
independent verifier always runs, and only **exactly one** line reading `FOREMAN_VERDICT: PASS` or
`FOREMAN_VERDICT: FAIL` counts as a verdict — none, several, or a malformed one is no verdict, and no
verdict fails. The tree is snapshotted before and after the verifier (the tree `git add -A` would
commit, hashed through a scratch index); any change voids the verdict and is reverted. A provider
that cannot take a prompt (`shell`, now `acceptsPrompt: false`) gets no verifier: its exit status 0
is the verification, recorded as `source: "exit-code"` — **operator ruling in session**, chosen over
releasing such tasks fail-closed. STOP needs `stop_confirmations` (3) consecutive warning
assessments of the same worker with the tree unchanged between them — **operator ruling: hysteresis
in**; it needed the git evidence measured against HEAD (staged and new files were invisible). The
supervisor is closed on every exit path of `executeTask` (`superviseTask`), an idle supervisor never
polls, and decisions taken with no worker running never count toward the intervention ceiling.
Steps 2.1 and 2.2 go back to `[A]` and `VERSION` to `v1.1`.

**Why.** The 2026-09-26 audit verified five defects on main (df503b3), all re-checked against the
code before acting (MASTER_PLAN §4.9): (1) `foremanVerify` returned "complete" when there was no
decision and whenever the decision was not START_VERIFIER, so the default path of a no-metric task
was completion without verification — the opposite of what D2, CLAUDE.md and `docs/foreman.md`
claimed; (2) `parseVerdict` took the first `FOREMAN_VERDICT` match, so an early or quoted PASS
before a final FAIL, `PASS/FAIL`, or `PASS or FAIL will follow` all parsed as PASS, and the worker's
own output sat at the end of the verifier's prompt; (3) the "read-only" verifier ran through
`runLLM` with `--permission-mode bypassPermissions` after the harness had already run, and a PASS
led straight to `git add -A` — anything it wrote was committed unchecked; for `shell` tasks the
"verifier" re-ran `task.description`; (4) one assessment at `worker_stuck`/`work_off_track` ≥ 0.8
stopped the worker — no confirmation, a `claude -p --output-format text` worker that prints nothing
until it ends, and git evidence blind to staged and new files; (5) nothing closed the supervisor
when `executeTask` threw, so it kept assessing forever, and idle assessments' advisory decisions
counted toward the 20-intervention ceiling. D2's safety argument ("the worst case of enforcement
is bounded by machinery that already exists") assumed a gate that worked; with it inverted,
enforce-by-default meant stopping workers on single samples while still completing unverified
work. Steps 2.1/2.2 were marked closed with container tests as their evidence, while both steps'
Verify lines are `runtime:` on the operator's node — and 2.1's (`sleep` in a shell task) could not
have run, since the shell filter refuses `sleep`.

**Consequences.** A node that never sets the variable behaves as before Foreman, plus timelines —
the calibration substrate D1 wanted — except that workers are spawned detached in every mode (Known
limits in `docs/foreman.md`). Turning enforcement on is a deliberate operator act per node
(re-render the unit, restart the agent); step 1.2's shadow timeline is its natural input, though no
count of timelines is required by this decision. With enforcement on, a no-metric task costs one
verifier run per attempt, and a node whose worktree cannot be snapshotted cannot complete no-metric
tasks (fail-closed). What the gate still cannot see — a verifier writing outside the worktree, a
verifier on a provider that cannot inspect the repository, single-sample `needs_human` escalation,
a silent `claude` worker — is listed under Known limits in `docs/foreman.md` (the plan's
`OUT_OF_SCOPE.md` was retired by protocol D11). The remediation shipped as one batch
on operator instruction (`audits/remediation_2026-09-26/`); like D2's, a deliberate departure from
one-step-per-commit, recorded here.
