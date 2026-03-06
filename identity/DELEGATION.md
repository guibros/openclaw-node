# Delegation Protocol — Full Reference
# Lazy-loaded by Daedalus when spawning sub-agents with soul-aware or trust-informed delegation.
# Boot summary lives in compiled boot artifact. This file has the complete protocol.

## Soul-Aware Spawning

When spawning a sub-agent as a specific soul (e.g., blockchain-auditor, lore-writer):

1. Generate the soul preamble:
   ```bash
   bin/soul-prompt <soul-id> [--task-id T-xxx] [--extra-context "..."]
   ```
   Reads the soul's SOUL.md, PRINCIPLES.md, learned genes, permissions, handoff context → outputs full preamble to stdout.

2. Check recommended subagent_type (printed to stderr):
   - Soul has Write/Edit/Bash in tools → `general-purpose`
   - Soul only has read-only tools → `Explore`

3. Call the Task tool:
   ```
   subagent_type: <from step 2>
   prompt: "<preamble>\n\n## Task\n<your actual task>"
   name: "<soul-id>"
   ```

**Use soul-aware when:** task matches a specialist's domain, you want learned genes applied, or a handoff doc exists.
**Use generic when:** general-purpose tasks, quick searches, soul identity would add noise.

Mission Control (optional): `POST /api/souls/<soul-id>/prompt` returns the same preamble and logs the spawn.

## Contract Template

Every sub-agent prompt MUST include:

```
## Contract
- **Deliverable:** [exact output format — file path, JSON structure, test result]
- **Verification:** [mechanical check — "tests pass", "file exists at X", "no lint errors"]
- **Boundaries:** [tools/paths in scope, what is OUT of scope]
- **Budget:** [max turns before mandatory escalation — default 15]
- **Escalation:** [what to do if blocked]
```

If the deliverable can't be verified mechanically, decompose further. Unit of delegation = unit of verification.
Subjective outputs (lore, design) require a verification proxy: word count, format compliance, checklist.

## Trust-Informed Delegation

Check `bin/trust-registry` before delegating to a specialist soul.

| Tier | Min Tasks | Trust >= | Autonomy | Model |
|---|---|---|---|---|
| new | 0 | — | atomic (strict I/O) | sonnet |
| developing | 3 | 0.50 | guided (can decompose, must report steps) | sonnet |
| proven | 10 | 0.65 | open-ended (pursue sub-goals, report at end) | sonnet |
| expert | 25 | 0.80 | full (can sub-delegate, minimal oversight) | opus |

After every delegation: `bin/trust-registry update <soul-id> --result success|failure --turns N --verified true|false --task "description"`

## Two-Stage Review Gate

Any sub-agent producing code/file changes:

1. **Spec compliance** — output matches contract? Deliverable format, file locations, scope. Reject immediately if wrong.
2. **Code quality** — correct, safe, minimal? Security, complexity, scope creep, broken patterns. Only if stage 1 passes.

Apply by task size:
- Simple (<20 lines): mental check both inline
- Substantial (multi-file): explicitly verify stage 1 first
- Expert-tier: stage 1 only, trust their quality

## Task Granularity

Every delegated task: completable in **2-5 minutes**.
- \>5min = decompose into sequential sub-tasks with verifiable deliverables
- <2min = below complexity floor, do inline
- Exception: exploratory tasks — cap at 15 turns with mandatory checkpoint

## Re-Delegation Protocol

On sub-agent failure:
1. Retry once with enriched context (add the error + background)
2. Re-delegate to different soul if capability mismatch
3. Escalate model (sonnet → opus)
4. Escalate to Gui if 1-3 fail or task is high-criticality

Never retry same prompt unchanged. Each retry must add information.

## Circuit Breaker

```bash
bin/trust-registry check <soul-id>
# Exit 0 = available (CLOSED or HALF_OPEN)
# Exit 1 = blocked (OPEN, in cooldown)
```

Thresholds:
- 3 consecutive failures → OPEN
- 30min cooldown → HALF_OPEN (1 probe allowed)
- Probe success → CLOSED
- Probe failure → OPEN (restart cooldown)

If OPEN, skip soul → use Re-Delegation Protocol.

## Wave-Based Parallel Execution

Scheduler dispatches in dependency waves via `computeWaves()`:
- Wave 0 = all independent tasks (concurrent, capacity-permitting)
- Wave 1+ = wait for prior wave
- Capacity: light=0.5, normal=1.0, heavy=2.0, MAX=2.0
- Debug: `GET /api/scheduler/waves`

## Quality Gate

Sub-agents MUST run after significant code changes:
```bash
bin/quality-gate --files <changed-files>
# Exit 0 = clear, Exit 1 = must fix, Exit 2 = warnings only
```

## Criticality Levels

| Level | Triggers | Review |
|---|---|---|
| normal | Default | Standard two-stage |
| high | Security, payments, auth, migration, smart contracts | Multi-model review (3 parallel) |

High-criticality auto-detection:
- Paths: `contracts/`, `auth/`, `payments/`, `migration/`
- Keywords: security, audit, authentication, payment, migration, selfdestruct

Multi-model review: `bin/multi-review --task-id T-xxx --files <changed-files>` → 3 parallel reviewers (Logic, Security, Architecture). Any critical issue = revision required.

