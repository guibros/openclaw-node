# HyperAgent Deep Review — 2026-07-20

## Executive verdict

The idea is founded; the pre-review operational claims were hype.

HyperAgent has a sensible bounded architecture: collect task outcomes, aggregate evidence,
propose reusable strategies, require human approval, and consult approved strategies later. Before
this review, however, that architecture was not a functioning loop. The live database contained one
telemetry row and no strategies, reflections, or proposals. The workspace CLI and store import path
were incomplete, the daemon throttle could never fire on an existing install, mesh tasks produced no
telemetry, strategy consultation was prompt-only, and the advertised shadow A/B evaluation never
applied a treatment.

After remediation, the node has a working evidence-loop substrate for mesh tasks. The producer,
strategy selection, strategy injection, telemetry attribution, reflection scheduling, lifecycle
transitions, deployment probe, and watcher are mechanical. Reflection synthesis and local companion
telemetry remain prompt-assisted; proposal approval remains human-only. There is still not enough
real data to claim that the node has learned or improved.

## Runtime ground truth

### Before remediation

- Live `state.db`: telemetry `1`, active strategies `0`, reflections `0`, proposals `0`.
- The only telemetry row was from 2026-07-15; no loop activity followed it.
- `~/.openclaw/workspace/bin/hyperagent.mjs` did not exist.
- The memory daemon referenced a missing CLI path and its persisted throttle lacked
  `lastHyperagentReflect`; subtraction from `undefined` yielded `NaN`, permanently suppressing the
  branch.
- The standalone `~/openclaw/bin/hyperagent.mjs` copy failed to import `better-sqlite3`.
- The companion bridge was not running, so local lifecycle instructions had no active executor.
- No node-watch target observed this subsystem.

### After remediation

- `ai.openclaw.memory-daemon` is running as PID `29245` from the deployed, hash-matched daemon.
- The daemon logged `HyperAgent store initialized` and `HyperAgent: maintenance tick complete` while
  restored in `ENDED` session state.
- `daemon-throttle.json.lastHyperagentReflect` was observed eight seconds old.
- Deployed CLI and repository CLI hashes match; deployed store and repository store are the same
  inode in this development setup.
- `node-watch --axis ops` reports `ops.hyperagent = WORKING`: CLI import succeeded, scheduler fresh,
  telemetry `1`, reflections `0`, strategies `0`.
- `PRAGMA integrity_check` returns `ok`; live row counts remain `1/0/0/0`. No synthetic production
  evidence was inserted to make the dashboard look healthier.

## Current dataflow

| Stage | Owner | Current behavior | Assessment |
|---|---|---|---|
| Task outcome | Mesh worker | Logs success/failure, iterations, duration, notes, identity, and selected strategy directly to SQLite | Mechanical and idempotent |
| Local task outcome | Companion harness | Instructs the local agent to send JSON through CLI stdin | Prompt-assisted; bridge-dependent |
| Pattern flags | Store | Detects repeated strategy, high iteration, escalation, and weak-note patterns within identity/domain scope | Mechanical heuristic |
| Reflection scheduling | Memory daemon | Every lifecycle state; at most every 30 minutes; creates windows after five unreflected tasks per node/soul | Mechanical |
| Reflection synthesis | Agent harness | Reads pending evidence and submits hypotheses plus at most two proposals | Prompt-assisted |
| Proposal gate | CLI + store | Pending/observation to approved/rejected; approval applies only supported strategy changes | Human-gated and transactional |
| Strategy consultation | Mesh worker | Selects a global-or-own active strategy, injects full content into every prompt shape, records its ID | Mechanical |
| Local consultation | Companion harness | Calls CLI `consult` and retains the strategy ID | Prompt-assisted |
| Evaluation | Store | Observes matching later telemetry without applying the proposal | Descriptive, non-causal |

## Material defects corrected

1. **Dead deployment path.** The workspace installer now deploys the CLI, component initialization
   fails loudly, package bin metadata exposes it, and acceptance verifies an actual import.
2. **Permanently suppressed scheduler.** Throttle defaults migrate old state. HyperAgent maintenance
   is node-scoped and runs even when the session state is `ENDED`; freshness is persisted only after
   reflection creation, stale expiry, and observation closure all succeed.
3. **No deterministic producer.** Mesh solo and collaborative completion/failure paths now write
   telemetry mechanically. Unhandled worker failures are covered and task IDs are idempotent.
4. **No deterministic treatment.** Mesh workers now select and inject an approved strategy before
   execution and attribute the outcome to that strategy ID.
