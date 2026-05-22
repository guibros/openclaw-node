# AUDIT_PRE — Step 3.2: Design extraction prompt + Zod schema (entities/themes/actions/decisions/friction/relationships)

**Version:** v3.2-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Design the structured-output extraction schema and prompt template that will replace the regex-based `extractFacts` in Step 3.3. This step creates the schema (`ExtractionResultSchema` via Zod) and the prompt builder/extractor that drives Qwen3.5-27B to produce structured JSON matching the schema. No daemon wiring yet — that's Step 3.3.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.2 | v3.2 | [A] | Design extraction prompt + Zod schema (entities/themes/actions/decisions/friction/relationships) |

## §3 — Design decisions (from Step 3.1 AUDIT_POST §6 carry-forwards)

- Test baseline is now 563 tests (490 pass, 73 fail pre-existing). +4 tests added in Step 3.1.
- `lib/llm-client.mjs` exports `createLlmClient({ baseUrl, model, timeout })` returning `{ generate(messages, opts), healthCheck() }`. Step 3.2 imports this for the extraction pipeline.
- `generate()` supports `{ jsonMode: true }` for structured output via `response_format: { type: 'json_object' }`.
- `bin/llm-benchmark.mjs` exports `generateSyntheticSession(turnCount)` and `runBenchmark(client, turns)` for programmatic use.
- `DEFAULT_MODEL` is set to `mlx-community/Qwen2.5-27B-Instruct-4bit`. Operator should verify against local installation.
- Phase-4-correction streak: 1 (Step 3.1 — zero corrections).
- Phase-8-patch streak: 6 (Steps 2.1–3.1, zero patches).
- Zod v4.3.6 is available in root `node_modules/` (hoisted from `packages/event-schemas` workspace dependency). Import via `import { z } from 'zod'` in `.mjs` files.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Zod v4 API differences from v3 examples in REFERENCE_PLAN | LOW | REFERENCE_PLAN used v3-style syntax; Zod v4 is largely compatible for basic `z.object`/`z.enum`/`z.array`/`z.number`. Verify at implementation. |
| LLM JSON output may not always be valid JSON | LOW | `extractStructured` wraps JSON.parse in try/catch and returns a clear error. Step 3.3 adds the daemon retry/fallback logic. |
| Schema shape may need adjustment after Step 3.3/3.4 validation | LOW | Schema is designed to match REFERENCE_PLAN verbatim. Adjustments (if needed) are carry-forwards from Step 3.4. |

No HIGH-severity risks. All risks pre-resolved.

## §5 — Deferrals

- Daemon wiring of `extractStructured` into `pre-compression-flush.mjs` → Step 3.3.
- SQLite tables for entities/themes/mentions/decisions → Step 3.3.
- Feature flag `USE_LLM_EXTRACTION` → Step 3.3.
- Prompt iteration based on real session evaluation → Step 3.4.

## §6 — Phase 4 implementation outline

| # | Delta | File | Type |
|---|-------|------|------|
| 1 | Create extraction schema: `ExtractionResultSchema` with sub-schemas for entities (name, type enum, salience), themes (label, hierarchy), actions (enum), decisions (decision, rationale, confidence), friction_signals (signal, severity enum), relationships (source, target, type enum). Export `validateExtractionResult(data)` convenience function. | `lib/extraction-schema.mjs` | new |
| 2 | Create extraction prompt + runner: `buildExtractionPrompt(messages)` formats session tail into system+user message pair with schema description and examples. `extractStructured(client, messages)` calls `client.generate()` with JSON mode, parses response, validates against schema, returns result. | `lib/extraction-prompt.mjs` | new |
| 3 | 6 tests: (1) valid ExtractionResult passes schema, (2) missing required field fails, (3) invalid entity type fails, (4) buildExtractionPrompt returns well-formed messages, (5) extractStructured validates mock LLM response, (6) extractStructured rejects malformed JSON. | `test/extraction-schema.test.mjs` | new |

## Mid-Implementation Findings

- **Test count underestimate.** Planned 6 tests, delivered 7. Added an unplanned test `accepts a result with all empty arrays` to verify the minimal valid input case (all-empty arrays). This is a natural boundary-condition test that improves coverage. Phase-4-correction streak resets to 0.
