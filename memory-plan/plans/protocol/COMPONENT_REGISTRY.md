# COMPONENT_REGISTRY — protocol plan

Current control-plane and runtime-repair state. Every claim below was probed on 2026-08-02 EDT;
older implementation history remains in git and audits.

## Family 1: plan control plane

### Scope enforcement — REMOVED 2026-09-14 (D11)

| | |
|---|---|
| **Status** | REMOVED — `scope-check.sh`, all six `SCOPE.md` files, the template, the lint grades and the viewer card are gone. Nothing gates writes; the 9-phase discipline is convention |
| **Verified** | 2026-09-14 — hook script absent, 0 SCOPE.md remain, `.claude/settings.json` carries no Edit/Write PreToolUse entry, and a write to `lib/` (previously refused) succeeds |

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
| **Status** | LIVE — installer-owned loopback helper reads the Mission Control token internally and performs authenticated scheduler POSTs every 60 seconds |
| **Verified** | 2026-08-02 — unauthenticated POST remains HTTP 401; deployed helper returns HTTP 200; launchd advanced to runs=5 with last exit=0 and four bounded success records; source/workspace/mesh hashes match |

### Nested mcp-knowledge dependency tree

| | |
|---|---|
| **Status** | REPAIRED — mcp-knowledge is a root npm workspace, deployed trees resolve root Sharp 0.35.3/libvips 8.18.3, and the watcher isolates native embedding teardown in a child process |
| **Verified** | 2026-08-02 — source, workspace, and mesh resolve the same root Sharp path with no nested node_modules; root audit has no high/critical findings; full deep watcher completed and exited normally (rc 1 for one reported BROKEN probe), with no duplicate-libvips warning or mutex abort |

### Node-watch service evidence

| | |
|---|---|
| **Status** | HONEST — gateway activity, mesh services, coordinator, and required core services require current artifacts and/or running launchd PIDs; loaded labels alone cannot grade WORKING |
| **Verified** | 2026-08-02 — deployed daemon snapshot grades mesh BROKEN with four PID-bearing services and two PID-less labels named, gateway non-green with a 69773-minute stale session, coordinator WORKING at pid 56662, and five R=3/core services WORKING with explicit PIDs |
