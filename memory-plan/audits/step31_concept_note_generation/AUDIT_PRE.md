# AUDIT_PRE — Step 5.2: Auto-generate concept notes from entity store (frontmatter + body via LLM)

**Version:** v5.2-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Implement concept note auto-generation from the extraction store's entity data. For each entity
exceeding the mention-count threshold (default 5), generate an Obsidian-compatible markdown file
in `~/.openclaw/obsidian-local/concepts/` with:
- **Frontmatter** — fully data-driven: type, entity_type, created, last_seen, mention_count,
  salience (average), related wikilinks to co-mentioned entities.
- **Body** — LLM-generated 2-3 sentence summary via the Ollama/Qwen3 stack from Block 3,
  with a data-only fallback when LLM is unavailable. Includes a Decisions section (wikilinked)
  and a Recent Activity section listing sessions.

Per Block 5 frozen decisions, this is delivered as `lib/obsidian-summarizer.mjs` with a
`generateConceptNotes(opts)` orchestrator entry point.

## §2 — Inventory excerpt

```
| 5 | 5.2 | v5.2 | [ ] | Auto-generate concept notes from entity store (frontmatter + body via LLM) |
```

## §3 — Design decisions (from Step 5.1 AUDIT_POST §6)

- Test baseline is now 693 tests (616 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added in Step 5.1.
- `DEFAULT_VAULT_PATH` exported from `lib/obsidian-vault.mjs:13`.
- `VAULT_SUBDIRS` exported from `lib/obsidian-vault.mjs:16`.
- `getVaultPath(opts)` exported from `lib/obsidian-vault.mjs:23`.
- `ensureVaultStructure(vaultPath)` exported from `lib/obsidian-vault.mjs:34`.
- Step 5.2 imports these to locate the vault and ensure structure before writing concept notes.
- Concept-note threshold is `mention_count >= 5` per Block 5 frozen decisions (override via `OBSIDIAN_CONCEPT_THRESHOLD` env var).
- Body generation uses hybrid data + LLM (same Ollama/Qwen3 stack from Block 3) with fallback to data-only.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Entity names may contain filesystem-unsafe characters | LOW | `slugifyName()` sanitizes for filesystem (lowercase, replace whitespace/special chars with hyphens, collapse multiples) |
| 2 | LLM unavailable at generation time | LOW | Fallback to data-only body (frontmatter + auto-listed sessions). Per frozen decisions. |
| 3 | Extraction store DB empty (no entities) | LOW | `generateConceptNotes` returns `{ generated: 0 }` cleanly |
| 4 | Related entity query via mentions table could be slow on large datasets | LOW | Query is bounded by LIMIT and only runs for above-threshold entities (expected: dozens, not thousands) |

## §5 — Deferrals

- Decision notes and session notes generation — future steps (5.3+ or consolidation cycle).
- Theme linkage per-entity — themes table lacks session_id column; direct entity→theme join not possible. Deferred to Step 5.3 when the graph parser can infer theme connections from note co-occurrence.
- `bin/openclaw-vault rebuild` CLI command — deferred to later step or consolidation cycle (Phase 8).

## §6 — Phase 4 implementation outline

| # | File | Action | Delta |
|---|------|--------|-------|
| 1 | `lib/obsidian-summarizer.mjs` | new | `DEFAULT_CONCEPT_THRESHOLD` constant (5). `getConceptThreshold(opts)` resolves from opts > env > default. `slugifyName(name)` sanitizes entity name for filesystem. `buildConceptFrontmatter(entity, relatedEntities)` returns YAML frontmatter string with type, entity_type, created, last_seen, mention_count, salience, related wikilinks. `buildConceptBody(entity, decisions, summary)` returns markdown body with optional LLM summary, decisions section, recent sessions section. `generateConceptSummary(client, entityName, mentions)` calls LLM for 2-3 sentence summary, returns string or null on failure. `queryConceptData(db, threshold)` queries extraction store for entities + co-mentions + decisions. `generateConceptNotes(opts)` main orchestrator: query store, ensure vault, write notes, return stats. |
| 2 | `test/obsidian-summarizer.test.mjs` | new | ~7 tests: slugifyName sanitization (3 cases in 1 test), getConceptThreshold resolution, buildConceptFrontmatter shape, buildConceptBody with summary, buildConceptBody data-only fallback, generateConceptSummary mock LLM, generateConceptNotes integration with temp DB + temp vault. |
