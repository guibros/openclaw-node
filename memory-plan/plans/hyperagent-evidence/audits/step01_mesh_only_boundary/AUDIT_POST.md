# AUDIT_POST — step 0.1 CLOSED: mesh-only boundary (2026-07-20)

## Delivered
1. **Retirement semantics in harness-sync** (the PRE's key finding: plain source deletion CANNOT
   remove a deployed rule — userOnly preservation keeps it alive forever). `retired: true +
   managed: true` in source now: reported as RETIREMENTS, removed from deployed on apply, never
   installed fresh (the fresh-deploy path was ALSO raw-copying source — now merges against empty
   so stubs never materialize). Two apply-path gaps found and fixed during runtime verification:
   the apply no-op gate ignored retirements ("already in sync" while 3 rules remained — caught
   live), and the raw-copy fresh deploy.
2. **Source config**: the 3 hyperagent rules are retirement stubs (full text preserved in git at
   cf10494^). 13 source entries → 10 effective.
3. **Prompt-side belt**: formatHarnessForPrompt skips `retired` rules even if a stale copy
   carries content.
4. **Runbook** `workspace-docs/RUNBOOK_HYPERAGENT_SYNTHESIS.md` — the explicit operator synthesis
   workflow replacing prompt-driven synthesis (notification → reflect --pending → advanced-LLM →
   write-synthesis → CLI gate), with cohort-mode rules (synthesis required, approvals forbidden).

## Runtime evidence (this node, all observed)
- `harness-sync` report: RETIREMENTS(3) listed; **apply: deployed 13 → 10 rules**;
  post-apply deployed file: hyperagent remaining **NONE**; user rule `session-boot-context`
  (operator-edited description) **preserved**.
- Mechanical write path: hyperagent-integration suite (real production functions
  recordHyperagentTask → store, temp DB) 3/3; the writer is code locked by the wiring-manifest
  row (`recordHyperagentTask` calledIn bin/mesh-agent.js) — no prompt text involved. mesh-task-
  daemon live (PID 853). Honest scope: mechanism-level proof (the write path needs no LLM
  compliance); full-session proof arrives with the 2.2 cohort by construction. No synthetic rows
  written to production ha_telemetry (still 1/0/0/0).
- Suites: harness-sync 5/5 (3 new retirement tests incl. unmanaged-retired left alone),
  mesh-harness incl. 2 new (retired-inert; shipped-config-carries-no-active-hyperagent) — 28/0
  across the three affected suites.

## Consequences
Companion prompts no longer carry HyperAgent text (token savings every mesh prompt). The only
synthesis path is the runbook. Other deployed trees (logical-node spawns) retire at their next
sync — recorded as a 2.1 Need. Step 1.1 (reflection+proposal notifications) is now the sole
pending signal path, exactly as D1's amendment planned.
