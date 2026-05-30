# AUDIT_PRE — Step 3.4: Make tolerant extraction coercion the running path

## §0 Re-orient

- Where am I: Block 3 (ingest/extract correctness), step 4/4, 18/40 overall.
- Last step changed: 3.3 — `mentions.turn_index` now stamped from session messageCount (`79605ab`).
- This step contributes: extractions stop silently dying on Zod validation (bad enums, missing arrays), so the success-rate the watcher tracks is high and real memory keeps flowing.
- Block serves the north star via: MEMORY_REDESIGN L3 §107 — "Extraction silently failing Zod validation → tolerant coercion + the watcher surfaces the failure rate."
- Still the right next step? Yes — closes Block 3.

## 1. Intent

`extractStructured` must not throw away an entire 1–15 min LLM extraction because the model emitted one bad enum (`"Security"` instead of `concept`) or omitted an array (`actions`). MEMORY_REDESIGN: "the repo's `coerceExtractionResult` exists; ensure it's the running version post-L0."

## 2. Finding (investigation before editing)

The tolerant path is **already wired and provably complete**:

- `lib/extraction-prompt.mjs:369-370` — `extractStructured` runs `coerceExtractionResult(parsed)` then `validateExtractionResult(coerced)`. This is the running path (`USE_LLM_EXTRACTION` default true → `extractStructured` in `runFlush`).
- `coerceExtractionResult` (`:152-205`) emits **all six** arrays unconditionally (`filterMap` returns `[]` for a non-array), drops un-mappable enum items, clamps `salience`/`confidence` to [0,1], defaults missing `severity` to `medium`, and drops items missing required strings.
- Therefore coerce output **always** satisfies `ExtractionResultSchema`, so `coerce → validate` cannot throw on coerced input. Verified empirically: `coerceExtractionResult({entities:[{type:"Security",salience:2},...]})` → all 6 keys present, bad enum salvaged via alias, salience clamped to 1, `validateExtractionResult` returns OK.
- Runtime == repo (lib symlink), and the daemon loaded this code at its 2026-05-30 boot — so the deployed running path already coerces.
- The watcher already surfaces the failure rate (Block 2: v2.6 `extraction_failure_rate` anomaly alert).

The only residual failure mode is the LLM returning non-JSON entirely (`extractStructured:361` throws → `runFlush` regex fallback). That is a genuine model failure, not a coercion gap, and is out of scope for "tolerant coercion."

## 3. So this step is: lock + verify (no production code change)

| File | Delta |
|---|---|
| `test/extraction-prompt.test.mjs` | ADD a regression test: a raw object missing arrays + carrying a bad enum goes `coerceExtractionResult → validateExtractionResult` **without throwing**, yielding all 6 arrays. Locks 3.4's exact intent (the existing tests cover per-field coercion but not the end-to-end "missing-arrays does not throw" property). |
| (no lib change) | `coerceExtractionResult` is already the running version and schema-complete. |

## 4. Done-evidence (to produce in AUDIT_POST)

- Regression test green; full suite green.
- **Runtime:** drive the deployed `extractStructured` (LLM path) over a 10-real-session sample; extraction success-rate (returns a valid result, no throw/regex-fallback) **>95%**.

## 5. Risk register

| Risk | Mitigation |
|---|---|
| "No code change" hides a real gap | Verified coerce→validate completeness empirically + by reading the schema; the regression test pins it. |
| 10-session run pollutes prod | Measure success via direct `extractStructured` calls on session tails — no store writes, no MEMORY.md mutation. |
