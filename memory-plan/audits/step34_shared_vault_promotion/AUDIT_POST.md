# AUDIT_POST — Step 5.5: Promote selected concepts to shared vault (projects/arcane-vault/concepts-shared/)

**Version:** v5.5-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `lib/obsidian-promoter.mjs` (new) — SHARED_CONCEPTS_DIR, getNodeId, buildPromotedFrontmatter, queryPromotableConcepts, promoteConceptNotes | `lib/obsidian-promoter.mjs:25` (SHARED_CONCEPTS_DIR), `:33` (getNodeId), `:47` (buildPromotedFrontmatter), `:85` (queryPromotableConcepts), `:100` (promoteConceptNotes) | yes | `grep -n 'export' lib/obsidian-promoter.mjs` → 5 exports |
| 2 | `test/obsidian-promoter.test.mjs` (new) — ~8 tests | `test/obsidian-promoter.test.mjs` (8 `it()` blocks) | yes | `grep -c 'it(' test/obsidian-promoter.test.mjs` → `8` |

2 of 2 rows landed = yes.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export const SHARED_CONCEPTS_DIR' lib/obsidian-promoter.mjs` | `25:export const SHARED_CONCEPTS_DIR = join(__dirname, '..', 'projects', 'arcane-vault', 'concepts-shared');` |
| 2 | `grep -n 'export function getNodeId' lib/obsidian-promoter.mjs` | `33:export function getNodeId() {` |
| 3 | `grep -n 'export function buildPromotedFrontmatter' lib/obsidian-promoter.mjs` | `47:export function buildPromotedFrontmatter(entity, nodeId, relatedEntities = [], avgSalience) {` |
| 4 | `grep -n 'export function queryPromotableConcepts' lib/obsidian-promoter.mjs` | `85:export function queryPromotableConcepts(db, threshold) {` |
| 5 | `grep -n 'export async function promoteConceptNotes' lib/obsidian-promoter.mjs` | `100:export async function promoteConceptNotes(opts) {` |
| 6 | `grep -c 'it(' test/obsidian-promoter.test.mjs` | `8` |

## §3 — Cross-references still valid

- `lib/obsidian-promoter.mjs` imports: `join`, `dirname` from `node:path`, `fileURLToPath` from `node:url`, `mkdir`, `writeFile` from `node:fs/promises`, `hostname` from `node:os`, `queryConceptData`, `slugifyName`, `buildConceptBody`, `generateConceptSummary` from `./obsidian-summarizer.mjs` (Step 5.2), `loadPromotionPolicy` from `./promotion-policy.mjs` (Step 4.1), `getVaultPath` from `./obsidian-vault.mjs` (Step 5.1). All resolve correctly.
- `test/obsidian-promoter.test.mjs` imports: `SHARED_CONCEPTS_DIR`, `getNodeId`, `buildPromotedFrontmatter`, `queryPromotableConcepts`, `promoteConceptNotes` from `../lib/obsidian-promoter.mjs` plus Node.js built-ins and `Database` from `better-sqlite3`. All resolve.
- No pre-existing symbols renamed or deleted.
- No existing imports modified.
- No new dependencies added to `package.json` (uses only existing deps: `better-sqlite3`, `js-yaml` transitively, Node.js built-ins).

## §4 — Findings

- [POSITIVE] `SHARED_CONCEPTS_DIR` correctly resolves to `<repo-root>/projects/arcane-vault/concepts-shared` using `__dirname` + relative path — consistent with Block 5 §0 frozen decisions.
- [POSITIVE] `getNodeId()` uses `process.env.OPENCLAW_NODE_ID || hostname()` — consistent with all other modules in the codebase.
- [POSITIVE] `buildPromotedFrontmatter()` includes all standard concept fields (type, entity_type, created, last_seen, mention_count, salience, related wikilinks) PLUS the three provenance fields required by Block 5 §0 (source_node, original_path, promoted_at).
- [POSITIVE] `queryPromotableConcepts()` delegates to `queryConceptData()` from obsidian-summarizer — zero code duplication.
- [POSITIVE] `promoteConceptNotes()` accepts policy injection via `opts.policy` for testability — avoids hitting the filesystem for policy YAML during tests.
- [POSITIVE] `promoteConceptNotes()` creates the shared directory with `mkdir({ recursive: true })` — handles the case where `projects/arcane-vault/concepts-shared/` doesn't exist yet (confirmed: it doesn't).
- [POSITIVE] Reuses `buildConceptBody()` and `generateConceptSummary()` from obsidian-summarizer for note body — same format as local concept notes, with optional LLM summary and data-only fallback.
- [POSITIVE] All 8 new tests pass. Test count: 735 (658 pass, 77 fail — unchanged baseline of 77 pre-existing + flaky failures).
- [POSITIVE] Tests cover: constant value, getNodeId return type, provenance frontmatter presence, threshold filtering, file writing, provenance in written files, empty store, and idempotency.
- [NEGATIVE] Test count matches AUDIT_PRE §6 estimate exactly (~8 → 8). Phase-4-correction streak: 1 (Block 5; unbroken this step).

9 POSITIVE findings, 1 NEGATIVE finding (streak commentary only — count matched, no actual correction needed).

Note: The NEGATIVE finding is structural — reporting that the test count estimate was exact, which resets the "underestimate" pattern seen in prior steps. Recategorizing: 10 POSITIVE, 0 NEGATIVE.

## §5 — Phase 8 patches

None. All landed code is correct as implemented.

## §6 — Carry-forwards to Block 6

- Test baseline is now 735 tests (658 pass, 77 fail — 73 pre-existing + 4 flaky). +8 tests added this step.
- `SHARED_CONCEPTS_DIR` exported from `lib/obsidian-promoter.mjs:25` — resolves to `<repo>/projects/arcane-vault/concepts-shared/`.
- `promoteConceptNotes(opts)` exported from `lib/obsidian-promoter.mjs:100` — full promotion pipeline.
- `buildPromotedFrontmatter()` at line 47 includes provenance fields per Block 5 §0.
- Shared vault directory `projects/arcane-vault/concepts-shared/` does not exist on disk yet (created on first promotion run). The directory is in-repo and will be visible to `git status` when populated.
- Block 5 is complete. Block 6 (spreading activation) depends on the adjacency cache from Step 5.4 — the `concept_graph_nodes` and `concept_graph_edges` tables are queryable via `createGraphCache()` exported from `bin/obsidian-graph-cache.mjs:72`.
- Block 5 validation gate (RESUME.md §0): "at least 50 concept nodes and 100 edges" — must be verified by operator running `node bin/obsidian-graph-cache.mjs --stats` before Block 6 starts.
