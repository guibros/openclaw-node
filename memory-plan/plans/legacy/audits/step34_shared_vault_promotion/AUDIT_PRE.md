# AUDIT_PRE — Step 5.5: Promote selected concepts to shared vault (projects/arcane-vault/concepts-shared/)

**Version:** v5.5-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Promote selected concepts from the local Obsidian vault to the shared vault at
`projects/arcane-vault/concepts-shared/`. Concepts that meet the promotion policy's
`concept_mention_count` threshold (>= 10 per Block 4 frozen decisions) get equivalent
markdown notes written to the shared directory with provenance frontmatter (`source_node`,
`source_event_id`, `original_path`, `promoted_at`). This is the last step of Block 5.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.5 | v5.5 | [A] | Promote selected concepts to shared vault (projects/arcane-vault/concepts-shared/) |

## §3 — Design decisions (consuming Step 5.4 AUDIT_POST §6)

- Test baseline: 731 tests (654 pass, 77 fail — 73 pre-existing + 4 flaky). +10 tests added last step.
- Step 5.5 is independent of the adjacency cache — it writes to `projects/arcane-vault/concepts-shared/` per Block 5 §0.
- Promotion uses Block 4's promotion policy config threshold: `concept_mention_count >= 10`.
- Shared vault path `projects/arcane-vault/concepts-shared/` is fixed per Block 5 §0 frozen decisions.
- Provenance frontmatter per Block 5 §0: `source_node`, `source_event_id`, `original_path`, `promoted_at`.
- Reuses `queryConceptData()` from `lib/obsidian-summarizer.mjs` for concept data retrieval.
- Reuses `slugifyName()` from `lib/obsidian-summarizer.mjs` for filename generation.
- Reuses `buildConceptFrontmatter()` and `buildConceptBody()` from `lib/obsidian-summarizer.mjs` for note content with additional provenance fields.
- Reuses `loadPromotionPolicy()` from `lib/promotion-policy.mjs` for policy loading.
- `NODE_ID` derived as `process.env.OPENCLAW_NODE_ID || os.hostname()` — consistent with rest of codebase.

## §4 — Risk register

- **LOW:** New module only. No modification to existing files. No new dependencies.
- **LOW:** `projects/arcane-vault/concepts-shared/` directory does not exist yet — will be created by `mkdir({ recursive: true })`.

## §5 — Deferrals

None.

## §6 — Phase 4 implementation outline

| # | File | Delta |
|---|------|-------|
| 1 | `lib/obsidian-promoter.mjs` (new) | `SHARED_CONCEPTS_DIR` constant (resolves to `<repo-root>/projects/arcane-vault/concepts-shared/`); `getNodeId()` helper (env var or hostname); `buildPromotedFrontmatter(entity, nodeId, relatedEntities, avgSalience)` builds YAML frontmatter with standard concept fields PLUS provenance fields (`source_node`, `original_path`, `promoted_at`); `queryPromotableConcepts(db, threshold)` reuses `queryConceptData` with promotion threshold; `promoteConceptNotes(opts)` main orchestrator — loads policy, queries concepts, checks `mention_count >= policy.threshold.concept_mention_count`, builds notes, ensures shared dir, writes to `<slug>.md`, returns `{ promoted, sharedDir, notes }` |
| 2 | `test/obsidian-promoter.test.mjs` (new) | ~8 tests: SHARED_CONCEPTS_DIR constant, getNodeId returns hostname, buildPromotedFrontmatter includes provenance fields, queryPromotableConcepts filters by threshold, promoteConceptNotes writes qualifying notes, promoteConceptNotes skips below-threshold entities, provenance frontmatter has required keys, empty extraction store produces zero notes |
