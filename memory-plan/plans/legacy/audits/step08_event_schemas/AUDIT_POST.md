# AUDIT_POST — Step 1.1: Create packages/event-schemas (zod envelope + memory event payloads + discriminated union)

**Version:** v1.1-mid
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | `package.json` (root): add `workspaces` + `pretest` | `package.json:43` (workspaces), `package.json:47` (pretest) | yes | `grep -n 'workspaces' package.json` → line 43 |
| 2 | `packages/event-schemas/package.json` (new) | `packages/event-schemas/package.json:1` | yes | `grep -n 'zod' packages/event-schemas/package.json` → lines 17, 18 |
| 3 | `packages/event-schemas/tsconfig.json` (new) | `packages/event-schemas/tsconfig.json:1` | yes | `grep -n 'outDir' packages/event-schemas/tsconfig.json` → line 6 |
| 4 | `packages/event-schemas/src/envelope.ts` (new) | `packages/event-schemas/src/envelope.ts:3` | yes | `grep -n 'EventEnvelopeSchema' packages/event-schemas/src/envelope.ts` → lines 3, 20 |
| 5 | `packages/event-schemas/src/memory/session-started.ts` (new) | `packages/event-schemas/src/memory/session-started.ts:4` | yes | `grep -n 'SessionStartedSchema' ...` → lines 4, 13 |
| 6 | `packages/event-schemas/src/memory/session-ended.ts` (new) | `packages/event-schemas/src/memory/session-ended.ts:4` | yes | `grep -n 'SessionEndedSchema' ...` → lines 4, 14 |
| 7 | `packages/event-schemas/src/memory/turn-recorded.ts` (new) | `packages/event-schemas/src/memory/turn-recorded.ts:4` | yes | `grep -n 'TurnRecordedSchema' ...` → lines 4, 15 |
| 8 | `packages/event-schemas/src/memory/fact-extracted.ts` (new) | `packages/event-schemas/src/memory/fact-extracted.ts:4` | yes | `grep -n 'FactExtractedSchema' ...` → lines 4, 15 |
| 9 | `packages/event-schemas/src/memory/concept-mentioned.ts` (new) | `packages/event-schemas/src/memory/concept-mentioned.ts:4` | yes | `grep -n 'ConceptMentionedSchema' ...` → lines 4, 14 |
| 10 | `packages/event-schemas/src/memory/snapshot-taken.ts` (new) | `packages/event-schemas/src/memory/snapshot-taken.ts:4` | yes | `grep -n 'SnapshotTakenSchema' ...` → lines 4, 14 |
| 11 | `packages/event-schemas/src/memory/compaction-triggered.ts` (new) | `packages/event-schemas/src/memory/compaction-triggered.ts:4` | yes | `grep -n 'CompactionTriggeredSchema' ...` → lines 4, 14 |
| 12 | `packages/event-schemas/src/memory/artifact-attached.ts` (new) | `packages/event-schemas/src/memory/artifact-attached.ts:4` | yes | `grep -n 'ArtifactAttachedSchema' ...` → lines 4, 15 |
| 13 | `packages/event-schemas/src/memory/index.ts` (new) | `packages/event-schemas/src/memory/index.ts:1` | yes | `grep -n 'export' packages/event-schemas/src/memory/index.ts` → 8 lines |
| 14 | `packages/event-schemas/src/events.ts` (new) | `packages/event-schemas/src/events.ts:11` | yes | `grep -n 'MemoryEventSchema' packages/event-schemas/src/events.ts` → lines 11, 22 |
| 15 | `packages/event-schemas/src/index.ts` (new) | `packages/event-schemas/src/index.ts:1` | yes | `grep -n 'export' packages/event-schemas/src/index.ts` → lines 4, 5, 6, 17 |
| 16 | `test/event-schemas.test.mjs` (new) | `test/event-schemas.test.mjs:1` | yes | `grep -n 'event-schemas' test/event-schemas.test.mjs` → line 16 |

