# AUDIT_PRE — step 0.1: mesh-only boundary (2026-07-20)

**Written before code.** Contract: INVENTORY 0.1; D1 boundary 1; IMPLEMENTATION_PLAN §5/0.1.

## Probed reality
- config/harness-rules.json: 13 rules; the 3 hyperagent-* rules present, all `managed: true`,
  activateOn lifecycle markers (task-close on completion markers; task-start + reflection-ready
  on start markers).
- bin/harness-sync.js diffRules: **deployed-not-in-source rules are classified `userOnly` and
  PRESERVED** — naive source deletion leaves the rules alive in every deployed
  workspace copy forever (and on any other node), still injecting into prompts. Removal
  therefore requires explicit managed-rule RETIREMENT semantics, which don't exist yet.
- Mesh mechanical paths (consultation + telemetry in bin/mesh-agent.js) do NOT depend on these
  rules — they are code, not prompt text (verified in the 07-20 remediation; integration tests
  exist).

## Design
1. **Retirement semantics in harness-sync** (the reusable mechanism): a source rule carrying
   `retired: true` + `managed: true` is (a) never installed as new, (b) REMOVED from the deployed
   set when present there, reported as `retirements` in the sync report. User-owned (unmanaged)
   deployed rules stay untouched — retirement applies only to rules the source owns.
2. **Source config**: the 3 hyperagent rules collapse to retirement stubs
   `{ id, managed: true, retired: true }` (full prior text preserved below for the record —
   source history also carries it).
3. **Runbook** `workspace-docs/RUNBOOK_HYPERAGENT_SYNTHESIS.md`: the explicit operator workflow
   that replaces prompt-driven synthesis — notification → `hyperagent reflect --pending` →
   advanced-LLM synthesis → `reflect --write-synthesis` via stdin → proposal appears →
   CLI approve/reject. (The notification half lands in step 1.1; the runbook notes that.)
4. **Tests**: harness-sync — retired managed rule removed from deployed / never freshly
   installed / unmanaged user rules preserved alongside; mesh-harness — formatted prompt contains
   no hyperagent text after a sync against a deployed copy that HAD the rules.
5. **Runtime verify** on this node: `harness-sync apply` → deployed
   ~/.openclaw/harness-rules.json (path per bin/harness-sync.js defaults) contains 0 hyperagent
   rules; one mock-provider mesh completion (MESH_ALLOW_MOCK_WORKERS=1, scratch task) writes an
   ha_telemetry row with no LLM-issued logging command — proving the write path needs no rule.

## Retired rule content (for the record)
The three rules' full JSON is preserved in git history at cf10494^ (config/harness-rules.json);
their ids: hyperagent-task-close, hyperagent-task-start, hyperagent-reflection-ready.

## Risks
- Other deployed trees (logical-node spawns) may carry the rules — retirement handles them at
  their next sync; not force-synced here (out of this step's blast radius; noted for 2.1 Needs).
- The daemon's Phase-2 maintenance is untouched (scheduler stays mechanical).
