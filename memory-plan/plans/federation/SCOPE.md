# SCOPE — federation plan

**Status:** active
**Goal:** harden mesh-task-daemon NATS reconnect (audit #1 — survive the bus restart; prereq for the 1.5 cutover and for live circling)
**Set at:** 2026-07-11
**Expires:** 2026-07-11T14:00:00Z

```files daemon-reconnect-hardening
bin/mesh-task-daemon.js
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
