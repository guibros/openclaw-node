# SCOPE — federation plan

**Status:** active
**Goal:** Post-deep-review remediation queue, operator-approved 2026-07-16 ("ok" on the step-by-step plan): (5) flush off the daemon main thread — fixes mem.inject event-loop starvation; (6) flush LLM timeout calibration (stop regex-divert); (7) memory.error event schema fix + observer test flake; (8) collab-mode P1 batch (decorative merge votes, missing barrier timeout, frozen integrator rotation, evaluateRound reentrancy, D11 denylist, non-owner fail poisoning); (9) multi-machine template security (tailscale binds + cluster auth) — MUST land before any second machine. NATS token rotation executed as runtime ops. Still operator-gated: 2.6 premise decision, 6.2 visual sign-off, MiniMax key rotation, hardware steps (real failover T7, 3.5 soak). CI is green as of run 29533778476 — keep it green.
**Set at:** 2026-07-16 (operator "ok" on the queued plan)
**Expires:** 2026-07-23T00:00:00Z

```files deployability-install-overhaul closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/audits/deployability_overhaul/*
install.sh
README.md
openclaw.env.example
package.json
services/service-manifest.json
services/nats/*
services/launchd/*
services/systemd/*
bin/log-rotate
bin/node-acceptance.mjs
docs/NODE_SPEC.md
docs/INSTALL_TEST_PROTOCOL.md
docs/MULTI_NODE_DEPLOY.md
```

```files north-star-pinning closed
memory-plan/plans/federation/ROADMAP.md
memory-plan/plans/federation/DECISIONS.md
```

```files step-2.6-benchmark-harness
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step26_premise_benchmark/*
bin/grappe-benchmark.mjs
docs/PREMISE_BENCHMARK.md
```

```files step-6.3-fed-probes closed
lib/node-watch.mjs
bin/node-watch.mjs
lib/fed-probes.mjs
test/fed-probes.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step63_fed_probes/*
```

```files memory-ingest-remediation closed
install.sh
config/transcript-sources.json.template
workspace-bin/memory-daemon.mjs
lib/node-watch.mjs
test/node-watch.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/memory_ingest_remediation/*
```

```files join-dispatch-remediation closed
bin/mesh-task-daemon.js
test/daemon-recruit-dispatch.test.js
test/collab-mode-dispatch.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/join_dispatch_remediation/*
```

```files probe-honesty-remediation closed
lib/fed-probes.mjs
lib/node-watch.mjs
lib/node-acceptance-probes.mjs
services/nats/nats-cluster-node.conf
test/fed-probes.test.mjs
test/fed-acceptance.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/probe_honesty_remediation/*
```

```files step-1.5-multimachine-cluster closed
lib/nats-cluster-config.js
test/nats-cluster-config.test.mjs
services/nats/nats-cluster-node.conf
install.sh
openclaw.env.example
docs/MULTI_NODE_DEPLOY.md
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step15_multimachine_cluster/*
```

```files step-6.2-mc-federation-page closed
mission-control/src/lib/hooks.ts
mission-control/src/lib/nats.ts
mission-control/src/components/cowork/session-card.tsx
mission-control/src/app/cowork/page.tsx
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step62_mc_federation_page/*
```

```files step-6.4-fed-census-acceptance closed
lib/node-acceptance-probes.mjs
lib/node-watch.mjs
test/fed-acceptance.test.mjs
test/mesh-skip-census.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step64_fed_acceptance/*
```

```files runbooks closed
workspace-docs/RUNBOOK_MC_DEPLOY.md
workspace-docs/RUNBOOK_MEMORY_DIAG.md
README.md
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
```

```files gate-mutation closed
test/gate-mutation.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/gate_mutation/*
```

```files incremental-indexing closed
lib/mcp-knowledge/core.mjs
test/mcp-knowledge-sessions.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/incremental_indexing/*
```

