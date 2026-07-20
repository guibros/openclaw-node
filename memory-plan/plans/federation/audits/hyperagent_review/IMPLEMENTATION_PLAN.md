# HyperAgent Implementation Plan — from substrate to evidence (2026-07-20)

Basis: DEEP_REVIEW_2026-07-20 (post-remediation verdict: "ready to collect evidence, not ready to
claim improvement"), D13 (human-gated, no autonomy language), D11 (workers are advanced-LLM
OpenClaws), current INVENTORY (Block 2 closed incl. 2.6 premise ACCEPTED; 3.5 Phase-1 gate [A]).
Substrate landed + CI green at 1c6da97.

## The organizing insight

The review's gate 1 (≥20 real mesh tasks before any tuning) and step **3.5** (Phase-1 operational
testing: T3 matrix, 8-cell chaos, ≥12h soak — already [A]) are **the same execution window**. Every
real session 3.5 runs now writes telemetry mechanically. One program, two deliverables: the
Phase-1 gate evidence AND HyperAgent's first meal. No separate task budget.

## Steps (proposed INVENTORY rows, Block 5 extension)

| Step | Status | Description |
|---|---|---|
| 5.6 | [ ] | HyperAgent evidence run — fused with 3.5's operational program: ≥20 real mesh tasks, ≥2 domains, D11 workers; evidence report (strategy hit rate, failure taxonomy, reflection usefulness); NO threshold tuning before this data exists |
| 5.7 | [ ] | Surface the gate — MC read-only proposals/evidence page + `hyperagent` openclaw-notify source fired on pending-proposal creation; approval stays CLI-only (D13) |
| 5.8 | [ ] | Local-lane decision (OPERATOR) — mechanical local telemetry at the session-stop hook boundary, or document HyperAgent as mesh-only; both options costed below |
| 5.9 | [D] | Causal trial protocol — explicit treatment application, assignment, strata, predeclared decision rule (D13 requires its own design + gate); deferred until 5.6 shows the observational loop produces plausibly-useful proposals |
| 5.10 | [D] | Taxonomy guard — controlled domain vocabulary; deferred until 5.6 shows fragmentation |
| 5.11 | [ ] | Retention policy — size-capped archival for ha_telemetry/ha_reflections; scheduled AFTER 5.6 so real growth rates inform the caps |

### 5.6 — Evidence run (the decisive step)
**Needs:** operator-picked task list (≥20 real tasks, ≥2 domains — D11 workers mean real API
spend; the 3.5 soak feeder is the vehicle); 3.5's execution window.
**Feeds:** the 5.9/5.10 go/no-go; threshold calibration; 5.1's federation-feed design gets real
local data shapes.
**Verify:** `runtime:` ha_telemetry ≥20 rows from real sessions spanning ≥2 domains; ≥1
daemon-created reflection observed (threshold crossing in the wild); evidence report in audits
with hit-rate/failure/taxonomy tables. `visual:` operator reads the report and rules on 5.9/5.10.

### 5.7 — MC surface + notification
**Needs:** open mc-build-and-agent-frontend batch; existing openclaw-notify source pattern;
drizzle stub reconciliation (schema.ts table is mismatched vs ha_proposals — fix or drop).
**Verify:** `runtime:` a seeded pending proposal renders on the page and fires ONE ledgered
notification; `code:` no approve/reject mutation path exists in MC (grep + route inventory —
the gate stays CLI).

### 5.8 — Local-lane decision (operator choice, prepared options)
(a) **Mechanical local**: wire telemetry at the session-stop hook (deterministic boundary; outcome
heuristics from session state; ~1-2 days incl. tests) — local sessions train the loop;
(b) **Mesh-only**: one doc paragraph; local rules removed from harness injection (token savings on
every prompt). Recommendation: (b) now, revisit after 5.6 — the mesh path is where structured
outcomes exist; local outcome inference is guesswork until the companion lane is a real executor.

## Repo hygiene surfaced by the remediation's verification (separate, small)
- `--dry-run` observed attempting a direct config write on this host — repro + guard, belongs to
  the open item5-small-batch.
- embed-benchmark still flaky in the 5–18 load band (1866ms observed under moderate load) —
  per-environment budget (env var) or threshold rework; same batch.

## Standing constraints
D13 language discipline everywhere (observe ≠ A/B; no self-modification claims). D11 worker
contract for every 5.6 task. No INVENTORY inscription of these rows until the operator approves
this plan.
