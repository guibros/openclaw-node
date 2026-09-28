# Step 1.2 — AUDIT_PRE

## 0 — Micro Re-Orient

Task-daemon 1.1 is closed and merged as 88c7ad0 with live idle-stop evidence.
Recovery 1.2 still needs the bridge and worker's own clean shutdowns.
This step fixes only the existing bridge's planned-close race.
It serves managed local-first services and protected bus recovery.
Still the right next step: yes; preserve the strict stop gate.

## 1 — Intent and evidence

Fresh 2026-09-28 source: live e57 and main 88c7ad0 bridge files are identical. The managed-window log has the permanent-close exit without Bridge stopped. Unit PID 93912, runs 1; Node /usr/local/bin/node, cwd unset. The unconditional closed callback races the bridge's own drain.

## 2 — Needs pre-screen

1.1 closed; source, old shutdown journal and original managed unit present. Owned NATS 2.12.6 available; isolated kanban/observability fixture replaces the erroneous MC HTTP dependency per D5. e57 immutable base resolves. D4/D5 and existing operator authorization apply.

## 3 — Design

Main-local draining false; suppress the closed callback only when true; set true directly before await nc.drain(). Keep the dispatch loop and signal handlers unchanged. Owned fresh authenticated loopback server, random ports/token, temporary HOME/cwd and kanban, no inherited OpenClaw configuration. Verify both server-side subscriptions and a harmless wake callback before signal. Include TERM/INT, held drain with repeated signals, unexpected loss, and loss while a requested stop is still waiting for the polling sleep. Compare original kanban bytes.

## 4 — Risks

| Risk | Mitigation |
|---|---|
| Stop request masks unexpected loss before drain | Held long poll negative control; set flag at drain, not signal. |
| Fixture touches live state | Minimal env; private HOME/obs/kanban/server; excluded live ports; owned process cleanup. |
| Deployment erases drift | e57 archive plus bridge-only patch, every other tracked byte checked; unit/dependency/cwd preserved. |
| Restart reconciles or dispatches live tasks | Fresh idle/executor/consumer proof and pre/post task rows/kanban state; bounded supervisor; any forced kill fails acceptance. |

## 5 — Acceptance

Execute INVENTORY 1.2. Full suite in isolated CI; focused owned fixtures locally. Claude challenges immutable source plus staged release. Runtime requires actual completion/normal exit, managed replacement and subscription proof, no disconnect/reconnect during accepted drain, unchanged task states/unrelated owners.

## 6 — File deltas

- bin/mesh-bridge.js: main-local planned-drain state only.
- test/mesh-bridge-lifecycle.test.mjs: real owned-process lifecycle controls.
- memory-plan/plans/node-bus-lifecycle/: pre/post, decision, evidence, registry and version/inventory carriers.
- Private runtime: e57 bridge-only release, existing plist entry and private deployment journal.

## Mid-Implementation Findings

None yet. General async application-work shutdown remains node-readiness 4.1.