```files item5-small-batch
test/embed-benchmark.test.mjs
test/memory-inject-server.test.mjs
scripts/install/*
install.sh
test/install-modules.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/item5_small_batch/*
```

```files item4-ci-gates closed
.github/workflows/test.yml
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/ci_gates/*
```

```files item3-mc-auth closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/mc_auth/*
```

```files item2-inject closed
lib/node-acceptance-probes.mjs
workspace-bin/memory-daemon.mjs
workspace-bin/flush-worker.mjs
workspace-bin/knowledge-index-job.mjs
test/wiring-manifest.test.mjs
test/node-watch.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/inject_hang/*
```

```files extraction-stall closed
lib/llm-client.mjs
test/llm-client.test.mjs
openclaw.env.example
test/llm-client-format.test.mjs
docs/NODE_SPEC.md
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/extraction_stall/*
```

```files structural-cleanups closed
.mcp.json
config/mcp.json.template
install.sh
package.json
bin/openclaw-memory-daemon.mjs
bin/openclaw-status.mjs
workspace-bin/memory-daemon.mjs
workspace-bin/flush-worker.mjs
lib/shared-event-stream.mjs
lib/broadcast-emitter.mjs
lib/broadcast-offerer.mjs
lib/broadcast-acceptor.mjs
lib/federation-startup.mjs
lib/federation-resilience.mjs
scripts/install/*
test/wiring-manifest.test.mjs
test/shared-stream-startup.test.mjs
test/shared-event-stream.test.mjs
test/install-modules.test.mjs
services/service-manifest.json
services/launchd/*
services/systemd/*
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/structural_cleanups/*
```

```files lint-gate closed
.github/workflows/test.yml
memory-plan/plans/federation/SCOPE.md
```

```files security-review-2 closed
packages/event-schemas/.npmignore
packages/event-schemas/package.json
mission-control/src/app/api/memory-file/route.ts
mission-control/package.json
services/systemd/openclaw-mesh-deploy-listener.service
services/launchd/ai.openclaw.mesh-deploy-listener.plist
install.sh
package.json
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/OUT_OF_SCOPE.md
memory-plan/plans/federation/audits/security_review_2/*
```

```files repo-hygiene-leftovers closed
.gitignore
memory-plan/plans/federation/SCOPE.md
```

```files item9-cluster-security closed
services/nats/nats-cluster-node.conf
lib/nats-cluster-config.js
test/nats-cluster-config.test.mjs
install.sh
docs/MULTI_NODE_DEPLOY.md
openclaw.env.example
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/audits/item9_cluster_security/*
```

```files ci-green-wiring closed
test/wiring-manifest.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/flush_worker/*
```

```files collab-p1-hardening closed
bin/mesh-task-daemon.js
bin/fed-chaos.mjs
test/collab-unit.test.js
lib/mesh-collab.js
lib/llm-providers.js
bin/mesh-agent.js
test/collab-p1-hardening.test.js
test/collab-cooperative.test.mjs
test/collab-collaborative.test.mjs
test/grappe-worker-provider.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/collab_p1_hardening/*
```

```files item7-error-schema-observer closed
workspace-bin/memory-daemon.mjs
lib/observer.mjs
test/observer.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/memory_ingest_remediation/*
```

```files flush-worker closed
workspace-bin/memory-daemon.mjs
workspace-bin/flush-worker.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/flush_worker/*
```

```files live-session-import closed
workspace-bin/memory-daemon.mjs
lib/node-watch.mjs
test/node-watch.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/memory_ingest_remediation/*
```

```files inject-open-retry closed
lib/memory-inject-server.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/memory_ingest_remediation/*
```

```files ci-observed-close-64 closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step64_fed_acceptance/*
```

```files step-3.5-phase1-gate
bin/fed-chaos.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step35_phase1_gate/*
```

```files step-3.4-mode-selection closed
lib/mesh-collab.js
bin/mesh-task-daemon.js
docs/FEDERATION_SPEC.md
test/collab-mode-selection.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step34_mode-selection/*
```