All 16 rows landed = yes. 16 non-audit non-ledger files in planned diff = 16 unique files changed.

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'workspaces' package.json` | `43:  "workspaces": [` |
| 2 | `grep -n 'zod' packages/event-schemas/package.json` | `17:    "zod": "^3.23.0",` |
| 3 | `grep -n 'outDir' packages/event-schemas/tsconfig.json` | `6:    "outDir": "dist",` |
| 4 | `grep -n 'EventEnvelopeSchema' packages/event-schemas/src/envelope.ts` | `3:export const EventEnvelopeSchema = z.object({` |
| 5 | `grep -n 'SessionStartedSchema' packages/event-schemas/src/memory/session-started.ts` | `4:export const SessionStartedSchema = EventEnvelopeSchema.extend({` |
| 6 | `grep -n 'SessionEndedSchema' packages/event-schemas/src/memory/session-ended.ts` | `4:export const SessionEndedSchema = EventEnvelopeSchema.extend({` |
| 7 | `grep -n 'TurnRecordedSchema' packages/event-schemas/src/memory/turn-recorded.ts` | `4:export const TurnRecordedSchema = EventEnvelopeSchema.extend({` |
| 8 | `grep -n 'FactExtractedSchema' packages/event-schemas/src/memory/fact-extracted.ts` | `4:export const FactExtractedSchema = EventEnvelopeSchema.extend({` |
| 9 | `grep -n 'ConceptMentionedSchema' packages/event-schemas/src/memory/concept-mentioned.ts` | `4:export const ConceptMentionedSchema = EventEnvelopeSchema.extend({` |
| 10 | `grep -n 'SnapshotTakenSchema' packages/event-schemas/src/memory/snapshot-taken.ts` | `4:export const SnapshotTakenSchema = EventEnvelopeSchema.extend({` |
| 11 | `grep -n 'CompactionTriggeredSchema' packages/event-schemas/src/memory/compaction-triggered.ts` | `4:export const CompactionTriggeredSchema = EventEnvelopeSchema.extend({` |
| 12 | `grep -n 'ArtifactAttachedSchema' packages/event-schemas/src/memory/artifact-attached.ts` | `4:export const ArtifactAttachedSchema = EventEnvelopeSchema.extend({` |
| 13 | `grep -n 'export' packages/event-schemas/src/memory/index.ts` | `1:export { SessionStartedSchema, ...` |
| 14 | `grep -n 'MemoryEventSchema' packages/event-schemas/src/events.ts` | `11:export const MemoryEventSchema = z.discriminatedUnion('event_type', [` |
| 15 | `grep -n 'export' packages/event-schemas/src/index.ts` | `4:export { EventEnvelopeSchema, type EventEnvelope } from './envelope.js';` |
| 16 | `grep -n 'event-schemas' test/event-schemas.test.mjs` | `16:} from '../packages/event-schemas/dist/index.js';` |

## §3 — Cross-references still valid

- All new files are self-contained within the `packages/event-schemas/` directory with no external imports besides `zod` and `zod-to-json-schema`.
- The test file imports from `../packages/event-schemas/dist/index.js` (compiled output, generated by `pretest` script).
- No existing files import from the new package. Zero stale reference risk.
- The root `package.json` change (`workspaces`, `pretest`) is additive — existing scripts are unmodified.
- The `pretest` script uses `npm run --workspaces --if-present build` which is safe for existing packages (none have a `build` script, so `--if-present` skips them).

## §4 — Findings

- [POSITIVE] All 16 planned file deltas landed exactly as specified. Zero deviations from AUDIT_PRE §6.
- [POSITIVE] Envelope schema matches REFERENCE_PLAN §1.1 specification field-for-field: `event_id`, `event_type`, `event_version`, `entity_id`, `entity_type`, `timestamp`, `causation_id`, `correlation_id`, `actor`, `node_id`, `idempotency_key`.
- [POSITIVE] All 8 memory event schemas follow a consistent pattern: `EventEnvelopeSchema.extend()` with a literal `event_type` discriminator and a typed `data` payload.
- [POSITIVE] The discriminated union `MemoryEventSchema` correctly routes parsing by `event_type` — verified by test that both valid and invalid event types behave correctly.
- [POSITIVE] 15 new tests all pass. 73 pre-existing failures unchanged.
- [NEGATIVE] The `packages/event-schemas/dist/` directory (tsc compiled output) is not covered by `.gitignore`. Without a gitignore entry, `git add -A` in Phase 9g would stage ~20 compiled `.js`/`.d.ts`/`.js.map` files as phantom changes, failing Deep Review Gate CHECK 4. **Requires Phase 8 patch.**
- [POSITIVE] Build script workaround (referencing mission-control's tsc) is functional and documented. The `as any` cast in `toJsonSchema()` is minimal and correctly scoped to the Zod 4 vs 3 type incompatibility. Both resolve when `npm install` runs with proper workspace dep resolution.

6 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

**Patch 1 — Add `.gitignore` entry for workspace dist/ directories**

- Trigger: §4 NEGATIVE finding. `packages/event-schemas/dist/` is compiled output that must not be committed.
- File: `.gitignore` (root)
- Minimal diff: append `packages/*/dist/` after the existing `skills/dist/` line.
- Justification: Without this, `git add -A` stages ~20 compiled files as phantom changes, failing Deep Review Gate CHECK 4. The pattern `packages/*/dist/` covers future workspace packages too.

## §6 — Carry-forwards to Step 1.2

- Test baseline is now 497 tests (424 pass, 73 fail — pre-existing). +15 tests added this step.
- `npm install` was blocked during this tick. The event-schemas `package.json` declares `zod@^3.23.0` and `typescript@^5.4.0` but the workspace is currently using the root `node_modules` Zod 4.x and mission-control's TypeScript 5.9.3. When `npm install` runs properly, it will install Zod 3.x in the workspace and the `as any` cast in `toJsonSchema()` can be removed. The build script path (`../../mission-control/node_modules/typescript/bin/tsc`) should be reverted to plain `tsc` once typescript is installed as a workspace devDep.
- The `packages/event-schemas/dist/` directory is built by the `pretest` script. After cloning, `npm test` triggers the build automatically.
- `docs/ARCHITECTURE.md` stale references remain (out of scope).
- `docs/STATE_FILES.md` should be updated to mention the event-schemas package (deferred).
- COMPANION variable name, test fixture `confidence`, `pre-compact.sh` stub — all carried forward unchanged.
- Step 1.2 will create `lib/local-event-log.mjs` which imports from the event-schemas package. It needs `MemoryEventSchema` for validation and the individual schemas for type-specific construction.
