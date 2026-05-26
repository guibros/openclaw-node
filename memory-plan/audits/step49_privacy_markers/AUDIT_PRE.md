# AUDIT_PRE — Step 9.5: Privacy markers (private: true) + default-private retrieval policy

## §1 — Intent

Implement default-private privacy markers on all extracted data. Every entity, decision, and theme defaults to `private = 1` (never shared). Operators promote items to public via `@publish` directive in chat or `bin/publish-item.mjs` CLI. The retrieval pipeline gains a `respect_privacy` flag (default true for offerer, false for local injection — your own private memory is fair game for your own sessions). This is the final data-sovereignty step before the cross-node integration test (Step 9.6).

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 9 | 9.5 | v9.5 | [A] | Privacy markers (private: true) + default-private retrieval policy |

## §3 — Design decisions (consumed from Step 9.4 AUDIT_POST §6)

- Test baseline: 984 tests (909 pass, 75 fail — 73 pre-existing + 2 flaky variance). +28 `it()` blocks added in Step 9.4.
- `createAcceptor` at `lib/broadcast-acceptor.mjs:136`. Acceptor operates purely on offers received over NATS — does not query the extraction store directly, so privacy filtering does not affect it.
- The offerer's `filterPrivateItems` at `lib/broadcast-offerer.mjs:160` is already forward-compatible with the `private` column — it checks `pragma_table_info` for column existence before querying. This step adds the actual column, making the offerer's filter become active.
- `parseArtifactRef` exports available for future use but not needed for privacy filtering in this step.

Per Block 9 §0 frozen decisions for Step 9.5:
- ALTER TABLE migration: `private INTEGER DEFAULT 1` on `entities`, `decisions`, `themes`. Default = private.
- New table `published_items (item_id, item_type, published_at, published_by_session)` — explicit allowlist.
- Promotion to public via: (1) `@publish` directive in chat, (2) operator-curated `bin/publish-item.mjs` CLI.
- Retrieval pipeline gains `respect_privacy: true` flag (default true). Offerer always passes true; local injection always passes false.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| ALTER TABLE DEFAULT 1 marks ALL existing entities as private, breaking offerer until items are published | LOW | This is the intended behavior per "default-private" policy. The offerer's existing `filterPrivateItems` already handles this gracefully. Operators use `bin/publish-item.mjs` to curate what gets shared. |
| `@publish` directive collision with `@memory` parsing | LOW | `@publish` is a distinct regex pattern from `@memory`. Parsed separately in `memory-directives.mjs`. |
| Retrieval pipeline privacy filter adds latency | LOW | Single indexed SQL query on the `private` column. Negligible cost. |

## §5 — Deferrals

- Granular per-mention privacy (marking individual mentions as private rather than whole entities) — out of scope; whole-entity privacy is sufficient for Block 9.
- Automatic promotion heuristics (e.g., after N shares, auto-publish) — deferred to post-Block 9 tuning.

## §6 — Phase 4 implementation outline

1. **`lib/extraction-store.mjs`** (modify) — Add idempotent ALTER TABLE migration for `private INTEGER DEFAULT 1` on `entities`, `decisions`, `themes`. Create `published_items` table. Add `publishItem(itemId, itemType, sessionId)`, `unpublishItem(itemId, itemType)`, `isItemPublished(itemId, itemType)`, `getPublishedItems()` functions. Add privacy index `idx_entities_private`, `idx_decisions_private`, `idx_themes_private`.
2. **`lib/memory-directives.mjs`** (modify) — Add `@publish <name>` directive regex and parsing alongside existing `@memory` directives. New export `parsePublishDirective(text)` returning `{ name, cleanedText }`.
3. **`bin/publish-item.mjs`** (new) — CLI tool: `node bin/publish-item.mjs --name "entity" --type entity`. Looks up item by name/label, sets `private = 0`, adds to `published_items`. Supports `--unpublish` flag to reverse. Lists published items with `--list`.
4. **`lib/retrieval-pipeline.mjs`** (modify) — Add `respect_privacy` option to `createRetrievalPipeline` factory opts. When true, entity/theme/seed/activation channels filter out results linked to private-only entities. Passed through to `entitySearch`, `themeEntitySearch`, `activationSearch` as an opt.
5. **`test/privacy-markers.test.mjs`** (new) — Tests: privacy migration columns exist, default private value is 1, `publishItem`/`unpublishItem`/`isItemPublished` CRUD, `@publish` directive parsing, retrieval pipeline with `respect_privacy` flag filters private items, offerer `filterPrivateItems` works with real `private` column.
