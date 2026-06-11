# COMPONENT_REGISTRY — {{PLAN_ID}} plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a runtime probe (ps / curl / sql / log / launchctl) verified, and date it. Updated at every
step close (PROTOCOL §3 Phase 9) and re-verified wholesale at every macro re-orient (§5.2).
Claims older than 14 days decay (MASTER_PLAN §4.9): re-probe before acting on them.

**Format is load-bearing:** the viewer's Master Plan tab parses `## Family N: <name>` sections
containing `### <component>` headings with a `| **Status** | <value> |` row — flat tables render
empty (PROTOCOL §10).

## Family 1: <name the component family>

### <component — path/port/service>

| | |
|---|---|
| **Status** | UNBUILT / DEAD / DEGRADED / LIVE |
| **Verified** | {{DATE}} — <probe command → observed output> |
