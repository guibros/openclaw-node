# AUDIT_PRE — Step 5.3: Build wikilink graph parser (lib/obsidian-graph.mjs)

**Version:** v5.3-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Build the wikilink graph parser module that reads all Obsidian-compatible markdown
notes from the vault, parses their frontmatter and body, extracts `[[...]]` wikilinks,
and returns a `{nodes, edges}` graph structure. This is the foundation for the
adjacency cache (Step 5.4) and spreading activation (Block 6).

Per Block 5 frozen decisions, edges are typed: `mentions` (default), `derived_from`,
`contradicts`, `instance_of` — directive parsed from frontmatter when present.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.3 | v5.3 | [A] | Build wikilink graph parser (lib/obsidian-graph.mjs) |

## §3 — Design decisions (from Step 5.2 AUDIT_POST §6)

- Test baseline is 705 tests (628 pass, 77 fail — 73 pre-existing + 4 flaky). +12 tests added in Step 5.2.
- `slugifyName(name)` exported from `lib/obsidian-summarizer.mjs:43` — will import for filename↔node-id matching.
- `buildConceptFrontmatter` at line 59 produces YAML frontmatter with `related: [...]` wikilinks — these are the edges the graph parser will parse.
- `generateConceptNotes` at line 245 writes notes to `<vault>/concepts/` — the parser scans all vault subdirectories.
- Theme linkage per-entity is not implemented in the extraction store (themes table lacks session_id). The graph parser infers connections from vault co-occurrence.
- Decision notes and session notes are not yet generated — the graph parser handles their absence gracefully.

## §4 — Risk register

- LOW: `js-yaml` parsing of frontmatter — well-tested dependency already in use.
- LOW: Large vaults could be slow — bounded by practical vault sizes (<10K notes). No performance concern for initial implementation.
- NONE: All architectural choices are pre-decided in Block 5 §0 (edge types, wikilink convention, export shape).

## §5 — Deferrals

- Decision and session note generation deferred to later steps — the parser handles their future existence.
- Theme notes not yet generated — parser will pick them up when they exist.
- Graph visualization deferred — this step produces data structures only.

## §6 — Phase 4 implementation outline

| # | File | Change | Details |
|---|------|--------|---------|
| 1 | `lib/obsidian-graph.mjs` (new) | Create wikilink graph parser module | Exports: `walkVault(vaultPath)` — recursively scans all `.md` files, returns `{filePath, relativePath, id, subdirectory}` objects. `parseNote(content)` — splits frontmatter (YAML via `js-yaml`) and body, returns `{frontmatter, body}`. `extractWikilinks(text)` — finds all `[[target]]` and `[[target\|display]]` patterns, returns array of target strings. `buildGraph(vaultPath)` — main entry, walks vault, parses each note, builds `{nodes: Map<id, {label, ...frontmatter}>, edges: [{source, target, type}]}`. Edge type defaults to `mentions`; if frontmatter contains `edge_type` key in a `related` entry or `edge_types` mapping, uses that. Imports `getVaultPath` from `obsidian-vault.mjs`, `slugifyName` from `obsidian-summarizer.mjs`. |
| 2 | `test/obsidian-graph.test.mjs` (new) | Tests for graph parser | ~8 tests: walkVault finds files across subdirs, parseNote with frontmatter + body, parseNote without frontmatter, extractWikilinks simple and with display text, buildGraph integration with nodes + edges, buildGraph empty vault, buildGraph with edge type from frontmatter. |
