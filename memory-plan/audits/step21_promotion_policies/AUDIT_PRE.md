# AUDIT_PRE — Step 4.1: Define promotion policies (config/promotion-policy.yaml)

**Version:** v4.1-pre
**Date:** 2026-05-22
**Author:** memory-plan-tick

---

## §1 — Intent

Create the promotion policy configuration file and a loader module that reads, parses, and validates it. The promotion policy governs which local events are eligible for sharing to the shared JetStream cluster. This is the first step of Block 4 (federation primitives) and establishes the policy framework that Steps 4.2 (promoter) and 4.3 (subscriber) will consume.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [A] | Define promotion policies (config/promotion-policy.yaml) |

## §3 — Design decisions

Consumed from AUDIT_POST §6 (Step 3.4) and RESUME.md §0 (Block 4 frozen decisions):

- **Test baseline:** 587 tests (514 pass, 73 fail pre-existing). +9 tests added in Step 3.4.
- **Promotion policy thresholds (frozen, tighter than REFERENCE_PLAN):**
  - `automatic`: kanban events
  - `explicit`: any concept/lesson with frontmatter `share: true`
  - `threshold`: `concept_mention_count >= 10` (raised from REFERENCE_PLAN's 5)
  - `threshold`: `decision_confidence >= 0.95` (raised from 0.9)
  - `manual_review`: everything else — queued, never auto-shared
- **Default privacy — DEFAULT-PRIVATE.** Nothing auto-shares unless explicitly marked or meets strict threshold.
- **YAML format:** `config/promotion-policy.yaml`. `js-yaml` is already a project dependency (^4.1.1) and available in `node_modules`.
- **Loader scope:** `loadPromotionPolicy(configPath)` loads and validates the YAML config, returning a structured policy object. Policy evaluation logic (`evaluatePromotionPolicy`) deferred to Step 4.2 (promoter), which is the consumer.
- **Inventory discrepancy:** Block 4 frozen decisions define 9 steps (4.1–4.9) but INVENTORY.md only lists 6 (4.1–4.6). Steps 4.7 (agnostic extraction trigger), 4.8 (daemon health monitor), and 4.9 (frontend publisher pack) must be added to INVENTORY during Phase 9d to reconcile with operator-authored frozen decisions.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| YAML schema validation could be over/under-specified | LOW | Keep validation tight to frozen decisions; loader rejects unknown keys |
| `config/` directory conventions might conflict | LOW | Other files in `config/` are JSON templates; YAML is the operator's explicit choice for this file |

No HIGH-severity risks.

## §5 — Deferrals

- `evaluatePromotionPolicy(event, policy)` — deferred to Step 4.2 (promoter implementation).
- Runtime policy reloading (hot-reload on file change) — out of Block 4 scope unless explicitly needed.

## §6 — Phase 4 implementation outline

| # | Delta | File | Type |
|---|-------|------|------|
| 1 | Create promotion policy YAML config with frozen-decision thresholds | `config/promotion-policy.yaml` | new |
| 2 | Create policy loader module: loadPromotionPolicy, validatePromotionPolicy, DEFAULT_POLICY_PATH, POLICY_CATEGORIES | `lib/promotion-policy.mjs` | new |
| 3 | Tests: load valid config, reject missing file, reject invalid structure, validate threshold types, validate category structure, default path constant | `test/promotion-policy.test.mjs` | new |
