---
name: openclaw-agent-optimize
description: Optimize an OpenClaw agent setup (model routing, context management, delegation, rules, memory). Use when asked about optimizing agents, improving OpenClaw setup, or agent best practices.
triggers:
  - "optimize my agent setup"
  - "improve OpenClaw configuration"
  - "agent best practices"
  - "reduce agent context size"
  - "tune model routing"
negative_triggers:
  - "build a new agent from scratch"
  - "deploy my agent to production"
  - "save money on API costs"
---

# OpenClaw Agent Optimization

Use this skill to tune an OpenClaw workspace for **cost-aware routing**, **parallel-first delegation**, and **lean context**.

## Workflow (concise)
1. **Audit rules + memory**: ensure rules are modular/short; memory is only restart-critical facts.
2. **Model routing**: confirm tiered routing (lightweight / mid / deep) aligns with live config.
3. **Context discipline**: apply progressive disclosure; move large static data to references/scripts.
4. **Delegation protocol**: parallelize independent tasks; use sub-agents for long/isolated work.
5. **Heartbeat batching**: ensure checks are grouped by tier to avoid extra passes.

## References
- `references/model-selection.md`
- `references/context-management.md`
- `references/agent-orchestration.md`
- `references/cron-optimization.md`
- `references/memory-patterns.md`
- `references/continuous-learning.md`
