# OUT_OF_SCOPE — foreman plan

Agnostic-spec capture of things observed while working this plan but not acted on (MASTER_PLAN
§4.3). WHAT + WHY, never HOW — no prescribed solution, no code excerpts. Always-writeable
regardless of scope. Reviewed at scope-closing checkpoints: each entry gets promoted into
SCOPE.md, escalated into INVENTORY.md, archived as won't-fix, or deferred forward.

Format per entry: date · area/file · one-line problem · severity guess · next-touch pointer.

---

Observed 2026-09-26 while remediating the audit of main (D3, `audits/remediation_2026-09-26/`):

- **2026-09-26 · `bin/mesh-agent.js` verifier pass / `lib/llm-providers.js` claude args** — the
  verifier's read-only check covers only the task worktree; the verifier runs with the same broad
  permission mode as a coding worker, so writes outside the worktree (other paths under the
  operator's home, the shared workspace checkout) are neither detected nor reverted. Matters
  because a "report only" pass is trusted as independent evidence. · medium · whoever next scopes
  2.2's runtime Verify.
- **2026-09-26 · verifier on non-agentic providers** — a provider that accepts a prompt but cannot
  read files or run commands (a bare local model, e.g. `ollama run`) passes the gate's mechanics
  while judging only the prompt text; its verdict is not a verification of the tree, yet it can
  complete a no-metric task. · medium · 2.2.
- **2026-09-26 · `lib/foreman/policy.mjs` `needs_human` precedence** — a single assessment with
  `needs_human` ≥ 0.80 escalates, and in enforce mode that terminates the running worker and
  releases the task; the STOP hysteresis added by D3 does not cover this path, so one noisy
  sample can still end a healthy worker. · medium · 2.1 / Block 3 calibration.
- **2026-09-26 · `claude -p --output-format text` worker** — the CLI emits nothing until it
  finishes, so the assessor's output tails are empty for the whole run of a healthy claude
  worker; the tree snapshot is the only progress signal it gets. Matters for assessment quality
  and for how soon hysteresis can confirm a stop of a reading-heavy worker. · low–medium · Block 3.
- **2026-09-26 · `bin/mesh-agent.js` Foreman stop handling** — `state.escalation` is sticky for the
  whole task: once any cycle escalated (including an advisory post-exit escalation on a metric
  task), a later ordinary STOP of any attempt is treated as an escalation and releases the task
  instead of retrying it. · low · 2.1.
- **2026-09-26 · `bin/mesh-deploy.js` `services` component** — `mesh deploy --include-services`
  copies the unit templates as-is, so their `${VAR}` placeholders (now including
  `${MESH_FOREMAN_ENFORCE}`) reach `~/Library/LaunchAgents` / the systemd dir unrendered; only
  `install.sh` and `openclaw-node-init` render them. Matters because the Foreman switch is set
  through the rendered unit. · medium (pre-existing, noted in `OPENCLAW_AUDIT_SUMMARY.md`) ·
  deploy owner.
- **2026-09-26 · `workspace-bin/plan-lint.sh foreman`** — the silo lints NONCONFORMANT on main:
  `automation.json` and `tick-logs/` are missing, so the Automation/Live/History surfaces are
  dead for this plan. · low · protocol plan.
- **2026-09-26 · local `npm test` on the operator's macOS node** — three failures on unmodified
  `origin/main` (df503b3), none in Foreman code: `circling-adaptive-convergence` (ENOTEMPTY while
  removing the NATS JetStream temp dir), `install.sh --dry-run writes nothing under $HOME` (the
  Command Line Tools python writes `.pyc` caches under the temp `$HOME/Library/Caches`),
  `plan-protocol` "blocks a listed path that is a symlink escaping the repo" (the hook exits 0
  where the test expects 2: the fixture checkout sits under the default macOS TMPDIR, `/var` →
  `/private/var`, so its lexical path never matches the hook's physical `pwd -P` repo root and the
  escaping symlink is waved through as a non-repo file; with a non-symlinked TMPDIR it passes —
  reproduced 2026-09-26. This repo's own path has no symlink, so the refusal holds here; it fails
  open only for a checkout that itself lives under a symlinked path). CI (Linux) is the green
  reference; locally the suite cannot be green as-is. · low · protocol / test infra.

Observed 2026-09-27 in the independent review of PR #32 (`PR_REVIEWS_29-33_2026-09-27.md`), still
open after its must-fix commit; review numbering in brackets. Sticky escalation (cloud #7) is the
2026-09-26 entry above.

- **2026-09-27 · `lib/foreman/supervisor.mjs` `terminate` (cloud #9)** — a STOP signals the
  worker's process group only while the group leader is alive: once the leader (the CLI) has
  exited, the stop reports "already exited" and whatever it left running in its group (test
  runners, dev servers, sub-agents) keeps running against the worktree. Reproduced in the review.
  · medium (enforce) · 2.1.
- **2026-09-27 · `bin/mesh-agent.js` `runLLM` `detached: true` (cloud #10)** — every worker leads
  its own process group in every mode, shadow and `MESH_FOREMAN=0` included, where nothing ever
  signals that group. When the agent itself is stopped (a launchd unload on deploy), a detached
  CLI is outside the agent's group and is suspected to be orphaned on macOS, still working in the
  task worktree (not reproduced on a Mac). So "a node that never sets the variable behaves as
  before Foreman" (D3, AUDIT §5) does not fully hold. · medium · deploy owner / 2.1.
- **2026-09-27 · `lib/foreman/assessor.mjs` prompt size (cloud #11)** — every observation field is
  tail-bounded but the serialized observation as a whole is not, and the analysis request sets no
  context window (`num_ctx`): the review measured the assessor prompt growing from 28,293 to
  156,668 characters, far past a default local-model context, so the model judges only what fits.
  Applies in shadow too and weakens the 1.2 / Block 3 calibration timelines. · medium · Block 3.
- **2026-09-27 · `lib/foreman/supervisor.mjs` scheduler (cloud #12)** — while a cycle is in
  flight every tick re-arms itself, and once an event is pending the computed delay is zero, so
  the loop spins on zero-delay timers for the length of each assessment (review probe: 2,596
  timers, 2,495 of them zero-delay, in 8 s). Applies in shadow; CPU on the worker node during every
  assessment. · low–medium · Block 3.
- **2026-09-27 · `lib/foreman/supervisor.mjs` lifecycle event mid-cycle** — a lifecycle event
  (worker started/exited, verification recorded) arriving while a cycle is in flight is dropped,
  not delayed: the in-flight cycle's completion clears the pending flags, and with no worker
  running the idle guard schedules nothing, so the cycle that event should force never runs (the
  agent's own `assessNow()` still covers its decision points). Applies in shadow. · low · Block 3.
- **2026-09-27 · `bin/mesh-agent.js` `commitWorktree` null result** — "nothing to commit" and "the
  commit failed" both return null; both completion paths then report `success: true` with
  `sha: null`, force-remove the worktree and delete `mesh/<id>`, so the work is lost from every ref
  (dangling objects at best). A clean status also follows a coding worker committing its own work
  (read, not run). PR #32 added one more way in, a verifier that commits; its review fix resets
  HEAD after the verifier, which closes that route but not the null path. Pre-existing, not
  Foreman code. · high (silent data loss) · worker completion path — no plan owns it yet.
- **2026-09-27 · `docs/foreman.md` timeline list** — the review fix adds a `foreman.decision_dropped`
  timeline row (enforcing: an assessment that returns after the worker it observed was replaced is
  not acted on); the doc's list of timeline events does not name it yet. · low · next foreman doc
  touch.