```files step-3.3-collaborative closed
lib/mesh-collab.js
bin/mesh-task-daemon.js
bin/mesh-agent.js
test/collab-collaborative.test.mjs
test/collab-cooperative.test.mjs
test/collab-mode-dispatch.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step33_collaborative/*
```

```files step-3.2-cooperative closed
lib/mesh-collab.js
bin/mesh-task-daemon.js
bin/mesh-agent.js
test/collab-cooperative.test.mjs
test/collab-mode-dispatch.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step32_cooperative/*
```

```files step-3.1-mode-dispatch closed
lib/mesh-collab.js
bin/mesh-task-daemon.js
test/collab-mode-dispatch.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step31_mode-dispatch/*
```

```files step-2.6-premise-benchmark closed
bin/fed-benchmark.mjs
bin/fed-benchmark-driver.mjs
bin/mesh-agent.js
benchmark/*
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/audits/step26_premise-benchmark/*
```

```files daemon-circling-step-budget
services/launchd/ai.openclaw.mesh-task-daemon.plist
services/systemd/openclaw-mesh-task-daemon.service
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_PRE.md
```

```files mc-build-and-agent-frontend
mission-control/*
install.sh
docs/NODE_SPEC.md
memory-plan/plans/federation/SCOPE.md
```

```files readme-refresh
README.md
package.json
memory-plan/plans/federation/SCOPE.md
```

```files qwen-worker-eradication
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/ROADMAP.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/BLOCKED.md
memory-plan/plans/federation/PHASE1_TASKS.md
memory-plan/plans/federation/IMPLEMENTATION_PHASES.md
memory-plan/plans/federation/GRANULAR_PHASE1.md
memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_PRE.md
docs/FEDERATION_SPEC.md
docs/NODE_SPEC.md
README.md
lib/llm-providers.js
bin/mesh-agent.js
install.sh
openclaw.env.example
test/grappe-worker-provider.test.mjs
test/circling-worker-harness.test.mjs
memory-plan/plans/federation/SCOPE.md
```

```files memory-remediation-p0-p4
lib/pre-compression-flush.mjs
lib/extraction-store.mjs
lib/extraction-prompt.mjs
lib/extraction-schema.mjs
lib/memory-injector.mjs
lib/retrieval-pipeline.mjs
lib/memory-budget.mjs
lib/memory-formatter.mjs
bin/obsidian-graph-cache.mjs
bin/mesh-agent.js
lib/mesh-memory-bridge.mjs
workspace-bin/memory-daemon.mjs
bin/openclaw-memory-daemon.mjs
README.md
docs/NODE_SPEC.md
test/memory-extraction-degradation.test.mjs
test/mesh-memory-bridge.test.mjs
test/memory-relationships-store.test.mjs
test/recall-score-factors.test.mjs
test/privacy-turn-index.test.mjs
memory-plan/plans/federation/SCOPE.md
```

```files step-2.4-thinking-fix
lib/llm-providers.js
bin/mesh-agent.js
test/circling-thinking-strip.test.mjs
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/BLOCKED.md
memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_PRE.md
memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_POST.md
```

```files step-2.4-real-adversarial-run
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/BLOCKED.md
memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_PRE.md
memory-plan/plans/federation/audits/step24_real-adversarial-run/AUDIT_POST.md
```

```files step-2.4-task-record closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/BLOCKED.md
memory-plan/plans/federation/DECISIONS.md
```

```files step-2.3-parse-retry closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step23_parse-retry/AUDIT_PRE.md
memory-plan/plans/federation/audits/step23_parse-retry/AUDIT_POST.md
bin/mesh-task-daemon.js
test/daemon-circling-handlers.test.js
test/circling-parse-retry.test.mjs
```

```files step-2.2-adaptive-convergence closed
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step22_adaptive-convergence/AUDIT_PRE.md
memory-plan/plans/federation/audits/step22_adaptive-convergence/AUDIT_POST.md
lib/mesh-collab.js
test/circling-adaptive-convergence.test.mjs
```

