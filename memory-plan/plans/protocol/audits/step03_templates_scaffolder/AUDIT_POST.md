# AUDIT_POST — step 1.3 · Template set + new-plan.sh scaffolder

## §1 Promised vs landed

| Promised (AUDIT_PRE §6) | Actual | Landed |
|---|---|---|
| 7 `.template.md` + `automation.template.json` | 8 templates in `canonical/templates/` | yes |
| `workspace-bin/new-plan.sh` executable | written, chmod +x; renders, shims, syncs | yes |
| CLAUDE.md refresh | silo list (4 plans), reading order (+PROTOCOL.md), "Where we are" rewritten to 2026-06-03 reality | yes |
| protocol close bookkeeping | VERSION/INVENTORY/SCOPE flips | yes |

## §2 Greppable deltas

- `ls memory-plan/canonical/templates/ | wc -l` → 8.
- Demo run 02:46: 9 files + VERSION + shim scaffolded; `grep -rn '{{' plans/zz-scaffold-demo/` → only PROTOCOL.md prose describing placeholders (no unrendered template).
- `grep -n "PROTOCOL.md" CLAUDE.md` → reading-order item 2 + base description.

## §3 Cross-refs

PROTOCOL §7/§9 promises (`plan-tick.sh`, `new-plan.sh`, shim convention, templates) now all true
on disk. sync-canonical untouched and still skips `templates/` (dir, `[[ -f ]]` guard — verified
by the sync run inside new-plan.sh copying only the 5 docs).

## §4 Findings

- [POSITIVE] End-to-end evidence: `new-plan.sh zz-scaffold-demo` → live viewer `/api/plans`
  listed `{"id":"zz-scaffold-demo","version":"v0.0"}` within 5s; `/api/plans/zz-scaffold-demo/scope`
  parsed the templated SCOPE (`present:true,status:idle`); shim `zz-scaffold-demo-tick.sh --preflight`
  passed through to the engine and named step 1.1 from the templated INVENTORY. Demo + shim
  removed; viewer index back to exactly the 4 real silos.
- [NEGATIVE] Full-suite `npm test` showed 1 fail: `obsidian-summarizer.test.mjs` "(repair 2.9)"
  SQLITE_ERROR. Verified external to this step: the file (and 8 other repair-domain lib/test
  files) was being modified by a concurrent second claude session during this step (mtimes
  02:47–02:49; tree was clean at session start; none are in this plan's scope or staging); the
  test passes 18/18 in isolation, twice. Captured in OUT_OF_SCOPE.md for operator triage. This
  step's deltas are bash+markdown with zero overlap.
- [POSITIVE] Surgical by-path staging (PROTOCOL gate check ③) is what makes closing safely
  possible with a concurrently dirty tree — the discipline held under real contention.

## §6 Carry-forwards

None — Block 1 closes the plan's current inventory.

## §7 Macro Re-Orient (Block 1 close — Global Review)

- Principles re-read: no violations; §4.6 honored (one engine, legacy tick scripts left as
  historical, not deleted mid-plan — their retirement is a future operator call).
- Components moved: protocol base UNBUILT → LIVE, verified by runtime probes this session
  (sync --check rc=0 · preflight × 4 silos · viewer HTTP probes for scaffold/discovery).
- Remaining inventory: none open. Next iteration of this plan = evolving the base (e.g. retiring
  redesign-tick.sh/memory-plan-tick.sh onto the generic engine, cross-plan pipelines per
  COWORK_MODEL §5) — new blocks to be inventoried when the operator scopes them.
- Drift check: one item captured in OUT_OF_SCOPE.md (concurrent foreign session); nothing landed
  outside a step.
- DECISIONS: D1/D2 cover the architecture; no course-corrections needed.
