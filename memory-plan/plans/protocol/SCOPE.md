# SCOPE — protocol plan

**Status:** active
**Goal:** Execute Phase 3 of REMEDIATION_PLAN_2026-09-06.md — make the gates mechanical: git hooks
installed on every clone via npm prepare, a real force-push deny in settings, the tick refuses to
close a step on a red suite or a missing Runtime-Evidence trailer, plan-lint FAILs (not WARNs) a
trailer-less close, scope-check hardened (no ../symlink escape, `*` never crosses `/`, fail-closed
on empty input, out-of-repo paths not the hook's business), and the stale governance state
reconciled (repair scope idle, CLAUDE/AGENTS truthful about CI, the suite, D16 and Codex). Branch
protection is a GitHub setting the operator must flip; a NATS service in CI to un-skip the mesh
suites is noted, not done. Phase 2 (below) is closed.
(Phase 2 goal, retained for the record:) authorization != reachability.
2a mesh-side: ownership checks on task start/complete (mirroring handleFail), signed operator-action
gating for approve/reject/cancel/plan/gate mutations (one shared verify core, no third copy),
strict signed-deploy default, verifyEvent/registry comments made truthful and strict-by-default.
2b Mission Control: session token on every /api method, no cookie hand-out to unauthenticated GET
(query-token bootstrap), file routes hardened (realpath + size cap + secret deny), id sanitization.
Local consumers that GET :3000 read the 0600 session token like scheduler-heartbeat already does.
Code + focused tests + MC build only; runtime evidence on the live host is the operator's step.
Per-node NATS nkeys is deferred (needs install-time credential provisioning).
Phase 0+1, prior runtime-repair (4.1-4.4) and the review-doc batch are preserved as closed blocks.
**Set at:** 2026-09-06T00:00:00Z
**Expires:** 2026-09-10T00:00:00Z

```files remediation-phase6-2026-09-07
lib/mesh-tasks.js
lib/operator-auth.mjs
bin/mesh-task-daemon.js
bin/mesh-agent.js
bin/openclaw-node-init.js
services/launchd/ai.openclaw.mesh-deploy-listener.plist
scripts/install/helpers.sh
scripts/install/config.sh
scripts/install/components.sh
scripts/install/services.sh
scripts/install/integrations.sh
scripts/install/workspace.sh
.github/workflows/test.yml
test/mesh-tasks-status.test.js
test/operator-auth.test.mjs
test/install-modules.test.mjs
test/node-init-render.test.mjs
test/wiring-manifest.test.mjs
memory-plan/plans/protocol/SCOPE.md
```

```files remediation-phase5b-2026-09-06 closed
lib/ollama-queue.mjs
workspace-bin/memory-daemon.mjs
bin/consolidation-scheduler.mjs
workspace-bin/web-fetch.mjs
lib/mcp-knowledge/server.mjs
lib/event-schemas.mjs
mission-control/src/lib/parsers/task-markdown.ts
mission-control/src/lib/sync/tasks.ts
mission-control/src/lib/db/schema.ts
mission-control/src/lib/db/index.ts
mission-control/src/lib/__tests__/task-markdown.test.ts
skills/openclaw-skill-scanner/install-hook.sh
skills/openclaw-skill-scanner/scanner.py
skills/openclaw-skill-scanner/SKILL.md
skills/prompt-guard/scripts/detect.py
skills/prompt-guard/SKILL.md
skills/_quarantine/**
skills/memorylayer/**
skills/moltbook-registry/**
identity/AGENTS.md
README.md
test/consolidation-scheduler.test.mjs
test/web-fetch-guard.test.mjs
test/skill-scanner.test.mjs
test/wiring-manifest.test.mjs
memory-plan/plans/protocol/SCOPE.md
```

```files remediation-phase5a-2026-09-06 closed
lib/extraction-store.mjs
lib/consolidation.mjs
lib/pre-compression-flush.mjs
lib/memory-formatter.mjs
lib/extraction-prompt.mjs
lib/extraction-schema.mjs
lib/obsidian-summarizer.mjs
lib/memory-watcher.mjs
lib/node-acceptance-probes.mjs
bin/consolidate.mjs
test/extraction-store.test.mjs
test/consolidation.test.mjs
test/pre-compression-flush.test.mjs
test/memory-formatter.test.mjs
test/extraction-prompt.test.mjs
test/extraction-schema.test.mjs
test/obsidian-summarizer.test.mjs
test/memory-watcher.test.mjs
test/node-acceptance.test.mjs
test/node-acceptance-probes.test.mjs
test/install-modules.test.mjs
scripts/install/verify.sh
memory-plan/plans/protocol/SCOPE.md
```

```files remediation-phase4-2026-09-06 closed
bootstrap.sh
mesh-install.sh
scripts/install/verify.sh
scripts/install/components.sh
scripts/install/config.sh
scripts/install/env.sh
services/launchd/*.plist
services/systemd/openclaw-memory-daemon.service
bin/node-acceptance.mjs
lib/node-acceptance.mjs
lib/node-acceptance-probes.mjs
lib/node-id.js
test/node-id.test.mjs
bin/mesh-task-daemon.js
bin/mesh-agent.js
bin/mesh-health-publisher.js
bin/mesh-deploy-listener.js
bin/openclaw-node-init.js
workspace-bin/memory-daemon.mjs
lib/operator-auth.mjs
lib/mesh-tasks.js
test/install-modules.test.mjs
test/node-acceptance.test.mjs
test/mesh-tasks-status.test.js
test/wiring-manifest.test.mjs
test/deploy-rollback.test.mjs
memory-plan/plans/protocol/SCOPE.md
```

```files remediation-phase3-2026-09-06 closed
package.json
.claude/settings.json
.claude/hooks/scope-check.sh
.claude/hooks/validate-push.sh
config/git-hooks/pre-commit
config/git-hooks/pre-push
workspace-bin/plan-tick.sh
workspace-bin/plan-lint.sh
test/gate-mutation.test.mjs
test/plan-protocol.test.mjs
CLAUDE.md
AGENTS.md
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/repair/SCOPE.md
```

```files remediation-phase2-2026-09-06 closed
bin/mesh-task-daemon.js
bin/mesh-agent.js
bin/mesh.js
lib/node-identity.mjs
lib/deploy-trigger-auth.mjs
lib/operator-auth.mjs
lib/mc-session-token.mjs
lib/node-watch.mjs
workspace-bin/mc-health.mjs
workspace-bin/memory-maintenance.mjs
test/node-identity.test.mjs
test/deploy-trigger-auth.test.mjs
test/operator-auth.test.mjs
test/wiring-manifest.test.mjs
mission-control/src/lib/server-auth.ts
mission-control/src/middleware.ts
mission-control/src/lib/mesh-sign.ts
mission-control/src/lib/safe-path.ts
mission-control/src/lib/__tests__/server-auth.test.ts
mission-control/src/lib/__tests__/safe-path.test.ts
mission-control/src/app/api/memory-file/route.ts
mission-control/src/app/api/workspace/read/route.ts
mission-control/src/app/api/memory/doc/route.ts
mission-control/src/app/api/tasks/[id]/route.ts
mission-control/src/app/api/tasks/[id]/handoff/route.ts
mission-control/src/app/api/souls/[id]/propagate/route.ts
mission-control/src/app/api/souls/[id]/prompt/route.ts
mission-control/src/app/api/souls/[id]/evolution/route.ts
mission-control/src/app/api/cowork/intervene/route.ts
memory-plan/plans/protocol/SCOPE.md
```

```files remediation-phase0-1-2026-09-06 closed
lib/exec-safety.js
bin/mesh-agent.js
bin/mesh-task-daemon.js
lib/llm-providers.js
lib/mesh-harness.js
test/exec-safety.test.js
scripts/install/config.sh
scripts/install/components.sh
scripts/install/integrations.sh
test/install-modules.test.mjs
.github/workflows/test.yml
.github/workflows/mirror.yml
package.json
package-lock.json
mission-control/package.json
mission-control/package-lock.json
memory-plan/plans/protocol/SCOPE.md
```

```files adversarial-review-2026-09-06 closed
ADVERSARIAL_REVIEW_2026-09-06.md
REMEDIATION_PLAN_2026-09-06.md
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/protocol/OUT_OF_SCOPE.md
```

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

```files runtime-repair-4.2-native-dependency-topology closed
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/protocol/INVENTORY.md
memory-plan/plans/protocol/VERSION
memory-plan/plans/protocol/COMPONENT_REGISTRY.md
memory-plan/plans/protocol/audits/step42_native_dependency_topology/*
package.json
package-lock.json
lib/mcp-knowledge/package.json
lib/mcp-knowledge/package-lock.json
scripts/install/workspace.sh
scripts/install/components.sh
bin/embed-probe.mjs
lib/node-acceptance-probes.mjs
test/install-modules.test.mjs
test/node-acceptance-probes.test.mjs
```

```files runtime-repair-4.3-watcher-process-truth closed
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/protocol/INVENTORY.md
memory-plan/plans/protocol/VERSION
memory-plan/plans/protocol/COMPONENT_REGISTRY.md
memory-plan/plans/protocol/audits/step43_watcher_process_truth/*
lib/node-watch.mjs
lib/fed-probes.mjs
lib/node-acceptance-probes.mjs
test/node-watch.test.mjs
test/fed-probes.test.mjs
test/fed-acceptance.test.mjs
```

```files runtime-repair-4.4-scheduler-heartbeat-auth closed
memory-plan/plans/protocol/SCOPE.md
memory-plan/plans/protocol/INVENTORY.md
memory-plan/plans/protocol/VERSION
memory-plan/plans/protocol/COMPONENT_REGISTRY.md
memory-plan/plans/protocol/audits/step44_scheduler_heartbeat_auth/*
bin/scheduler-heartbeat.mjs
services/launchd/ai.openclaw.scheduler-heartbeat.plist
services/systemd/openclaw-scheduler-heartbeat.service
scripts/install/workspace.sh
test/scheduler-heartbeat.test.mjs
test/install-modules.test.mjs
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

## Runtime repair 4.2 close gate

- Root `npm ci` owns `mcp-knowledge` and its transitive Sharp override; no installer path runs npm
  inside a copied `lib/mcp-knowledge` directory or copies nested `node_modules` into deployment.
- Source, workspace, and mesh imports resolve Sharp 0.35.x through a parent dependency tree, with no
  nested Sharp/libvips tree on disk.
- A deployed full deep watcher completes without duplicate-libvips warnings, native mutex abort, or
  a second Sharp load; focused install/dependency tests and audits pass.

## Runtime repair 4.2 done evidence

- Root npm owns `lib/mcp-knowledge` as a private workspace; the child lockfile is removed, installers
  exclude nested node_modules, and both deployed parent trees link the root dependency authority.
- Source, workspace, and mesh imports all resolve
  `/Users/moltymac/openclaw-nodedev/node_modules/sharp/dist/index.cjs` at Sharp 0.35.3/libvips 8.18.3;
  no nested mcp-knowledge node_modules remains on disk.
- The deployed full deep watcher completed every axis and exited rc 1 for its one reported BROKEN
  graph-cache probe, not a process abort: 28 WORKING / 1 BROKEN / 3 OFF / 4 UNKNOWN, embedding
  dimension 1024 and norm 1.000, with no duplicate-libvips warning or mutex failure.
- Focused dependency tests pass 20/20 and acceptance/isolation tests pass 39/39. Root npm audit has
  no high/critical findings. The full host suite passes 1927/1929 with one skip and the known
  environment-sensitive embedding budget failure (888.7ms mean against 500ms).
- `npm pack --dry-run --json` succeeds and contains the new helper plus workspace metadata while the
  removed child lock is absent; its unrelated 1.015 GB unpacked footprint is captured in OUT_OF_SCOPE.

## Runtime repair 4.3 close gate

- Gateway WORKING requires a recent session artifact; missing or stale artifacts cannot grade green.
- Launchd-backed mesh and coordinator WORKING requires a positive integer PID from parsed service
  state; a loaded label with no running process grades non-green and explains why.
- Focused regressions cover the live stale-gateway and PID-less-label fixtures; the deployed watcher
  completes and reports the host from the corrected evidence.

## Runtime repair 4.3 done evidence

- One shared `launchctl print` parser distinguishes running PID, loaded/stopped, absent, and
  unobservable states. Node-watch and federation acceptance both use it.
- Gateway requires a running PID plus a JSONL newer than 24h. Across live retries it graded BROKEN
  with `spawn scheduled, no PID` or UNKNOWN with a PID and a 69,773-minute stale session, never green.
- Mesh graded BROKEN with four PID-bearing services and two loaded/no-PID labels named; coordinator
  graded WORKING only from pid 56662. Required core services graded WORKING from explicit PIDs for
  memory-daemon, all three R=3 NATS servers, and Mission Control.
- The restarted watcher daemon wrote the corrected machine snapshot. Repository, workspace symlink,
  and legacy mesh library hashes match.
- Focused watcher/federation/acceptance tests pass 88/88. The final broad host suite passes
  1931/1933 with one skip and only the known embedding performance failure (1224.2ms mean against
  500ms; batch 100 completes in 9.62s). The deployed full deep watcher completes normally at
  27 WORKING / 3 BROKEN / 3 OFF / 3 UNKNOWN; rc 1 reflects its honest BROKEN findings.

## Runtime repair 4.4 close gate

- A one-shot helper reads the existing Mission Control token without exposing it in process argv,
  accepts only loopback HTTP targets, POSTs the scheduler tick, and exits nonzero on auth/HTTP errors.
- Launchd and systemd units invoke the deployed helper; the installer owns its workspace copy.
- The route still rejects an unauthenticated POST. The deployed authenticated helper returns HTTP
  200, and launchd records a newer run with last exit 0.

## Runtime repair 4.4 done evidence

- The one-shot reads the 0600 session token internally, rejects non-loopback/non-tick URLs, follows
  no redirects, sends Bearer auth, and never places the token in service argv or error output.
- Both service templates invoke the helper through rendered Node/workspace paths; the workspace
  installer copies it before service installation. Focused helper/installer tests pass 16/16.
- Mission Control auth tests pass 102/102. A live unauthenticated POST remains HTTP 401; the same
  route through the helper returns HTTP 200 with bounded tick JSON.
- A 10-second run timed out only while the full host suite saturated the node. The helper timeout was
  raised to a measured, still-bounded 30 seconds below the 60-second service interval; subsequent
  launchd runs advanced through runs=4 and 5 with last exit 0 and HTTP 200 records.
- The final broad host suite passes 1938/1939 with one environment skip and zero failures. Source,
  workspace, and legacy mesh helper hashes match.

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` means blocked.
- **`files` block:** one repo-relative path per line; add `closed` to the fence when shipped.
- Keep exactly one active scope and one open file block.
