# AUDIT_POST — step 1.1 · Canonical protocol docs

## §1 Promised vs landed

| Promised (AUDIT_PRE §6) | Actual | Landed |
|---|---|---|
| `canonical/PROTOCOL.md` new | written, 9 sections (anatomy → scaffolding) | yes |
| `canonical/FRAMEWORK_CANONICAL.md` hoisted verbatim | `cp` from legacy; `cmp` clean | yes |
| `canonical/BLOCK_TEMPLATE.md` generalized | paths now `memory-plan/plans/<id>/...` | yes |
| sync into every silo | 4 silos (legacy, redesign, protocol, **repair**) — one more than planned, see §4 | yes |

## §2 Greppable deltas

- `grep -c "Silo anatomy" memory-plan/plans/*/PROTOCOL.md` → 1 in each of 4 silos.
- `workspace-bin/sync-canonical.sh --check` → "all plan copies up to date", rc=0.
- `cmp memory-plan/canonical/PROTOCOL.md memory-plan/plans/<p>/PROTOCOL.md` clean for all 4.

## §3 Cross-refs

PROTOCOL.md references only files that exist (`sync-canonical.sh`, `scope-check.sh`,
`workplan-viewer.mjs`) plus two it promises (`plan-tick.sh`, `new-plan.sh` — steps 1.2/1.3,
declared as such). No stale refs introduced; legacy/redesign FRAMEWORK/WORKFLOW untouched.

## §4 Findings

- [NEGATIVE] A fourth silo `plans/repair/` exists (v2.11, idle, BLOCKED.md present) that the
  pre-step exploration missed — discovered when sync enumerated it. No harm (sync is generic and
  the new docs apply to it correctly), but step planning relied on a stale silo inventory.
  Lesson: enumerate `plans/*/` directly, not from memory or prior reports.
- [POSITIVE] sync-canonical.sh needed zero changes: its `[[ -f ]]` guard already skips the
  future `templates/` subdir, and it auto-covered the unknown 4th plan.

## §6 Carry-forwards to 1.2

- The engine must work against silos in any state: complete (redesign), blocked (repair),
  archived (legacy). `--preflight` against redesign is the evidence path; a BLOCKED silo must
  short-circuit.
- Viewer/launchd invoke `tick_command` with no argv (workplan-viewer.mjs spawn `[]`) — the
  per-plan shim convention `<id>-tick.sh → exec plan-tick.sh <id>` is required, not optional.