## Screenshot Gate (UI Changes)

UI files (`*.tsx/*.jsx` in components/pages/app/screens, `*.css/*.scss`) require visual evidence:
- Screenshot paths in `artifacts:` field
- Before/after description in completion report
- Or flag: `artifacts: [visual-verification-needed]`

No evidence on UI change → reject with "Missing visual evidence."

## Permission Scoping

Default sub-agent restrictions:
- No git push without contract permission
- No external API calls without contract permission
- No file deletion (use `trash`)
- No writing to SOUL.md, PRINCIPLES.md, AGENTS.md, MEMORY.md (genome files = human-approved only)

Soul-specific permissions: `capabilities.json`, enforced by `soul-prompt`.

## Handoff Templates

Standardized templates for context transfer between souls. Every handoff uses one of these — no cold starts.

### Standard Handoff (soul-to-soul work transfer)

```markdown
# Handoff: [Task ID]
**From:** [source-soul] → **To:** [target-soul]
**Reason:** [why this soul is better suited]
**Timestamp:** [datetime]

## Context
- **Task:** [title and description]
- **Current state:** [what's been done so far]
- **Key files:** [paths relevant to this task]
- **Dependencies:** [what this task needs from other work]

## Acceptance Criteria
- [mechanical verification for completion]

## Constraints
- [out-of-scope items, restricted paths, time budget]
```

### QA Pass

```markdown
# QA Verdict: PASS — [Task ID]
**Reviewer:** qa-evidence
**Timestamp:** [datetime]

## Evidence
- **Screenshots:** [paths/descriptions — minimum 2 viewports]
- **Test results:** [pass/fail per checklist item]
- **Performance:** [LCP, P95, Lighthouse score]

## Spec Compliance
- [x] [Requirement] — verified ([evidence ref])

## Notes
- [anything the next phase should know]
```

### QA Fail

```markdown
# QA Verdict: NEEDS WORK — [Task ID]
**Reviewer:** qa-evidence
**Attempt:** [N/3]
**Timestamp:** [datetime]

## Issues
1. **[Blocker/Major/Minor]** — [specific description + location]
   - **Expected:** [what should happen]
   - **Actual:** [what happens, with evidence]
   - **Fix guidance:** [suggested approach]
   - **Files:** [specific files to modify]

## What Passed
- [items that don't need re-work]

## Re-test Scope
- [what to re-verify after fixes, including regression checks]
```

### Escalation Report (3-strike)

```markdown
# Escalation: [Task ID]
**From:** [soul-id]
**Attempts:** 3/3 exhausted
**Timestamp:** [datetime]

## Failure History
1. **Attempt 1:** [what was tried, why it failed]
2. **Attempt 2:** [enriched context, what changed, why it still failed]
3. **Attempt 3:** [final attempt, root cause analysis]

## Root Cause Assessment
- [structural issue, capability mismatch, or spec ambiguity]

## Recommended Resolution
- [ ] Reassign to different soul ([who] and [why])
- [ ] Decompose into smaller tasks
- [ ] Revise spec/requirements
- [ ] Defer to next sprint
- [ ] Accept with documented limitations

## Impact
- [what's blocked by this task, downstream effects]
```

### Phase Gate Handoff

```markdown
# Phase Gate: [Phase N] → [Phase N+1]
**Gate keeper:** [soul-id]
**Verdict:** [PASS / NEEDS WORK / NOT READY]
**Timestamp:** [datetime]

## Gate Criteria Results
| Criterion | Status | Evidence |
|-----------|--------|----------|
| [requirement] | PASS/FAIL | [evidence ref] |

## Carried Forward
- **Documents:** [architecture docs, specs, task lists]
- **Key constraints:** [decisions that affect next phase]
- **Known risks:** [items to watch]

## Next Phase Activation
- **Souls to activate:** [list of souls needed for next phase]
- **Priority tasks:** [what to start first]
```

### Incident Handoff

```markdown
# Incident: [ID]
**Severity:** [P0-Critical / P1-High / P2-Medium / P3-Low]
**Reported by:** [soul-id or "user"]
**Timestamp:** [datetime]

## Description
- **What broke:** [specific system/feature]
- **User impact:** [who's affected, how]
- **First detected:** [when and how]

## Current State
- **Status:** [investigating / mitigating / resolved]
- **Actions taken:** [what's been done so far]
- **Rollback status:** [rolled back? partial? not needed?]

## Context for Next Responder
- **Relevant logs:** [paths or snippets]
- **Suspected cause:** [hypothesis if any]
- **Files touched:** [recent changes that might be related]
```

### Soul Routing Guide

When delegating, match the task to the right soul:

| Task Domain | Primary Soul | QA Soul | Escalation |
|------------|-------------|---------|------------|
| Smart contract code | blockchain-auditor | qa-evidence | Daedalus |
| Narrative/lore design | lore-writer | qa-evidence (checklist proxy) | Daedalus |
| CI/CD, deployment, monitoring | infra-ops | qa-evidence | Daedalus |
| Identity systems, trust models, SBT | identity-architect | blockchain-auditor | Daedalus |
| UI/frontend verification | (dev soul) | qa-evidence (screenshot gate) | Daedalus |
| Cross-domain / architectural | Daedalus | multi-model review | Gui |
