# Heartbeat Protocol (20-min interval)

This file is the SINGLE SOURCE OF TRUTH for heartbeat behavior.
AGENTS.md points here. All heartbeat logic lives here.

---

## When to Reach Out (report to Gui)

- Important email arrived
- Calendar event coming up (<2h)
- Something interesting you found
- It's been >8h since you said anything
- Maintenance flagged warnings that need attention

## When to Stay Quiet (respond HEARTBEAT_OK)

- Late night (23:00-08:00) unless urgent
- Human is clearly busy
- Nothing new since last check
- You just checked <30 minutes ago

## Heartbeat vs Cron: When to Use Each

**Use heartbeat when:**
- Multiple checks can batch together (inbox + calendar + notifications in one turn)
- You need conversational context from recent messages
- Timing can drift slightly (every ~30 min is fine, not exact)

**Use cron when:**
- Exact timing matters ("9:00 AM sharp every Monday")
- Task needs isolation from main session history
- One-shot reminders ("remind me in 20 minutes")
- Output should deliver directly to a channel without main session involvement

---

## MANDATORY: Memory Maintenance (every heartbeat)

1. Run `bin/memory-maintenance --force --verbose`
2. Read `.tmp/maintenance-results` — if any warnings, report to Gui
3. Specific attention:
   - ARCHIVAL: daily files >30 days → archived automatically
   - PREDICTIONS: open >7 days → expired automatically
   - STALE_TASKS: running >24h → flagged
   - MEMORY_STALE: MEMORY.md >7 days old → needs manual update (do it NOW)
   - MC_SYNC: Mission Control memory index refreshed
   - ERRORS_STALE: pending errors >14 days → need resolution
4. If MEMORY_STALE flagged: update MEMORY.md immediately (move Active→Recent, add recent work)

## MANDATORY: Fact Extraction (every heartbeat if MC running)
**Requires LLM — cannot be automated in bash. Run inline during heartbeat.**

1. Check if Mission Control is running: `curl -s localhost:3000/api/tasks`
2. If running, check last flush: `curl -s localhost:3000/api/memory/flush`
3. If last flush > 24 hours ago OR no flush ever:
   a. Read today's daily file (`memory/YYYY-MM-DD.md`)
   b. Extract atomic facts using write gate rules (AGENTS.md)
   c. POST extracted facts to `localhost:3000/api/memory/items`
   d. POST to `localhost:3000/api/memory/flush` to record the flush
4. If MC not running, skip silently

## Active Job Monitor
1. Read `memory/active-tasks.md` — check for any task with status `running`
2. If running task exists, check its `next_action` and report status
3. If blocked, report the blocker
4. Check `git status` in project dirs for uncommitted work
5. Report findings concisely

## Skill Quality Check (weekly)
- Run `bin/skill-quality-check` to compare against last audit
- If regressions found, report them
- Otherwise, skip silently

## Routing Eval Baseline (monthly, 1st of month)
- Run `bin/skill-routing-eval --compare .tmp/last-routing-eval.json`
- If accuracy dropped or new conflicts appeared, report them
- Refresh baseline: `bin/skill-routing-eval --baseline`
- Otherwise, skip silently

## Proactive Scan
1. Run `bin/proactive-scan --dry-run`
2. If triggers found:
   - `stale_task`: Check on the running task, escalate if needed
   - `uncommitted_work`: Review and commit if appropriate
   - `circuit_recovery`: Consider probe delegation to recovered soul
3. Only spawn agents for triggers that align with active project priorities

## Security Gate
- Pre-commit hook active: `bin/hooks/pre-commit`
- Any skill change auto-scanned before commit
- Setup: `git config core.hooksPath bin/hooks`

## Mesh Health
1. Run `mesh health --json --all` silently (if mesh available)
2. If any node degraded/down: `mesh repair --all`, retry, log if still broken
3. If 3 consecutive failures: escalate to user

## Proactive Work (safe to do without asking)

- Read and organize memory files
- Check on projects (git status, etc.)
- Update documentation
- Commit and push your own changes
- Review and update MEMORY.md
- Run `bin/proactive-scan` to discover actionable triggers
- Act on stale tasks (check status, escalate blockers)
- Commit clean uncommitted work in project directories
- Probe recovered souls via delegation (circuit breaker half-open)

## Prediction-Outcome Calibration

**Log:** `memory/predictions.md`

Before significant decisions, write a structured prediction:

```
### YYYY-MM-DD — [decision name]
**Decision:** What you chose and why
**Prediction:** What you expect to happen
**Confidence:** High / Medium / Low
**Outcome:**
**Delta:** [what surprised you]
**Lesson:** [what to update in your model]
```

**When to predict:** New tool/pattern adoption, delegation to untested soul, architectural choices with uncertain outcomes.
**When NOT to predict:** Routine tasks, obvious outcomes, one-off questions.

**Closing predictions (during maintenance):**
1. Scan for open predictions older than 7 days
2. Fill in Outcome/Delta/Lesson if result is observable
3. Mark `[expired — no signal]` if untestable
4. Watch for systematic overconfidence or complexity underestimates

## Current State
- Memory maintenance: AUTOMATED via auto-checkpoint (every 30min) + heartbeat (every 20min)
- Principle 11 active: all structural systems must be automated
- Skill Quality Engineering: complete (Phases 1-6)
- Routing eval baseline: 95.9% accuracy, 29 conflict pairs
- Security gate: active via core.hooksPath

# Mesh Health (add to ~/.openclaw/workspace/HEARTBEAT.md)

## Mesh maintenance check

Every heartbeat, verify the mesh is operational:

1. Run `mesh health --json --all` silently
2. Parse the JSON — check if `overall` is `"ok"` for each node
3. If any node shows `"degraded"` or `"down"`:
   a. Run `mesh repair --all`
   b. Wait 10 seconds, then `mesh health --json --all` again
   c. If still broken, append a timestamped entry to `~/openclaw/shared/mesh-incidents.log`:
      ```
      [2026-03-02T14:30:00Z] UNRESOLVED: ubuntu/nats_server down after repair attempt
      ```
   d. If the issue persists across 3 consecutive heartbeats, escalate:
      send a message to the user noting which services are down and what was tried.
4. If all healthy: HEARTBEAT_OK (no output needed)

**Priority**: Run this check BEFORE any task that involves the remote node.
If mesh is unhealthy, do not delegate work to the remote node — do it locally or queue it.