5. **Cross-node leakage.** Strategy lookup now permits global or same-node strategies, preferring the
   node override. A node cannot attribute telemetry to another node's strategy. Updating a global
   fallback creates a local override instead of deactivating the shared strategy for every node.
6. **Global reflection watermark.** Reflection windows are now independent per node and soul.
7. **Broken observation timestamps/scope.** SQLite timestamps are compared consistently and links are
   restricted by node, soul, domain, and subdomain.
8. **False A/B language.** The public command is `observe`; results state `observational` and
   `treatment_applied: false`.
9. **Unsafe/invalid lifecycle transitions.** Rejected proposals cannot later be approved; duplicate
   synthesis is compare-and-set; unsupported proposal types are rejected; apply and status update are
   transactional; rejection reasons have their own field.
10. **Shell-fragile harness commands.** JSON is accepted through stdin, hardcoded identity placeholders
    were removed, managed rules update centrally while preserving the operator's active toggle, and
    lifecycle activation is honored.
11. **No observability.** Acceptance and node-watch now expose missing deploys, import failures, a
    never-run scheduler, stale scheduling, and real table counts.
12. **Overclaiming documentation.** README and observability docs now describe a gated strategy loop,
    not autonomous self-modification or causal experimentation.

## Critique

### What is good

- SQLite is the right complexity level for this node and the schema is inspectable.
- Human approval is a sound boundary. Strategies are data, not arbitrary executable patches.
- The loop now separates deterministic control from LLM judgment in the important mesh path.
- Identity-scoped windows and idempotent task telemetry make retries and multi-soul use tractable.
- The watcher refuses a green status without both deployed imports and a recent scheduler tick.

### What remains weak

- **No improvement proof.** One historical telemetry row cannot validate learning, strategy quality,
  or even the usefulness of the reflection threshold.
- **Local path remains soft.** Without the companion bridge or another lifecycle executor, local tasks
  still do not mechanically log, consult, or synthesize.
- **Synthesis is not independently checked.** The LLM can form weak causal stories from descriptive
  statistics. Human review is the current defense.
- **Observation is not experimentation.** A proposal is not applied, assignment is not randomized,
  and task mix can change. The result can prioritize a proposal but cannot estimate its effect.
- **Taxonomy quality is upstream-dependent.** Mesh task `domain` is preferred, then role, then generic
  fallback. Poor task metadata fragments the strategy archive.
- **No proposal UI/notification.** Pending review is visible only through CLI/status; this will limit
  operator follow-through once proposals exist.
- **No mature retention policy.** Telemetry and reflections grow indefinitely; this is harmless now,
  but needs an archive policy before sustained fleet use.

## Recommended next gates

1. Run at least 20 real mesh tasks across two or more domains and inspect strategy hit rate, failure
   rate, task taxonomy, and reflection usefulness. Do not tune thresholds before this sample exists.
2. Add a read-only Mission Control proposal/evidence page plus a notification when synthesis creates a
   pending proposal. Keep approval an explicit human action.
3. Make local telemetry mechanical at the actual frontend lifecycle boundary if local tasks are meant
   to train the loop; otherwise document HyperAgent as mesh-only.
4. If causal optimization is truly wanted, build a real trial protocol: approved candidate, explicit
   control/treatment assignment, applied treatment, comparable task strata, minimum sample size, and
   a predeclared decision rule.
5. Add domain validation or a small controlled taxonomy once real telemetry shows fragmentation.

## Verification

- Focused final suite plus installer-module checks: `173` tests passed, `0` failed, `0` skipped.
- Includes store integrity, CLI lifecycle, scheduler state independence, mesh prompt injection,
  harness sync, acceptance, node-watch, and production wiring tests.
- Live database backup migration was tested before deployment; counts and integrity were preserved.
- Full `npm test` is not a clean gate on this host. It exposed existing environment/live-service
  failures: real-NATS suites unavailable, embedding mean about `1866ms` against a `500ms` budget,
  and long LLM tests still running after roughly eight minutes. The run was interrupted after these
  failures were established. It also showed that installer `--dry-run` attempts a direct config write;
  both are broader repository issues, not evidence against the focused HyperAgent suite.

## Final classification

**Before:** a credible design with mostly dormant, prompt-driven wiring; operational claims were not
founded.

**Now:** a functioning, observable, human-gated strategy-loop substrate for mesh work. It is ready to
collect evidence, not ready to claim autonomous improvement.
