# PREMISE_BENCHMARK — does a grappe of OpenClaws beat one OpenClaw? (step 2.6)

**The question that decides the plan.** Everything past Block 2 assumes an adversarial grappe
produces observably better work than a single node. 2.6 tests that head-to-head, blind. Per
DECISIONS D3, a fail is a plan-level BLOCK, not a step failure — we do not build management/savant
grappes on an unproven premise.

## The design (controlled: only the reviewers vary)

Same task, same model (Claude/sonnet), same harness-loaded OpenClaw, same bus. Two arms:
- **SOLO** — one OpenClaw claims the task and executes it alone (no reviewers).
- **GRAPPE** — three OpenClaws circle it: 1 worker + 2 reviewers, one sub-round
  (`max_subrounds:1` so it closes cleanly — 2.4 finding 13), then finalize.

The harness (`bin/grappe-benchmark.mjs run <task.json>`) submits both, waits, and writes an
anonymized pair (`candidate-A.md`, `candidate-B.md`) with a sealed mapping. You read the task and
both candidates **without knowing which is which**, pick the better one, then `reveal`.

## Protocol

1. Prereqs (the node's own services — NODE_SPEC §6): launchd mesh-task-daemon + bridge up; 3
   mesh-agents running with `MESH_LLM_PROVIDER=claude`.
2. For each of the ≥5 tasks: `node bin/grappe-benchmark.mjs run tasks/<t>.json` → a pair dir under
   `~/.openclaw/benchmark/`.
3. Blind-score each pair on the rubric below (record A or B + one-line why). Do NOT reveal until all
   are scored.
4. `reveal <dir>` each; tally grappe-wins vs solo-wins.
5. **Verdict:** grappe wins a clear majority (≥4/5, or your pre-agreed bar) ⇒ premise PROVEN, Phase
   2/3 unlocked. Else ⇒ write BLOCKED.md citing the miss; the architecture stops here for redesign.
6. Record the GPU/token + wall-clock cost delta (grappe ≈ 3× the calls + reviewer turns) so the
   quality gain is weighed against the cost (D3).

## Scoring rubric (per pair, blind)

| Dimension | A | B |
|---|---|---|
| Correctness (claims true, cites real file:line) | | |
| Completeness (addresses the whole task) | | |
| Caught issues a first draft would miss | | |
| Honesty (no overclaiming; flags its own gaps) | | |
| **Overall better** | ☐ | ☐ |

## The task set (≥5 real, small, checkable — chosen with the operator)

Tasks live as `tasks/<id>.json` (`{task_id_base,title,description,metric}`). Starter set — swap in
your own real work anytime; the point is REAL tasks, not toys:

1. **spec-harden** — the F1/F2/F4 FEDERATION_SPEC defects (already dogfooded in 2.4; a known-answer
   control — we know the right output, so it calibrates the rubric).
2. **collab-mode-gap** — "COLLAB_MODE (lib/mesh-collab.js:29-34) lacks cooperative/collaborative/
   management; propose the constant + dispatch changes." (A real bug the 2.4 grappe itself found.)
3. **nats-resolve-audit** — "Review lib/nats-resolve.js for the token/URL resolution order; find any
   case where a client sends the wrong credential or address." (Real, checkable against the code.)
4. **install-step-order** — "Given docs/NODE_SPEC.md, find any install.sh step whose prerequisite is
   produced by a LATER step." (Ordering correctness — solo often misses cross-references.)
5. **acceptance-gap** — "Does bin/node-acceptance.mjs probe every subsystem NODE_SPEC §5 lists as
   autostart? Name any unprobed one." (Coverage completeness — the kind of thing review catches.)

Rationale for the mix: one known-answer control (calibrates scoring), two code-audit tasks (where
adversarial review theoretically helps most), two doc/coverage tasks (cross-reference checking).
If the grappe doesn't beat solo HERE, the premise is genuinely in doubt.

## Cost note

Each grappe arm ≈ 3 workers × (init + 1 sub-round + finalize) ≈ 6–9 Claude turns of 5–15 min; solo ≈
1–2 turns. A full 5-task benchmark is ~3–4h of Claude compute plus your scoring time. Run it when you
have the budget — it does not need to be one sitting; score pairs as they finish.
