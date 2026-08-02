# SCOPE — protocol plan

**Status:** done
**Goal:** Runtime repair 4.1, operator-approved 2026-08-02 (`gogogogogogog`): restore the
scheduled consolidation path's liveness and event emission by grading the daemon's exported queue
state instead of Ollama model residency, authenticating standalone NATS clients, and deriving a
valid local stream name from any node id. Dependency cleanup, watcher verdicts, heartbeat auth,
and federation evidence remain separate steps.
**Set at:** 2026-08-02T16:52:00-04:00
**Expires:** 2026-08-04T00:00:00Z

```files governance-recovery-2026-08-02 closed
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/protocol/ROADMAP.md
memory-plan/plans/protocol/INVENTORY.md
memory-plan/plans/protocol/VERSION
memory-plan/plans/protocol/COMPONENT_REGISTRY.md
memory-plan/plans/protocol/DECISIONS.md
memory-plan/plans/protocol/audits/step31_governance_recovery/*
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/hyperagent-evidence/SCOPE.md
memory-plan/plans/hyperagent-evidence/COMPONENT_REGISTRY.md
README.md
CLAUDE.md
AGENTS.md
```

```files runtime-repair-4.1-memory-cadence closed
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/protocol/ROADMAP.md
memory-plan/plans/protocol/INVENTORY.md
memory-plan/plans/protocol/VERSION
memory-plan/plans/protocol/COMPONENT_REGISTRY.md
memory-plan/plans/protocol/DECISIONS.md
memory-plan/plans/protocol/audits/step41_memory_cadence/*
bin/consolidation-scheduler.mjs
bin/consolidate.mjs
bin/memory-promoter.mjs
lib/local-event-log.mjs
lib/memory-watcher.mjs
lib/ollama-queue.mjs
lib/node-acceptance-probes.mjs
workspace-bin/memory-daemon.mjs
test/consolidation-scheduler.test.mjs
test/local-event-log.test.mjs
test/memory-watcher.test.mjs
test/ollama-queue.test.mjs
test/node-acceptance-probes.test.mjs
test/daemon-tick-guard.test.mjs
test/wiring-manifest.test.mjs
```

## Retired scope history

The previous protocol scope accumulated implementation batches from 2026-06-15 through
2026-07-16, including one forgotten open `observer` block. Their durable history remains in git,
the associated audits, and DECISIONS D4-D7. They are not carried as writable file blocks here.

## Done evidence

- During execution exactly one unexpired `Status: active` scope existed; closing v3.1 leaves
  no stale active scopes.
- `plan-lint.sh protocol`, `plan-lint.sh federation`, and `plan-lint.sh hyperagent-evidence`
  report zero FAILs.
- Federation inventory names the evidence rerun before 3.5 and preserves 6.2/6.3 as unfinished.
- README/CLAUDE/AGENTS describe the probed 2026-08-02 state without improvement or recovery claims.
- The staged diff contains governance/docs only; the close commit carries a Runtime-Evidence
  trailer and is pushed to `main` without force.

## Runtime repair 4.1 close gate

- A stale/missing daemon queue snapshot fails closed; a fresh idle snapshot permits a cycle even
  while Ollama keeps a model resident in VRAM.
- The standalone scheduler authenticates to the live NATS cluster and resolves the deployed local
  stream without an Authorization Violation or invalid-name error.
- The deployed launchd scheduler crosses the idle gate and logs a real cycle start; repository and
  runtime hashes match, focused tests pass, and the affected services are restarted.

## Runtime repair 4.1 done evidence

- The deployed scheduler logged an authenticated NATS connection and crossed the idle gate from a
  fresh daemon queue snapshot while Ollama retained qwen3:8b in VRAM.
- The host network axis graded NATS, the canonical local stream, and pub/sub WORKING; no invalid
  dotted-hostname stream was requested.
- Repository/runtime hashes match for all deployed files; memory-daemon restarted at PID 91286 and
  exported a fresh explicit-idle queue snapshot.
- Focused tests pass 167/167. The host full baseline passes 1923/1925 with one skip and one known
  performance failure: embedding mean 530.4ms against the fixed 500ms budget.
- The real consolidation cycle failed loudly at its separate 300000ms hard cap. Completion cadence
  remains degraded and is carried forward without weakening the v4.1 scheduler-path verdict.

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` means blocked.
- **`files` block:** one repo-relative path per line; add `closed` to the fence when shipped.
- Keep exactly one active scope and one open file block.
