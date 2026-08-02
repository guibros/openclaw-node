# SCOPE — protocol plan

**Status:** done
**Goal:** Runtime repair 4.3, under the operator-approved 2026-08-02 four-step runtime block:
make gateway artifact freshness and actual launchd process state load-bearing node-watch evidence,
so historical JSONLs and PID-less loaded labels cannot earn WORKING. Heartbeat authentication and
the consolidation hard-cap performance finding remain separate steps.
**Set at:** 2026-08-02T17:47:00-04:00
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

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` means blocked.
- **`files` block:** one repo-relative path per line; add `closed` to the fence when shipped.
- Keep exactly one active scope and one open file block.
