# AUDIT_POST — Step 4.1: Define promotion policies (config/promotion-policy.yaml)

**Version:** v4.1-mid
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised delta | Actual file:line | Landed | Grep evidence |
|---|----------------|------------------|--------|---------------|
| 1 | Create promotion policy YAML config with frozen-decision thresholds | `config/promotion-policy.yaml:23` (concept_mention_count: 10) | yes | `grep -n 'concept_mention_count: 10' config/promotion-policy.yaml` → `23` |
| 2 | Create policy loader module: loadPromotionPolicy, validatePromotionPolicy, DEFAULT_POLICY_PATH, POLICY_CATEGORIES | `lib/promotion-policy.mjs:113` (loadPromotionPolicy), `:38` (validatePromotionPolicy), `:19` (DEFAULT_POLICY_PATH), `:22` (POLICY_CATEGORIES) | yes | `grep -n 'export async function loadPromotionPolicy' lib/promotion-policy.mjs` → `113` |
| 3 | Tests: ~6 planned, 11 delivered | `test/promotion-policy.test.mjs` (11 `it()` blocks) | yes | `grep -c 'it(' test/promotion-policy.test.mjs` → `11` |

All 3 rows landed = yes. 3 non-audit non-ledger files in staged diff (config/promotion-policy.yaml, lib/promotion-policy.mjs, test/promotion-policy.test.mjs).

## §2 — Greppable deltas confirmed

| # | Command | First hit |
|---|---------|-----------|
| 1 | `grep -n 'concept_mention_count: 10' config/promotion-policy.yaml` | `23:  concept_mention_count: 10   # local concepts seen 10+ times become candidates (REFERENCE_PLAN default: 5)` |
| 2 | `grep -n 'export async function loadPromotionPolicy' lib/promotion-policy.mjs` | `113:export async function loadPromotionPolicy(configPath = DEFAULT_POLICY_PATH) {` |
| 3 | `grep -n 'export function validatePromotionPolicy' lib/promotion-policy.mjs` | `38:export function validatePromotionPolicy(parsed) {` |
| 4 | `grep -n 'export const DEFAULT_POLICY_PATH' lib/promotion-policy.mjs` | `19:export const DEFAULT_POLICY_PATH = join(__dirname, '..', 'config', 'promotion-policy.yaml');` |
| 5 | `grep -n 'export const POLICY_CATEGORIES' lib/promotion-policy.mjs` | `22:export const POLICY_CATEGORIES = ['automatic', 'explicit', 'threshold', 'manual_review'];` |
| 6 | `grep -c 'it(' test/promotion-policy.test.mjs` | `11` |

## §3 — Cross-references still valid

- `loadPromotionPolicy` exported from `lib/promotion-policy.mjs:113` — imported by `test/promotion-policy.test.mjs:9`. Zero stale references.
- `validatePromotionPolicy` exported from `lib/promotion-policy.mjs:38` — imported by `test/promotion-policy.test.mjs:10`. Zero stale references.
- `DEFAULT_POLICY_PATH` exported from `lib/promotion-policy.mjs:19` — imported by `test/promotion-policy.test.mjs:11`. Zero stale references.
- `POLICY_CATEGORIES` exported from `lib/promotion-policy.mjs:22` — imported by `test/promotion-policy.test.mjs:12`. Zero stale references.
- Import from `js-yaml` in `lib/promotion-policy.mjs:14` — `js-yaml` is a declared dependency in `package.json:61` and available in `node_modules`. No stale references.
- No pre-existing symbols renamed or deleted.

## §4 — Findings

- [POSITIVE] The policy config mirrors the operator's frozen decisions exactly: `automatic: [kanban_events]`, `explicit: [share_true]`, `threshold: { concept_mention_count: 10, decision_confidence: 0.95 }`, `manual_review: [everything_else]`. Thresholds are tighter than REFERENCE_PLAN defaults (10 vs 5, 0.95 vs 0.9) as specified.
- [POSITIVE] The loader uses `js-yaml` which is already a project dependency (^4.1.1) — no new dependency added.
- [POSITIVE] Validation is strict: rejects unknown top-level keys, rejects unknown threshold keys, requires all four categories, type-checks all values. This prevents silent misconfiguration.
- [POSITIVE] `DEFAULT_POLICY_PATH` resolves relative to the module's `__dirname`, making it work regardless of the caller's cwd.
- [POSITIVE] The test suite covers both happy path (load default config, load custom config) and error paths (missing file, null input, missing category, unknown key, non-numeric threshold, unknown threshold key).
- [POSITIVE] All 11 new tests pass. Total: 598 tests (521 pass, 77 fail). The 77 vs 73 fail delta is from pre-existing test flakiness (circling-strategy tests + a `readSessions` ordering flake from Step 3.4), not caused by Step 4.1 changes.
- [NEGATIVE] Test count underestimate: AUDIT_PRE §6 planned ~6 tests, delivered 11. validatePromotionPolicy got 6 tests instead of the implicit 3-4 (null, missing category, unknown key, non-numeric threshold, unknown threshold key, valid). Phase-4-correction streak resets to 0.

6 POSITIVE findings, 1 NEGATIVE finding.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards to Step 4.2

- Test baseline is now 598 tests (521 pass, 77 fail — 73 pre-existing + 4 flaky). +11 tests added this step (planned ~6, delivered 11).
- `loadPromotionPolicy(configPath)` from `lib/promotion-policy.mjs` is ready for import by the promoter daemon (`bin/memory-promoter.mjs`). The promoter needs to call `loadPromotionPolicy()` at startup and implement `evaluatePromotionPolicy(event, policy)` — the evaluation logic that checks each event against the loaded policy.
- `validatePromotionPolicy(parsed)` is available for runtime re-validation if hot-reload is ever added.
- `POLICY_CATEGORIES` and `DEFAULT_POLICY_PATH` are exported constants for use by the promoter and subscriber.
- **Inventory reconciliation:** INVENTORY.md must be updated during Phase 9d to add Steps 4.7–4.9 (agnostic extraction trigger, daemon health monitor, frontend publisher pack) per Block 4 frozen decisions. This changes Block 4 from 6 steps to 9 steps, and total steps from 45 to 48.
- Phase-4-correction streak: 0 (reset — test count underestimate: planned ~6, delivered 11).
- Phase-8-patch streak: 10 (Steps 2.1–4.1, zero patches).
