# COMPONENT_REGISTRY — hyperagent-evidence plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a runtime probe verified, and date it. Claims older than 14 days decay (MASTER_PLAN §4.9).

## Family 1: HyperAgent substrate (post 07-20 remediation)

### Store + CLI — lib/hyperagent-store.mjs · bin/hyperagent.mjs

| | |
|---|---|
| **Status** | LIVE SUBSTRATE, EVIDENCE-EMPTY — mechanical mesh producer/consultation/attribution, identity-scoped reflection scheduling, transactional human-gated apply (strategy types only; inert types rejected at write). Full detail: federation `audits/hyperagent_deep_review/DEEP_REVIEW_2026-07-20.md` + D13. |
| **Verified** | 2026-07-20 (this instantiation): ha_ tables 1/0/0/0 (telemetry/strategies/reflections/proposals); deployed CLI + daemon hashes matched at remediation close; `node-watch --axis ops` → `ops.hyperagent WORKING (scheduler 15min ago; telemetry=1 reflections=0 strategies=0)`; daemon PID 864. |

### Harness rules (the 0.1 removal target) — config/harness-rules.json

| | |
|---|---|
| **Status** | 3 hyperagent-* rules PRESENT in the global set (9 "hyperagent" mentions grep'd 2026-07-20) — injected into every mesh prompt; `activateOn` honored since the remediation. Step 0.1 removes them and replaces synthesis with the operator runbook. |
| **Verified** | 2026-07-20 grep. |

### Notifications — openclaw-notify + ledger

| | |
|---|---|
| **Status** | Ledger + dedup live for other sources (node-watch transitions observed historically). NO hyperagent source yet; no reflection-pending or proposal-pending signal exists — step 1.1's work (amendment included). |
| **Verified** | 2026-07-20 — deep review §"weak": "No proposal UI/notification". |

### Mission Control surface

| | |
|---|---|
| **Status** | ABSENT — no route/page reads ha_*; a mismatched `hyperagentProposals` drizzle stub exists ("dashboard views deferred"). Step 1.2 builds read-only or drops the stub. MC itself is auth-gated (cookie+origin) since 07-18. |
| **Verified** | 2026-07-20 deep-review inventory (route grep). |

## Family 2: cohort execution dependencies

### Mesh worker path (D11) — bin/mesh-agent.js · bin/mesh-task-daemon.js

| | |
|---|---|
| **Status** | Mechanical telemetry + strategy consultation live (remediation); D11 guard refuses local-model workers; collab modes hardened (federation collab-p1 batch). Cohort execution ALSO needs authenticated advanced-LLM workers + the federation 3.5 window for co-scheduling — operator-dependent. |
| **Verified** | 2026-07-20 — 169/169 focused suites at remediation close; daemon maintenance tick observed. |
