# COMPONENT_REGISTRY — protocol plan

Current control-plane and runtime-repair state. Every claim below was probed on 2026-08-02 EDT;
older implementation history remains in git and audits.

## Family 1: plan control plane

### Scope enforcement — plans/*/SCOPE.md

| | |
|---|---|
| **Status** | RECOVERED — expired scope history is retired; runtime repair now advances through one bounded protocol step at a time |
| **Verified** | 2026-08-02 — step 4.1 used the only active scope and closes its only open allow-list block at v4.1; step 4.2 is the next contract |

### Plan lint — workspace-bin/plan-lint.sh

| | |
|---|---|
| **Status** | LIVE — protocol and federation CONFORMANT; HyperAgent CONFORMANT with two non-blocking inherited WARNs |
| **Verified** | 2026-08-02 — final lints: protocol 15P/1W/0F after scope close; federation 15P/1W/0F; HyperAgent 14P/2W/0F |

### Workplan viewer — :7892

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-08-02 — `openclaw-stack status` reports workplan-viewer PID 56252, port 7892 open |

## Family 2: active plan frontiers

### Federation

| | |
|---|---|
| **Status** | EVIDENCE FRONTIER — 2.6 reopened at `v2.6-pre`; 3.5, 6.2, and 6.3 remain unfinished; no management work has started |
| **Verified** | 2026-08-02 — inventory/audit reconciliation plus live watcher: 2 WORKING, 1 OFF, 1 UNKNOWN; mesh-agent down; GRAPPE_REGISTRY unreadable/empty |

### HyperAgent evidence

| | |
|---|---|
| **Status** | LIVE SUBSTRATE, EVIDENCE-EMPTY — next step 2.1 operator-gated preregistration; companion I1-I5 design-only |
| **Verified** | 2026-08-02 — deployed CLI reports telemetry=1, strategies=0, reflections=0, proposals=0; MC `/hyperagent` HTTP 200; companion bridge down |

## Family 3: runtime repair

### Consolidation scheduler

| | |
|---|---|
| **Status** | SCHEDULER PATH RESTORED; CYCLE COMPLETION DEGRADED — queue-authoritative idle detection and authenticated event emission are live, but the first repaired cycle reached the independent five-minute hard cap |
| **Verified** | 2026-08-02 — launchd logged authenticated NATS connection and `system idle — starting consolidation cycle` from a fresh daemon queue snapshot while qwen3:8b remained resident; the cycle then failed explicitly at 300029ms instead of silently skipping |

### Scheduler heartbeat

| | |
|---|---|
| **Status** | BROKEN — launchd fires an unauthenticated POST against an auth-gated Mission Control route |
| **Verified** | 2026-08-02 — launchd runs=87, last exit=22; unit argv has no credential, stderr reports HTTP 401 |

### Nested mcp-knowledge dependency tree

| | |
|---|---|
| **Status** | SECURITY + PROCESS-STABILITY DEBT — standalone nested install loads Sharp 0.34.5 beside root Sharp 0.35.3 |
| **Verified** | 2026-08-02 — full watcher aborted in duplicate native Sharp/libvips state; nested `npm audit --package-lock-only` reports 13 findings (2 critical, 5 high), including GHSA-f88m-g3jw-g9cj; root audit has no Sharp finding |
