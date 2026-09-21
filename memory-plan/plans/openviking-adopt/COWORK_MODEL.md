# COWORK_MODEL — the workplan system as a local Claude-cowork analogue

**Canonical doc.** Authored in `memory-plan/canonical/`, recopied into every plan by
`workspace-bin/sync-canonical.sh`. Applies to all plans equally.

**Purpose.** This workplan system is a **local, operator-controlled equivalent of a Claude
"cowork" scheduled task**: an agent iterates through a structured plan, one task at a time,
with provisioned resources (north-star doc, 9-phase procedure, per-step contract), on a
schedule, reviewable by a human — but run locally, parameterized locally, and chained into a
pipeline that cowork itself does not natively offer. Keep it **light on resources** (we are
already inside a VM): the cost is one headless `claude` invocation per tick — no extra sandbox VM.

---

## 1. What cowork actually is (grounded, May 2026)

"Claude Cowork" is a UI wrapper, not one architecture. It sits over two execution models:
- **Claude Code** (local CLI) — `/schedule` cron tasks run on your machine.
- **Managed Agents** (cloud REST) — an *agent definition* (`model + system_prompt + tools + skills + mcp`)
  plus an *environment* (sandbox type, packages, mounts, network, vault), driven as stateful sessions.

On *this* machine, Cowork Desktop spins up a **local VM sandbox** per task
(`~/Library/Logs/Claude/cowork_vm_node.log` → loads the `@ant/claude-swift` VM module;
per-task state under `~/.claude/tasks/<uuid>/`). Cowork has **no native multi-step pipeline** —
chaining is either in-session subagents or orchestration you build at the REST layer.

## 2. The mapping — cowork ↔ this system

| Cowork concept | Our implementation |
|---|---|
| Agent definition (system prompt + tools + skills) | `CLAUDE.md` bootstrap + `MASTER_PLAN.md` (north star) + `WORKFLOW.md` (9-phase) + `.claude/hooks/scope-check.sh` |
| Environment / sandbox | the live repo + `~/.openclaw/workspace` runtime (we deliberately do **not** add a per-task VM — stay light) |
| A single task | one `INVENTORY.md` step + its `SCOPE.md` contract + `TICK_PROMPT.md` (the recurring prompt) |
| Scheduler (cron) | launchd plist (`ai.openclaw.<plan>-tick`) firing the tick script on an interval |
| Pipeline / chaining | the **INVENTORY walk**: each tick does the first open step; the next tick does the next — a within-plan task DAG |
| Outputs / lifecycle | `audits/` (AUDIT_PRE/POST), `tick-logs/`, one git commit per step, the `VERSION` carrier, `COMPONENT_REGISTRY.md` |
| Done-contract | **runtime-observable** (stricter than cowork's "last message printed") |
| Control surface | `workplan-viewer:7892` — per-plan tabs + automation controls (the local console.claude.com) |

**The plan dir is the portable bundle.** After the silo remaster, a `plans/<id>/` directory is a
complete agent-context bundle (its own MASTER_PLAN, WORKFLOW, FRAMEWORK, DECISIONS, INVENTORY,
SCOPE, TICK_PROMPT). That is the local analogue of a cowork agent+environment definition.

## 3. The chain engine

One generic engine drives any plan: `workspace-bin/plan-tick.sh <id>`, fronted by argv-less
two-line shims `workspace-bin/<id>-tick.sh` (PROTOCOL §7). Its ancestors — the per-plan
`memory-plan-tick.sh` (drove the legacy 58-step plan to completion, 165 ticks) and the
`redesign-tick.sh` copy (32 ticks) — were reduced to shims over the generic engine on
2026-07-04 per MASTER_PLAN §4.6 (no parallel implementations). One tick does exactly one step:

```
launchd fires <plan>-tick.sh every <interval_seconds>
  └─ next_step():   grep first [ ] / [A] row in INVENTORY.md  ── the task
  └─ guards:        BLOCKED.md? dirty tree on clean VERSION? lock held?  → skip
  └─ invoke:        cat TICK_PROMPT.md | claude --print --permission-mode acceptEdits
                       → the agent runs that step's 9-phase, commits, flips [ ]→[x]
  └─ record:        tick-logs/<ts>.log (pretty) + <ts>.jsonl (raw) + current.log symlink
  └─ outcome:       version advanced → digest "closed"; BLOCKED.md written → exit 2 (operator clears)
next tick picks up the new first [ ] → walks down the inventory until none remain
```

Safety that makes autonomous ticks acceptable: single-tick lock (stale-reaped >60min),
dirty-tree guard, `BLOCKED.md` short-circuit, optional `WORKPLAN_AUTOPAUSE` (unload the plist on
trouble), and the TICK_PROMPT's **runtime-evidence gate** — a tick BLOCKs rather than fake-closes.

**Built ≠ running.** For the redesign plan the tick plist is **intentionally unloaded**: Block 0
is runtime-heavy, so it is being driven interactively. Loading the plist (or the viewer's
Automation → run-once / load) is what turns the autonomous chain on.

## 4. How the viewer surfaces a run

- **Steps tab** ← `INVENTORY.md` (status, per-step audit links). The plan as a checklist.
- **Master Plan tab** ← `SCOPE.md` + `COMPONENT_REGISTRY.md` + `DECISIONS.md` + `OUT_OF_SCOPE.md`.
- **Documents tab** ← every `.md` in the plan dir (fully siloed — no reach-up).
- **Live tab** ← SSE `/stream`: a live `tail -f` of the current tick's **pretty** log
  (`tick-logs/current.log`). Raw human-readable agent output.
- **Progress tab** ← SSE `/activity-stream`: the current tick's **raw `.jsonl` stream** parsed
  (`eventToActivity`) into structured activity items (tool calls, messages, results).
- **History tab** ← past per-tick logs. **Automation tab** ← load/unload/kickstart/run-once + params.

**Key point:** Live and Progress are fed **only by tick runs** (the headless `claude` invocations
that write to `tick-logs/`). Interactive sessions (a human driving Claude, like normal work) do
**not** write there, so both tabs stay empty until a tick has run. Empty Live/Progress = "no
autonomous tick has executed for this plan yet," not a bug.

## 5. Built vs paused vs genuinely missing

- **Built & working:** agent contract, siloed portable plan bundles, scheduler, the within-plan
  chain engine, control surface, runtime-evidence done-contract, BLOCK/review.
- **Paused (deliberate):** no tick plist is loaded for any plan — all current work is
  operator-directed interactive batches; loading a chain is an explicit per-plan decision
  (viewer Automation tab). Honest corollary: Live/Progress tabs are empty for interactive work.
- **Genuinely missing / thin:** per-task isolation (we run in the live tree by choice — staying
  light); **cross-plan pipelines** (chaining is within one plan's INVENTORY; plan-A→plan-B
  orchestration does not exist yet).
