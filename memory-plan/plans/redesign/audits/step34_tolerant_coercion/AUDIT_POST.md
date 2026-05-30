# AUDIT_POST — Step 3.4: Make tolerant extraction coercion the running path

**Closed:** 2026-05-30 · **Version:** v3.4 · closes Block 3

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §3) | Actual | Match |
|---|---|---|
| No lib change — `coerceExtractionResult` already wired + schema-complete | Confirmed. `extractStructured` (`extraction-prompt.mjs:369-370`) runs coerce→validate; coerce emits all 6 arrays unconditionally. No production code edited. | ✓ |
| ADD regression test: missing-arrays + bad-enum coerce→validate does not throw | Done — `test/extraction-prompt.test.mjs`: `coerce → validate does not throw when arrays are missing / enums are bad` (raw with only `entities`+bad enum+salience 2 → all 6 keys, `doesNotThrow`, salience clamped to 1, missing arrays filled with `[]`). | ✓ |

## 2. Greppable deltas

```
test/extraction-prompt.test.mjs  — import { validateExtractionResult } from '../lib/extraction-schema.mjs'
test/extraction-prompt.test.mjs  — it('coerce → validate does not throw when arrays are missing / enums are bad')
```

(No `lib/` delta — the running path already coerces. Runtime == repo via the `lib` symlink; the daemon loaded this code at its 2026-05-30 boot.)

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Regression + full suite | `node --test test/extraction-prompt.test.mjs` → 33/33. Full node suite green (1426/0 incl. the new case). |
| Coerce→validate completeness | Empirically: `coerceExtractionResult({entities:[{type:"Security",salience:2}]})` → all 6 keys, `validateExtractionResult` returns OK, bad enum salvaged via alias, salience clamped, missing arrays `[]`. |
| **INVENTORY done-criterion: extraction success-rate >95% over a 10-session sample** | **MET — 10/10 = 100%.** Drove the deployed `extractStructured` (LLM path, `qwen3:8b`) over the 10 largest real gateway sessions (msgs 16–85). Every extraction returned a valid result; zero throws / zero regex fallbacks. One session (`11edd5ea`) returned an empty result — a clean noop, not a failure (the tolerance point: empty/odd model output coerces to a valid empty result instead of throwing). |

## 4. Carry-forwards

- Block 3 (ingest/extract correctness) is **complete**: 3.1 (append-delta re-import), 3.2 (tool entries preserved), 3.3 (turn_index), 3.4 (tolerant coercion).
- Residual extraction failure mode = total non-JSON model output (`extractStructured:361` throws → regex fallback). Genuine model failure, surfaced by the watcher's `extraction_failure` alert; not a coercion concern.
- Next: Block 4 — synthesis (step 4.1, generate structured MEMORY.md from entity/theme/decision tables, emits `memory.synthesized`).