```files step-2.1-circling-live closed
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/audits/step21_circling-session-live/AUDIT_PRE.md
memory-plan/plans/federation/audits/step21_circling-session-live/AUDIT_POST.md
memory-plan/plans/federation/BLOCKED.md
bin/mesh-task-daemon.js
lib/logger.js
```

```files block-2-prep closed
bin/mesh-task-daemon.js
lib/mesh-collab.js
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
```

```files tick-block-1.5 closed
memory-plan/plans/federation/BLOCKED.md
```

```files step-1.4-signed-grappe-membership closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step14_signed-grappe-membership/AUDIT_PRE.md
memory-plan/plans/federation/audits/step14_signed-grappe-membership/AUDIT_POST.md
bin/openclaw-grappe.mjs
```

```files step-1.3-grappe-manifest-kv-cli closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step13_grappe-manifest-kv-cli/AUDIT_PRE.md
memory-plan/plans/federation/audits/step13_grappe-manifest-kv-cli/AUDIT_POST.md
bin/openclaw-grappe.mjs
package.json
```

```files step-1.2-logical-nodes-heartbeat closed
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/BLOCKED.md
memory-plan/plans/federation/audits/step12_logical-nodes-heartbeat/AUDIT_PRE.md
memory-plan/plans/federation/audits/step12_logical-nodes-heartbeat/AUDIT_POST.md
services/launchd/ai.openclaw.mesh-health-publisher.plist
services/launchd/ai.openclaw.mesh-task-daemon.plist
services/launchd/ai.openclaw.mesh-agent.plist
services/launchd/ai.openclaw.mesh-bridge.plist
bin/mesh-agent.js
bin/mesh-health-publisher.js
```

```files d6-split-1.1-gate-cutover closed
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/GRANULAR_PHASE1.md
memory-plan/plans/federation/PHASE1_TASKS.md
```

```files step-0.1-crashloop-rootcause closed
memory-plan/plans/federation/audits/step01_crashloop-rootcause/AUDIT_PRE.md
memory-plan/plans/federation/audits/step01_crashloop-rootcause/AUDIT_POST.md
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/COMPONENT_REGISTRY.md
```

```files step-0.2-federation-spec closed
docs/FEDERATION_SPEC.md
memory-plan/plans/federation/audits/step02_federation-spec/AUDIT_PRE.md
memory-plan/plans/federation/audits/step02_federation-spec/AUDIT_POST.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/SCOPE.md
memory-plan/plans/federation/COMPONENT_REGISTRY.md
```

```files d4-fleet-reconciliation closed
memory-plan/plans/federation/DECISIONS.md
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/GRANULAR_PHASE1.md
memory-plan/plans/federation/PHASE1_TASKS.md
memory-plan/plans/federation/IMPLEMENTATION_PHASES.md
memory-plan/plans/federation/ROADMAP.md
```

```files step-1.1-nats-cluster-harden closed
services/nats/nats-1.conf
services/nats/nats-2.conf
services/nats/nats-3.conf
services/launchd/ai.openclaw.nats-1.plist
services/launchd/ai.openclaw.nats-2.plist
services/launchd/ai.openclaw.nats-3.plist
services/service-manifest.json
install.sh
memory-plan/plans/federation/INVENTORY.md
memory-plan/plans/federation/VERSION
memory-plan/plans/federation/COMPONENT_REGISTRY.md
memory-plan/plans/federation/audits/step11_nats-cluster-harden/AUDIT_PRE.md
memory-plan/plans/federation/audits/step11_nats-cluster-harden/AUDIT_POST.md
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Batch lifecycle:** label each batch's block (` ```files <label> `) and, when the batch
  ships, append the word `closed` to the fence (` ```files <label> closed `) — the hook prunes
  closed blocks, so finished work re-locks while the record stays. One open block per
  in-flight batch.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
