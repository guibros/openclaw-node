# AUDIT_PRE — Step 1.1: Create packages/event-schemas (zod envelope + memory event payloads + discriminated union)

**Version:** v1.1-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Create the `packages/event-schemas` workspace package — the foundational schema layer for
the event-sourced memory infrastructure. This package defines Zod schemas for the event
envelope and all eight memory event payload types, exports a discriminated union for
runtime validation, and provides TypeScript types via `z.infer<>`. It also exposes a
JSON Schema generation function for cross-language consumers.

This is the first step of Block 1 (Schema & event foundations) and the first step that
introduces TypeScript and Zod into the project. The npm workspaces feature is enabled
at the root level to support the new `packages/*` workspace layout.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [A] | Create packages/event-schemas (zod envelope + memory event payloads + discriminated union) |

## §3 — Design decisions (consumed from prior carry-forwards)

From AUDIT_POST Step 0.7 §6 + BLOCK_0_COMPLETE carry-forwards:

- Test baseline remains 482 tests (409 pass, 73 fail — pre-existing).
- `docs/ARCHITECTURE.md` stale references are out of scope for this step.
- `docs/STATE_FILES.md` should be updated as Block 1 adds new state files — deferred to later step.
- COMPANION variable name, test fixture `confidence`, `pre-compact.sh` stub — all deferred.
- Zod enters as a dependency via the new workspace package (not a root dependency).

From RESUME.md §0 Block 1 frozen decisions:

- **File list:** exactly per REFERENCE_PLAN §1.1 and §0 enumeration.
- **Package manager:** npm workspaces. Add `"workspaces": ["packages/*"]` to root `package.json`.
- **Zod version:** `^3.23.0` (latest 3.x stable).
- **Dependencies:** `zod` + `zod-to-json-schema` as runtime deps; `typescript` as devDep.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | npm workspace install changes `node_modules` layout, breaking existing imports | MEDIUM | npm workspaces with a single new package are additive; existing deps resolve unchanged. Run full test suite at Phase 5 to confirm. |
| 2 | TypeScript compilation fails or produces incompatible output | LOW | Use conservative tsconfig (ES2020 target, NodeNext module). Build before test. |
| 3 | Zod 3.x discriminatedUnion API incompatibility | LOW | `z.discriminatedUnion` is stable since Zod 3.20. Use `^3.23.0` as frozen. |
| 4 | `npm test` doesn't pick up new test file | LOW | New file follows `test/*.test.mjs` glob pattern, which matches the test script. |

No HIGH-severity risks.

## §5 — Deferrals

- JSON Schema output validation (beyond `toJsonSchema` function export) — deferred until a consumer exists.
- Runtime schema registration / plugin system — not in scope; schemas are static imports.
- `docs/STATE_FILES.md` update for new package — deferred to Step 1.2 or later.

## §6 — Phase 4 implementation outline

| # | File | Delta | Grep evidence command |
|---|------|-------|----------------------|
| 1 | `package.json` (root) | Add `"workspaces": ["packages/*"]` field + `"pretest": "npm run --workspaces --if-present build"` script | `grep -n 'workspaces' package.json` |
| 2 | `packages/event-schemas/package.json` | New: package manifest with name, version, deps (zod, zod-to-json-schema), devDeps (typescript), build script, exports | `grep -n 'zod' packages/event-schemas/package.json` |
| 3 | `packages/event-schemas/tsconfig.json` | New: TypeScript config targeting ES2020/NodeNext, outDir dist/ | `grep -n 'outDir' packages/event-schemas/tsconfig.json` |
| 4 | `packages/event-schemas/src/envelope.ts` | New: `EventEnvelopeSchema` with all fields per REFERENCE_PLAN §1.1 | `grep -n 'EventEnvelopeSchema' packages/event-schemas/src/envelope.ts` |
| 5 | `packages/event-schemas/src/memory/session-started.ts` | New: `SessionStartedSchema` payload schema | `grep -n 'SessionStartedSchema' packages/event-schemas/src/memory/session-started.ts` |
| 6 | `packages/event-schemas/src/memory/session-ended.ts` | New: `SessionEndedSchema` payload schema | `grep -n 'SessionEndedSchema' packages/event-schemas/src/memory/session-ended.ts` |
| 7 | `packages/event-schemas/src/memory/turn-recorded.ts` | New: `TurnRecordedSchema` payload schema | `grep -n 'TurnRecordedSchema' packages/event-schemas/src/memory/turn-recorded.ts` |
| 8 | `packages/event-schemas/src/memory/fact-extracted.ts` | New: `FactExtractedSchema` payload schema | `grep -n 'FactExtractedSchema' packages/event-schemas/src/memory/fact-extracted.ts` |
| 9 | `packages/event-schemas/src/memory/concept-mentioned.ts` | New: `ConceptMentionedSchema` payload schema | `grep -n 'ConceptMentionedSchema' packages/event-schemas/src/memory/concept-mentioned.ts` |
| 10 | `packages/event-schemas/src/memory/snapshot-taken.ts` | New: `SnapshotTakenSchema` payload schema | `grep -n 'SnapshotTakenSchema' packages/event-schemas/src/memory/snapshot-taken.ts` |
| 11 | `packages/event-schemas/src/memory/compaction-triggered.ts` | New: `CompactionTriggeredSchema` payload schema | `grep -n 'CompactionTriggeredSchema' packages/event-schemas/src/memory/compaction-triggered.ts` |
| 12 | `packages/event-schemas/src/memory/artifact-attached.ts` | New: `ArtifactAttachedSchema` payload schema | `grep -n 'ArtifactAttachedSchema' packages/event-schemas/src/memory/artifact-attached.ts` |
| 13 | `packages/event-schemas/src/memory/index.ts` | New: barrel re-export of all 8 memory event schemas | `grep -n 'export' packages/event-schemas/src/memory/index.ts` |
| 14 | `packages/event-schemas/src/events.ts` | New: `MemoryEventSchema` discriminated union of all 8 event types | `grep -n 'MemoryEventSchema' packages/event-schemas/src/events.ts` |
| 15 | `packages/event-schemas/src/index.ts` | New: package entry point re-exporting envelope, events, and toJsonSchema helper | `grep -n 'export' packages/event-schemas/src/index.ts` |
| 16 | `test/event-schemas.test.mjs` | New: schema validation tests (~10 tests: envelope parse, reject malformed, each event type parse, discriminated union routing, JSON Schema generation) | `grep -n 'event-schemas' test/event-schemas.test.mjs` |

16 file deltas total (1 modified, 15 new).
