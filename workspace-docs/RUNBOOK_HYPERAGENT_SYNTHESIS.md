# RUNBOOK — HyperAgent reflection synthesis (operator workflow)

HyperAgent is **mesh-only and human-gated** (hyperagent-evidence D1): mesh task telemetry,
reflection windows, and strategy attribution are mechanical; **synthesis is not autonomous** —
the prompt rules that used to ask sessions to synthesize are retired. This is the explicit
workflow that replaces them. Language discipline per federation D13: observation windows are
descriptive, never "A/B"; nothing here self-modifies.

## When
The memory daemon creates a reflection window automatically once a node/soul accumulates ≥5
unreflected telemetry rows. A pending reflection awaits synthesis and **expires after 24h**.
You'll get a desktop notification (`hyperagent` source — step 1.1; until 1.1 lands, check
manually during active mesh periods).

## Workflow
```bash
H=~/.openclaw/workspace/bin/hyperagent.mjs
node $H status                    # counts + pending synthesis flag
node $H reflect --pending         # the pending window: raw stats + cited telemetry ids
```
2. Hand the pending output to an **advanced LLM** (your Claude session — not the local model)
   with the ask: hypotheses grounded ONLY in the cited telemetry, and at most 2 strategy
   proposals, each `{title, description, proposal_type: strategy_new|strategy_update,
   target_ref, diff_content: {domain, content}}`. It may legitimately return none.
3. Write it back (JSON via stdin — shell-quote-safe):
```bash
node $H reflect --write-synthesis --stdin <<'JSON'
{ "hypotheses": [...], "proposals": [...] }
JSON
```
4. Review proposals — the ONLY approval surface is this CLI:
```bash
node $H proposals
node $H approve <id>      # applies strategy data transactionally — nothing else
node $H reject <id> [reason]
```

## Rules
- Only `strategy_new` / `strategy_update` are actionable; other types are rejected at write.
- During a preregistered evidence cohort (plan Block 2): synthesis on notification is REQUIRED
  (the 24h window is a cohort gate), approvals are FORBIDDEN until the cohort closes.
- Strategies with `node_id=NULL` are shared fallbacks; node-owned overrides shadow them locally
  and never deactivate them fleet-wide (D13 identity boundary).
