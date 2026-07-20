# DEEP REVIEW — HyperAgent Protocol (2026-07-20, operator-requested)

Two-pronged: full code-surface inventory (subagent, file:line-cited) + runtime ground truth
(orchestrator, live DB/log/process probes). Verdict first, evidence after.

## Verdict

**A well-built engine that has never run.** The persistence layer and CLI are solid (656-line
store, 5 sound tables, 28 passing unit tests, clean CAS-free single-writer design). But in ~6
weeks of production existence the loop has produced: **1 telemetry row, 0 strategies, 0
reflections, 0 proposals.** Every autonomous claim in the README fails against runtime evidence.
The design's fatal flaw is architectural, not a bug: **every entry point into the loop is
soft** — injected prompt text politely asking an LLM to shell out to a CLI — while the one place
that could feed it deterministically (mesh task completion, which KNOWS outcome/iterations/
duration) writes nothing. Starvation was inevitable, not incidental.

## How it is supposed to work (7 stages, per README + code)
task completes → (1) agent logs telemetry via CLI → (2) store records + pattern flags →
(3) daemon sees ≥5 unreflected, triggers `reflect` → (4) agent synthesizes hypotheses →
proposals → (5) human approves via CLI → (6) approval applies to strategy archive →
(7) next task consults strategies.

## Stage-by-stage runtime status
| Stage | Status | Evidence |
|---|---|---|
| 1 Telemetry | SOFT, starved | only mechanism = injected rule text (harness-rules.json:142); 1 row ever (2026-07-15) |
| 2 Record | WORKS | store+flags tested; the 1 row is well-formed |
| 3 Reflect trigger | LATENT-BROKEN | daemon checks fine (:1004) but would spawn `~/.openclaw/bin/hyperagent.mjs` — a path NOTHING creates (installer rsyncs repo bin → `~/openclaw/bin`, workspace copies exclude it); currently unreachable anyway (1 < 5) |
| 4 Synthesize | SOFT + upstream-dead | CLI paths sound; requires a reflection row that stage 3 can't produce |
| 5 Approve | CLI-only | no UI; MC has a mismatched, never-queried Drizzle stub (schema.ts:259, "deferred") |
| 6 Apply | HALF | strategy_new/update apply; `harness_rule`/`workflow_change` approvals are inert no-ops |
| 7 Consult | SOFT | injected rule text; `getStrategy()` best-match API has zero production callers |
| Shadow eval | DORMANT | start is manual-only; expiry flips back to 'pending'; eval_result never surfaced; 'expired' enum unreachable |

## Hard defects found
1. **Daemon reflect subprocess path** (memory-daemon.mjs:1007): `~/.openclaw/bin/hyperagent.mjs`
   exists on no machine; the only `.openclaw/bin` reference in the whole repo. Fails silently in
   the shared catch when reached.
2. **checkShadowWindows starved**: same try-block as the reflect spawn — any reflect throw skips
   window expiry too.
3. **activateOn ignored**: all 3 harness rules inject into EVERY prompt
   (mesh-harness.js:414 filters only type==='inject') — lifecycle phases in the rule metadata are
   decoration; token cost on every mesh prompt.
4. **Inert proposal types**: CHECK enum admits harness_rule/workflow_change; approval flips
   status with zero effect — "approved" lies.
5. **Doc drift**: README:191 "fully autonomous except approval" (three stages are LLM-compliance
   prayers); README "self-modifying" (only ha_strategies rows, never rules/code);
   OBSERVABILITY.md §10 documents 7 API names that don't exist (getStrategies/addStrategy/
   submitProposal/endShadowEval/…).
6. Cosmetic: components.sh:393 creates unused `~/.openclaw/state/` DIR next to the real
   `state.db` FILE; MC drizzle stub table name/shape mismatched vs ha_proposals.

## Critique of the design itself
- The maker/checker instinct is right (proposals human-gated) but the loop confuses "agents are
  instructed to" with "the system does." A telemetry pipeline whose only producers are polite
  requests to LLMs is a wish, not a loop. The deterministic producer is sitting RIGHT THERE:
  mesh-task-daemon knows task outcome, iterations, duration at completion time and could call
  logTelemetry in-process — no CLI, no LLM compliance.
- The reflection threshold (≥5) plus a starved producer means the trigger has been mathematically
  unreachable for six weeks; nothing surfaced this because every failure path is silent and no
  watcher axis covers the subsystem (node-watch has no hyperagent target).
- Shadow evaluation — the most interesting idea in the design (A/B a proposed strategy against a
  telemetry window) — is unreachable end-to-end.
- Three divergent copies exist (repo bin, ~/openclaw/bin Mar-31 fossil, and the store lib) — the
  installer initializes via the fossil.

## Corrections applied in this batch (mechanical, high-confidence)
A. Daemon spawns the CLI from the workspace deploy (`$WORKSPACE/bin/hyperagent.mjs`);
   workspace.sh's explicit copy list now deploys it there (same pattern as memory-daemon/
   flush-worker). Wiring-manifest row locks the pairing.
B. checkShadowWindows moved out of the reflect try-block — window expiry survives reflect
   failures.
C. putProposal rejects the two inert proposal types loudly (validation error at write time)
   until apply logic exists — approval can no longer silently lie. CHECK enum untouched
   (existing rows/compat); README documents the constraint.
D. components.sh: unused state-dir mkdir dropped.
E. README HyperAgent section rewritten to runtime truth (soft vs deterministic stages, CLI-only
   gate, strategy-rows-only apply); OBSERVABILITY §10 API names corrected to the real surface.

## NOT done — the operator decision (ledgered)
The invest-vs-retire call: (i) INVEST = deterministic telemetry from mesh-task-daemon completion
+ a node-watch axis + surface eval_result + MC page — the loop becomes real for grappe work;
(ii) RETIRE to a manual strategy notebook (keep store+CLI, delete the daemon block and rules);
(iii) PARK as-is (now honest, still dormant). Recommendation: (i) is only worth it once grappes
run real workloads regularly (Block 2/3 reality) — until then the loop has nothing meaningful to
learn from; park with honest docs, revisit at the 2.6 premise decision.
