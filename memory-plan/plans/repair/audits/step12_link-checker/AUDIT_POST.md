# AUDIT_POST — Step 2.4: Vault link-integrity checker (R9)

(§0: Block 2, step 4/11, 12/48; the instrument the rest of the block verifies against; still-right-next: yes.)

## Files-vs-plan ledger

| Planned | Actual | Notes |
|---|---|---|
| `lib/obsidian-link-checker.mjs` (new) | ✓ | `checkVaultLinks(vaultPath)` — walks all .md, indexes basenames + frontmatter aliases, classifies every wikilink: **resolved** (Obsidian-exact incl. aliases, case-insensitive, #heading/|alias handled), **slugResolvable** (the writer-emits-names/files-are-slugs gap — 2.8's fix space), **dangling** (no note at all); plus **orphans** (zero inbound). Normalizes stray YAML-list brackets (`related: [[[A]], …]`). Read-only. |
| `bin/vault-check.mjs` (new) | ✓ | CLI: human summary with capped lists, `--json` full report, `--vault` override. |
| `test/obsidian-link-checker.test.mjs` (new) | ✓ | 4 tests: classification matrix, orphans, seed-detect-remove, missing-vault no-throw. |

## Verification (Phase 5 — the Proof)

- **Tests:** 4/4.
- **Live vault run:** 75 notes, 1213 wikilinks → **488 resolved / 204 slug-resolvable / 521 dangling / 28 orphans**, with per-link file→target lists.
- **Seed cycle:** `[[repair-2-4-seeded-dangling-target]]` appended to a real note → detected by name in `dangling`; removed → gone from the report. Totals stable.

## Findings (instrument's first readings — Block 2's work queue quantified)

1. **Only 40% of vault wikilinks resolve in Obsidian terms.** 204 links are name→slug resolvable (notes carry no `aliases:` frontmatter, links use entity names, files use slugs) — 2.8's primary fix. **521 are truly dangling**, dominated by `[[sessions/<uuid>]]` references to session notes that were never written — 2.6/2.9 territory (session-note coverage), plus name-variant entities.
2. Two self-inflicted bugs caught during verification, fixed in-step: `process.exit(0)` truncating large JSON stdout; YAML inline-list brackets leaking into link targets (42 links misclassified slug instead of exact).

## Carry-forwards
- 2.5 wires this checker onto the synthesis cadence (counts into the synthesized event payload → watcher/mission-control).
- 2.6's coverage report consumes the same classifications + the db side.
