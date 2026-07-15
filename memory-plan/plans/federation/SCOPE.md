# SCOPE — federation plan

**Status:** active
**Goal:** step 2.6 — the premise benchmark (grappe-of-OpenClaws vs solo OpenClaw, blind operator scoring on ≥5 tasks). 2.4 closed [x] 2026-07-15 (operator ACCEPTED, "proven — move on"). This phase: harness + protocol + candidate tasks only (no LLM spend); benchmark runs fire on operator task-confirmation.
**Set at:** 2026-07-15 (operator directive "1" in-session)
**Expires:** 2026-07-17T00:00:00Z

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

```files step-2.6-premise-benchmark
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
