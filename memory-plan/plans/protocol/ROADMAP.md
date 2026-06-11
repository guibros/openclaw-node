# protocol — Roadmap

**Goal.** The workplan operating system itself, made a versioned, instantiable, enforceable base
that every plan iteration inherits instead of hand-copying from the previous plan.
**Created:** 2026-06-03 (retro-documented at step 2.4; Blocks 1–2 were inventoried before their
steps ran — this doc consolidates the block framing per PROTOCOL §1.2).

## Block 1 — The protocol base

- **Intent:** the base exists — one synced rulebook (PROTOCOL.md + hoisted FRAMEWORK_CANONICAL +
  generalized BLOCK_TEMPLATE), one generic chain engine (plan-tick.sh + shim convention), one
  scaffolder (new-plan.sh + canonical/templates/) yielding viewer-valid silos in one command.
- **Exit criterion (runtime-observable):** a scaffolded demo silo is listed by the live viewer
  and tick-preflightable end-to-end; sync `--check` rc 0. [MET 2026-06-03 — commits 519be08,
  5a15329, 5fdf278.]
- **Unblocks:** Block 2 (rules must exist on every surface before they can be enforced).

## Block 2 — Conformance: every plan functionally wires every surface

- **Intent:** the operator directive of 2026-06-03 — each plan functionally implements the six
  viewer surfaces (master-plan, steps, automation, block, documents, history), the 9-phase
  protocol, and extreme step atomization (Goal/Needs/Feeds/Verify) — made written law (§10/§11),
  machine-graded (plan-lint.sh), unavoidable (scaffold + preflight wiring), and obeyed by this
  very silo.
- **Exit criterion (runtime-observable):** `plan-lint.sh protocol` rc 0; conformance line in this
  plan's own preflight reads CONFORMANT. [MET at 2.4 close — see step evidence.]
- **Unblocks:** terminal for now. Future blocks (operator-scoped): retiring the historical
  per-plan tick scripts onto the generic engine; contract retrofit for repair's 29 open rows;
  cross-plan pipelines (COWORK_MODEL §5).
