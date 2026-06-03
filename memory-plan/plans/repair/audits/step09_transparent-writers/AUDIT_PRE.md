# AUDIT_PRE — Step 2.1: All local vault writers transparent (D7, R6)

## §0 Re-orient
- Where am I: Block 2 (vault referential system — the operator's headline), step 1/11, 9/48 overall. Autonomous chain.
- Last step changed: 1.8 — rebaseline; Block 1 closed; graph numbers true.
- This step contributes: removes the R6 contradiction — one synthesis path filtered private (producing near-nothing, since everything is default-private), the other bypassed. D7 makes transparent the deliberate, uniform posture.
- Block serves the north star via: a referential system that hides its referents is not a referential system (D7 rationale).
- Still the right next step? Yes.

## Intent
`obsidian-summarizer` is the single privacy gate (`respectPrivacy !== false` → filter by default). The flush call site opts out; consolidation's `regenerateSummaries` and the promoter inherit the filtering default. Flip the default: **transparent unless explicitly opted IN** (`respectPrivacy === true`), which is the federation-era surface's job, not the local vault's.

## Design decisions
- Flip in both `queryConceptData` and `generateConceptNotes`; doc blocks re-anchored from F-N102 to D7 (R36 cloud-sync remark stays parked in Block P).
- Remove the now-redundant `respectPrivacy: false` at the flush call site — the default is the single source of the posture.
- The `private` column + filter machinery stay intact (D4/D7): pass `respectPrivacy: true` to get F-N102 behavior.
- memory-injector's separate `respectPrivacy` opts are NOT touched (inject server already passes false explicitly since 5.3; injector is not a vault writer).
- Tests: the F-N102 default-filter regression test becomes the D7 default-transparency test; the opt-out test becomes the opt-IN filter test (same exclusion assertions, now behind `respectPrivacy: true`).

## Risk register
- Consolidation's next cycles will regenerate concept notes for previously-filtered (private) entities — intended; maxConcepts cap + unchanged-skip bound the LLM cost.

## Done-evidence contract (INVENTORY 2.1 Proof)
grep: no local writer filters by default / no `respectPrivacy: true` caller among local writers; one consolidation cycle AND one flush each produce notes for previously-private entities; D7 cross-referenced.
