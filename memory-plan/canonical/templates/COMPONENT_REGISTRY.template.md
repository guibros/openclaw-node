# COMPONENT_REGISTRY — {{PLAN_ID}} plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a runtime probe (ps / curl / sql / log / launchctl) verified, and date it. Updated at every
step close (PROTOCOL §3 Phase 9) and re-verified wholesale at every macro re-orient (§5.2).
Claims older than 14 days decay (MASTER_PLAN §4.9): re-probe before acting on them.

| Component | Where (path/port/service) | Status | Last verified | Evidence (probe + result) |
|---|---|---|---|---|
| <component> | <where> | UNBUILT / DEAD / DEGRADED / LIVE | {{DATE}} | <command → observed output> |
