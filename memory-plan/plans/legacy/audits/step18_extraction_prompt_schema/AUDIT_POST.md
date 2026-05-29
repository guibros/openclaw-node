# AUDIT_POST — Step 3.2: Design extraction prompt + Zod schema (entities/themes/actions/decisions/friction/relationships)

**Version:** v3.2-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create extraction schema: ExtractionResultSchema with sub-schemas, validateExtractionResult | `lib/extraction-schema.mjs:57` (ExtractionResultSchema), `:73` (validateExtractionResult) | yes | `grep -n 'export const ExtractionResultSchema' lib/extraction-schema.mjs` → `57` |
| 2 | Create extraction prompt + runner: buildExtractionPrompt, extractStructured | `lib/extraction-prompt.mjs:71` (buildExtractionPrompt), `:96` (extractStructured) | yes | `grep -n 'export function buildExtractionPrompt' lib/extraction-prompt.mjs` → `71` |
| 3 | 6 tests (delivered 7): schema validation ×4, prompt builder ×1, extraction runner ×2 | `test/extraction-schema.test.mjs` (full file, 7 `it()` blocks) | yes | `grep -c 'it(' test/extraction-schema.test.mjs` → `7` |

All 3 rows landed = yes. 3 non-audit non-ledger files in staged diff (lib/extraction-schema.mjs, lib/extraction-prompt.mjs, test/extraction-schema.test.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'export const ExtractionResultSchema' lib/extraction-schema.mjs` | `57:export const ExtractionResultSchema = z.object({` |
| 2 | `grep -n 'export function validateExtractionResult' lib/extraction-schema.mjs` | `73:export function validateExtractionResult(data) {` |
| 3 | `grep -n 'export function buildExtractionPrompt' lib/extraction-prompt.mjs` | `71:export function buildExtractionPrompt(messages) {` |
| 4 | `grep -n 'export async function extractStructured' lib/extraction-prompt.mjs` | `96:export async function extractStructured(client, messages) {` |
| 5 | `grep -c 'it(' test/extraction-schema.test.mjs` | `7` |

## §3 — Cross-references still valid

- `ExtractionResultSchema`, `validateExtractionResult`, `EntitySchema`, `ENTITY_TYPES`, `ACTION_TYPES` exported from `lib/extraction-schema.mjs` — imported by `test/extraction-schema.test.mjs:5-8`.
- `validateExtractionResult` imported by `lib/extraction-prompt.mjs:13` from `./extraction-schema.mjs`.
- `buildExtractionPrompt`, `extractStructured` exported from `lib/extraction-prompt.mjs` — imported by `test/extraction-schema.test.mjs:10-13`.
- No pre-existing symbols renamed or deleted.
- Grep for `ExtractionResultSchema|validateExtractionResult|buildExtractionPrompt|extractStructured` returns only the 3 new files + audit docs. Zero stale cross-references.

## §4 — Findings

- [POSITIVE] The schema uses Zod v4.3.6 (hoisted from workspace) with standard `z.object`/`z.enum`/`z.array`/`z.number` patterns — no v4-specific API issues encountered.
- [POSITIVE] Entity type enum, action enum, severity enum, and relationship type enum are all exported as plain arrays alongside the Zod schemas, enabling both runtime validation and programmatic enumeration of valid values.
- [POSITIVE] The prompt template is self-contained with clear instructions, explicit schema description in JSON format, and rules for the LLM (canonical names, salience interpretation, empty array handling).
- [POSITIVE] `extractStructured` cleanly separates the three failure modes: HTTP/network errors (from client.generate), JSON parse errors (caught with descriptive message including raw content preview), and schema validation errors (Zod errors propagated directly).
- [POSITIVE] `buildExtractionPrompt` filters out tool-role messages from the transcript, only including user and assistant messages — matching the existing `extractFacts` role filter.
- [POSITIVE] Tests use mock clients (plain objects with async `generate` methods) — zero dependency on live LLM server, consistent with the mock-server pattern from Step 3.1.

6 POSITIVE findings, 0 NEGATIVE findings.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 3.3

- Test baseline is now 570 tests (497 pass, 73 fail pre-existing). +7 tests added this step (planned 6, delivered 7 — empty-array boundary test added).
- `lib/extraction-schema.mjs` exports `ExtractionResultSchema`, `validateExtractionResult(data)`, plus sub-schemas (`EntitySchema`, `ThemeSchema`, `DecisionSchema`, `FrictionSignalSchema`, `RelationshipSchema`) and enum arrays (`ENTITY_TYPES`, `ACTION_TYPES`, `SEVERITY_LEVELS`, `RELATIONSHIP_TYPES`).
- `lib/extraction-prompt.mjs` exports `buildExtractionPrompt(messages)` and `extractStructured(client, messages)`. Step 3.3 wires `extractStructured` into the daemon as a replacement for the regex `extractFacts`, behind a `USE_LLM_EXTRACTION` feature flag.
- `extractStructured` expects a client from `createLlmClient()` (Step 3.1) and an array of `{role, content}` messages. Returns a validated `ExtractionResult` or throws.
- The schema covers 6 categories: entities (name/type/salience), themes (label/hierarchy), actions (enum), decisions (decision/rationale/confidence), friction_signals (signal/severity), relationships (source/target/type).
- Phase-4-correction streak: 0 (reset — test count underestimate: planned 6, delivered 7).
- Phase-8-patch streak: 7 (Steps 2.1–3.2, zero patches).
