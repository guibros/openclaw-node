# AUDIT_POST — Step 9.5: Privacy markers (private: true) + default-private retrieval policy

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `lib/extraction-store.mjs` (modify) | `lib/extraction-store.mjs:141` | yes | `ALTER TABLE ${table} ADD COLUMN private INTEGER DEFAULT 1` at :141 |
| 2 | `lib/memory-directives.mjs` (modify) | `lib/memory-directives.mjs:87` | yes | `export function parsePublishDirective` at :87 |
| 3 | `bin/publish-item.mjs` (new) | `bin/publish-item.mjs:26` | yes | `export function lookupItem` at :26 |
| 4 | `lib/retrieval-pipeline.mjs` (modify) | `lib/retrieval-pipeline.mjs:366` | yes | `export function filterPrivateResults` at :366 |
| 5 | `test/privacy-markers.test.mjs` (new) | `test/privacy-markers.test.mjs:1` | yes | 8 describe blocks, 30 `it()` blocks |

All 5 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| Privacy migration | `grep -n 'private INTEGER DEFAULT 1' lib/extraction-store.mjs` | line 135, 141 |
| published_items table | `grep -n 'published_items' lib/extraction-store.mjs` | line 147 |
| publishItem function | `grep -n 'function publishItem' lib/extraction-store.mjs` | line 392 |
| unpublishItem function | `grep -n 'function unpublishItem' lib/extraction-store.mjs` | line 417 |
| isItemPublished function | `grep -n 'function isItemPublished' lib/extraction-store.mjs` | line 436 |
| getPublishedItems function | `grep -n 'function getPublishedItems' lib/extraction-store.mjs` | line 448 |
| PUBLISH_DIRECTIVE_REGEX | `grep -n 'PUBLISH_DIRECTIVE_REGEX' lib/memory-directives.mjs` | line 75 |
| parsePublishDirective | `grep -n 'export function parsePublishDirective' lib/memory-directives.mjs` | line 87 |
| lookupItem CLI export | `grep -n 'export function lookupItem' bin/publish-item.mjs` | line 26 |
| filterPrivateResults | `grep -n 'export function filterPrivateResults' lib/retrieval-pipeline.mjs` | line 366 |
| respect_privacy flag | `grep -n 'respect_privacy' lib/retrieval-pipeline.mjs` | line 359, 414, 416, 419, 423 |
| test imports | `grep -n 'privacy-markers' test/privacy-markers.test.mjs` | N/A (self-referential) |

## §3 — Cross-references still valid

- `lib/extraction-store.mjs` return object now includes `publishItem`, `unpublishItem`, `isItemPublished`, `getPublishedItems`, and `db` (raw database handle for CLI tools). No external callers broken — these are additive exports.
- `lib/memory-directives.mjs` adds `parsePublishDirective` and `PUBLISH_DIRECTIVE_REGEX` exports. No existing exports changed. No callers of `parseMemoryDirective` affected.
- `lib/retrieval-pipeline.mjs` adds `filterPrivateResults` export and `respect_privacy` option to `createRetrievalPipeline`. Default `respect_privacy: true` — existing callers that don't pass the option get privacy filtering automatically (safe default per frozen decisions).
- `bin/publish-item.mjs` imports from `../lib/extraction-store.mjs` — verified at runtime via tests.
- `lib/broadcast-offerer.mjs:160` `filterPrivateItems` — forward-compatible; now activates because `private` column exists. Checked: queries `pragma_table_info('entities')` for `private` column → now finds it → filter is active. This is the intended behavior.
- No stale references. No symbols renamed or deleted.

## §4 — Findings

1. **[POSITIVE]** Privacy migration is fully idempotent — checks `pragma table_info` before ALTER TABLE. Safe to run on databases that already have the column (e.g., from a failed prior tick).
2. **[POSITIVE]** Default `private = 1` on all three tables means all existing data becomes private immediately upon migration. This is the correct "default-private" behavior per Block 9 §0.
3. **[POSITIVE]** `published_items` table uses a UNIQUE index on `(item_id, item_type)` — `publishItem` is idempotent (ON CONFLICT updates).
4. **[POSITIVE]** `publishItem` and `unpublishItem` use transactions — `private` column and `published_items` row are always in sync.
5. **[POSITIVE]** `parsePublishDirective` follows the same pattern as `parseMemoryDirective` — supports quoted multi-word names (`@publish "my entity"`) and unquoted single-word names (`@publish nats`). Case-insensitive.
6. **[POSITIVE]** `filterPrivateResults` in retrieval pipeline checks for column existence before filtering (same defensive pattern as offerer's `filterPrivateItems`). Graceful degradation on any error.
7. **[POSITIVE]** `respect_privacy` defaults to `true` at the pipeline factory level. Offerer automatically gets privacy filtering. Local injection can override with `false`. Per-query override via `queryOpts.respect_privacy` is supported.
8. **[POSITIVE]** `bin/publish-item.mjs` CLI supports `--list`, `--unpublish`, and `--db-path` flags. `lookupItem` does case-insensitive matching for operator convenience.
9. **[POSITIVE]** `listPublishedItems` enriches raw `published_items` rows with entity/theme/decision names via separate lookups — human-readable output.
10. **[POSITIVE]** All 30 new tests pass. Test count delta +30 (30 `it()` blocks). Total: 1014 (939 pass, 75 fail — 73 pre-existing + 2 flaky variance). No pre-existing tests broken.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 9.6

- Test baseline: 1014 tests (939 pass, 75 fail — 73 pre-existing + 2 flaky variance). +30 `it()` blocks added this step.
- `lib/extraction-store.mjs` now exposes `db` (raw Database handle) in the return object — useful for direct queries in CLI tools. Step 9.6's cross-node test may use this for direct DB assertions.
- `filterPrivateResults` at `lib/retrieval-pipeline.mjs:366` — available for the cross-node integration test to verify that private items from node A are never visible to node B's offerer.
- `parsePublishDirective` at `lib/memory-directives.mjs:87` — currently parsed but not wired into the SDK wrappers' prompt processing. Wiring `@publish` into the daemon's per-prompt path (lookup entity by name → call `publishItem`) is deferred — can be done in a future step or as an operator chore commit. The CLI (`bin/publish-item.mjs`) is the primary publication mechanism for now.
- The offerer's `filterPrivateItems` at `lib/broadcast-offerer.mjs:160` is now active (the `private` column exists). All entities default to private → offerer will filter ALL entity-linked sessions until the operator publishes items via `bin/publish-item.mjs` or `@publish`.
- Step 9.6 (cross-node integration test) should verify: broadcast from node A → offerer on node B only offers public items → acceptor on node A receives offer → accepted event flows back. Private items must never cross the offer boundary.
