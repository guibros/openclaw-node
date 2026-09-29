# Step 1.1 — AUDIT_PRE

## 0 — Micro Re-Orient

We are repairing the planned task-daemon drain before node-state-recovery 1.2 can preserve healthy bus stores.
The failed guard restored all 16 managed jobs; no healthy NATS server stopped.
This step makes the existing idle daemon's requested shutdown finish normally.
It serves durable local-first memory and reliable managed services.
Still the right next step: yes; the guard must not be weakened.

## 1 — Intent and current evidence

At 2026-09-28 09:54 America/Montreal the real task daemon logged its requested shutdown and drain, then exited through the permanent-close restart callback. That callback races `await nc.drain()`. Current main and live e57 have the same lifecycle code. Private shutdown log and failure/resumption records live in `~/.openclaw/backups/node-readiness/jetstream-20260928-1/managed-cold-window-2/`.

## 2 — Needs pre-screen

Existing daemon source and managed unit present; restarted daemon PID 93906. Owned server 2.12.6 available. Live base e57 and main base 5e088cc resolve. D1/D2 recorded. User explicitly authorized implementation/deployment and collaboration with this Claude thread. Primary repo remains on e57.

## 3 — Design

Main-local `shuttingDown` owns the planned drain. Closed callback returns only for that state. First signal sets the flag synchronously; later signals return. Preserve all existing timer/unsubscribe/drain actions and unexpected-loss exit 1. Owned fixture starts the real daemon with fresh authenticated loopback server, temporary HOME, isolated credentials and no production URLs. Hold the fixture server while issuing repeated signals, then resume it. Test the unpatched entry as a failing control. Do not conflate NATS drain with completion of arbitrary untracked async handlers.

## 4 — Risks and mitigations

| Risk | Mitigation |
|---|---|
| Suppress an unexpected close | Negative control stops only the owned server without signalling the daemon; expect exit 1 after its real reconnect policy. |
| Repeat signals race drain | Hold only the owned fixture server; send SIGTERM/SIGINT while drain is pending; one shutdown/completion. |
| Fixture reaches live data | Minimal environment; explicit random token and fresh loopback port; private HOME/store; no inherited OpenClaw/NATS configuration. |
| Deployment erases live drift | Apply only lifecycle patch to e57 staged release; byte-check every other tracked file against e57; dependency resolution explicit. |
| Production drain starts work | Fresh metadata-only idle proof; preserve unit/config; supervised stop/restart with finally restoration. |

## 5 — Acceptance

Execute INVENTORY 1.1 exactly. Source review plus CI do not close the runtime gate. Preserve sanitized evidence in this audit directory. Actual private logs/configs stay in private backup/release paths. Do not close node-state-recovery 1.2 in this step.

## 6 — File deltas

- `bin/mesh-task-daemon.js`: planned shutdown state and repeat-signal guard only.
- `test/task-daemon-lifecycle.test.mjs`: real owned-server/process controls and bounded cleanup.
- `memory-plan/plans/node-bus-lifecycle/`: scaffolded governance state, pre/post audit, sanitized evidence, version/inventory close after proof.
- `workspace-bin/node-bus-lifecycle-tick.sh`: scaffolded existing-engine shim; chain stays unloaded.
- Private runtime: lifecycle-only e57 release, task-daemon plist entry, backup and deployment journal. No production repo source changes.

## Mid-Implementation Findings

Claude's separate scratch review reports that buffered active submissions can continue after unsubscribe and leave partial collaboration work during shutdown. This is outside the idle planned-stop contract and is not repaired here. The execution-harness lifecycle work must explicitly own in-flight async handlers; a clean NATS drain alone is not proof of that outcome. The production preservation gate still requires fresh idle/executor/consumer evidence.
