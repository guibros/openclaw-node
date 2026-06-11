# COMPONENT_REGISTRY — protocol plan

Current state of every component this plan touches. Reality, not aspiration — every status is a
probe run on the stated date. Claims older than 14 days decay (MASTER_PLAN §4.9): re-probe
before acting. Format note: the viewer's Master Plan tab parses `## Family N:` sections with
`###` components and `| **Status** |` rows — keep this shape (PROTOCOL §10).

## Family 1: protocol base (docs + sync)

### Canonical doc sync — sync-canonical.sh

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-06-03 — `--check` → "all plan copies up to date", rc 0 (5 docs × 4 silos) |

### Operating base docs — PROTOCOL / FRAMEWORK_CANONICAL / BLOCK_TEMPLATE

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-06-03 — `grep -l '## 10. Surface conformance' plans/*/PROTOCOL.md` → 4 silos |

### Templates — canonical/templates/ (8 files)

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-06-03 — rendered demo carried the §11 contract; no unrendered `{{` placeholders |

## Family 2: execution machinery

### Generic chain engine — plan-tick.sh

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-06-03 — `--preflight` correct against all 4 silo states; logs the conformance line |

### Scaffolder — new-plan.sh

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-06-03 — demo silo viewer-listed; lint report printed; fresh scaffold = CONFORMANT / 1 WARN |

### Conformance lint — plan-lint.sh

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-06-03 — graded 4 silos truthfully (legacy CONFORMANT 13P/3W/0F; others' gaps named); rc matched verdicts |

### protocol tick chain — protocol-tick.sh + automation.json

| | |
|---|---|
| **Status** | BUILT — plist not loaded |
| **Verified** | 2026-06-03 — shim exec's `plan-tick.sh protocol`; enabling the chain is an explicit operator decision (PROTOCOL §7) |

## Family 3: control surface

### Workplan viewer — workplan-viewer.mjs :7892

| | |
|---|---|
| **Status** | LIVE |
| **Verified** | 2026-06-03 — `curl /api/plans` → 200 listing exactly the 4 silos; per-plan surface endpoints `present:true` |
