# SCOPE — integrations plan

**Status:** active
**Goal:** None open — the plan is at its operator frontier at `v6.3`. Every remaining `[ ]` row (2.1, 2.2, 4.1–4.5, 5.1) needs the operator's macOS box or an operator decision. No `files` block is open, so writes are locked until the operator scopes the next step.
**Set at:** 2026-09-14
**Expires:** 2026-09-21T23:59:00Z

```files block0 closed
memory-plan/plans/integrations/ROADMAP.md
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/TICK_PROMPT.md
memory-plan/plans/integrations/automation.json
```

```files step11 closed
workspace-bin/web-fetch.mjs
package.json
package-lock.json
config/harness-rules.json
test/web-fetch-markdown.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step11_web_fetch_markdown/*
```

```files step12 closed
workspace-bin/web-fetch.mjs
test/web-fetch-guard.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step12_web_fetch_pinning/*
```

```files step13 closed
config/harness-rules.json
bin/check-added-deps.sh
test/harness-lazy-senior.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step13_lazy_senior_ladder/*
```

```files step14 closed
skills/ponytail-review/*
workspace-bin/multi-review
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step14_ponytail_review/*
```

```files step15 closed
skills/debugging-and-error-recovery/*
skills/incremental-implementation/*
skills/doubt-driven-development/*
skills/interview-me/*
skills/deprecation-and-migration/*
skills/code-review-and-quality/*
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step15_agent_skills_ports/*
```

```files step16 closed
skills/summarize/SKILL.md
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/BLOCKED.md
memory-plan/plans/integrations/audits/step16_summarize_ytdlp/*
```

```files step23 closed
skills/archify/**
openclaw.env.example
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step23_archify_skill/*
```

```files step24 closed
docs/diagrams/**
docs/ARCHITECTURE.md
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step24_architecture_diagrams/*
```

```files step52 closed
bin/mesh-task-daemon.js
lib/mesh-tasks.js
bin/mesh-agent.js
test/mesh-activity-state.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step52_activity_state_consumed/*
```

```files step61 closed
lib/llm-client.mjs
test/llm-client-tools.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step61_llm_tool_calling/*
```

```files step53 closed
bin/mesh-task-daemon.js
lib/mesh-tasks.js
test/mesh-stall-clear-cap.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step53_stall_clear_cap/*
```

```files step54 closed
bin/mesh-agent.js
test/mesh-worktree-hygiene.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step54_worktree_hygiene/*
```

```files step31 closed
mission-control/src/lib/tts/local.ts
mission-control/src/lib/tts/index.ts
mission-control/src/lib/tts/types.ts
mission-control/src/app/api/tts/route.ts
mission-control/src/lib/__tests__/tts-local.test.ts
openclaw.env.example
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step31_local_tts_provider/*
```

```files step32 closed
bin/openclaw-stack.mjs
test/openclaw-stack.test.mjs
openclaw.env.example
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step32_voicestudio_stack_row/*
```

```files step62 closed
lib/node-agent.mjs
test/node-agent.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step62_node_agent_tools/*
```

```files step63 closed
mission-control/src/lib/openclaw-lib.ts
mission-control/src/lib/mesh-sign.ts
mission-control/src/lib/agent-ask.ts
mission-control/src/app/api/agent/ask/route.ts
mission-control/src/lib/__tests__/openclaw-lib.test.ts
mission-control/src/lib/__tests__/agent-ask.test.ts
openclaw.env.example
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step63_agent_ask_route/*
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
