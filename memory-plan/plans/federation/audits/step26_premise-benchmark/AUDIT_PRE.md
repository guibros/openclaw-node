# AUDIT_PRE — Step 2.6 · PREMISE BENCHMARK: adversarial grappe vs solo OpenClaw, blind

## §0 Micro Re-Orient

- **Where:** Block 2 exit. 2.1–2.4 closed (2.4: OpenClaw-worker premise demonstrated, operator
  ACCEPTED). 2.5 [D]. This step is the plan's go/no-go: D3 makes a failed benchmark a PLAN-LEVEL
  BLOCK, not a step failure.
- **The question:** is a grappe-of-OpenClaws artifact observably better than a solo OpenClaw's —
  same model, same harness, same task — by enough to justify ~10–20× the tokens and wall-clock?

## §1 Design

**Solo baseline:** the SAME mesh-agent code path, no collaboration — a task submitted without a
`collaboration` spec is claimed and executed solo by one harness-loaded OpenClaw worker
(rules + role + memory injected; identical prompt scaffolding minus circling directives).

**Grappe arm:** circling_strategy, `max_subrounds: 1` (finding 13: one work→review→integrate cycle
keeps a session inside real step budgets), automation_tier 1, 3 workers, launchd daemon (30-min
step budget).

**Fairness rules:** same task text verbatim both arms; same provider/model (claude/sonnet); arms run
back-to-back (no code changes between); grappe final workArtifact vs solo result artifact compared.

**Blinding:** `bin/fed-benchmark.mjs blind` shuffles each pair to A/B with a coin flip, strips
role/session/vote markers, writes `pairs/<task>/A.md`+`B.md` for scoring and `key.json`
(A/B → arm mapping) which the operator does NOT open until all scores are recorded.

**Rubric (pre-agreed, 1–5 each; per task the higher TOTAL wins):**
1. Correctness — claims match the real code/files (spot-checkable).
2. Completeness — all parts of the task addressed.
3. Evidence — file:line grounding, verified-vs-asserted honesty.
4. Actionability — could be applied as-is.
5. Defect discovery — real problems found beyond the literal ask.

**Verdict rule:** grappe must win a CLEAR MAJORITY of tasks (≥4/5, ties count against) or the
premise fails → BLOCKED.md at plan level per D3. Cost delta (wall-clock + approx tokens per arm)
recorded regardless — a narrow quality win at 20× cost is a finding, not a pass.

## §2 Candidate tasks (≥5, real, text-artifact, small — OPERATOR CONFIRMS/EDITS before runs)

1. **spec-f1f2f4** — harden FEDERATION_SPEC F1/F2/F4 (the 2.4 task; grappe evidence exists, solo
   arm + fresh grappe arm rerun under benchmark conditions for fairness).
2. **collab-mode-gap** — design note + patch plan for the COLLAB_MODE constants gap
   (cooperative/collaborative/management missing, lib/mesh-collab.js:29-34) the 2.4 reviewers found.
3. **verify-nodeid-gap** — analysis + fix proposal for strict verifyEvent reading event.node_id vs
   envelopes carrying signer_node_id (always-fails path the 2.4 reviewers found).
4. **deploy-doc-quickstart** — rewrite MULTI_NODE_DEPLOY.md Part 1 against the current installer
   reality (rendered configs, single-node bus default, seat-the-mind step).
5. **fed-probe-spec** — draft the node-watch `fed.*` probe family spec (6.3's design input):
   probes, states, honesty rules, notification sources.

## §3 Cost budget (operator-visible)

Per task ≈ 1 solo run (1–3 claude calls, ~5–10 min) + 1 grappe run (~10–14 calls, ~25–40 min
wall-clock, single sub-round). Five tasks ≈ 60–80 claude calls total against the subscription,
spread over ~3–5 h wall-clock (arms sequential). Runs are resumable task-by-task; nothing requires
one sitting.

## §4 Verify contract (from INVENTORY)

`visual:` operator blind-scores ≥5 pairs on the rubric; `runtime:` all sessions/tasks observable in
KV with the artifacts non-trivial; cost delta recorded. Pass → 3.5's gate input; fail → plan BLOCK.

## §5 Mid-implementation findings

(to be filled as runs execute)
