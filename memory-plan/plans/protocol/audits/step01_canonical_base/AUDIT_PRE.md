# AUDIT_PRE — step 1.1 · Canonical protocol docs

## §0 Re-orient

- Where am I: Block 1 (protocol base), step 1/3, 1/3 overall.
- Last step changed: n/a — first step of a new plan; silo identity files just created.
- This step contributes: the synced rulebook (PROTOCOL.md) every present and future silo carries — the base the other two steps plug into.
- Serves the north star via: MASTER_PLAN §4.10 (the framework gets an explicit slot before framework-shaped work) and §6 (the forcing function becomes self-describing per silo).
- Still the right next step? Yes — docs before engine before scaffolder; each later step cites the contract this one writes.

## §1 Intent

Author `canonical/PROTOCOL.md`: the plan-agnostic, silo-resolved operating contract (silo anatomy, 9-phase lifecycle, version carriers, Re-Orient loop, viewer tab↔file contract, tick-chain contract, scope hook, new-plan procedure). Hoist `FRAMEWORK_CANONICAL.md` from `plans/legacy/` unchanged into `canonical/`. Generalize `BLOCK_TEMPLATE.md` (stale pre-silo `memory-plan/BLOCKED.md` paths → `<plan>/BLOCKED.md`) into `canonical/`. Sync all into every silo.

## §4 Risks

- Sync overwrites `legacy/` + `redesign/` copies of BLOCK_TEMPLATE.md → intended (canonical-doc semantics); their FRAMEWORK/WORKFLOW stay untouched as historical record.
- PROTOCOL.md contradicting redesign's WORKFLOW.md → mitigated by an explicit precedence section (historical plans keep their docs; PROTOCOL governs new plans).

## §6 File deltas

- `memory-plan/canonical/PROTOCOL.md` — new, the operating base.
- `memory-plan/canonical/FRAMEWORK_CANONICAL.md` — copied verbatim from `plans/legacy/`.
- `memory-plan/canonical/BLOCK_TEMPLATE.md` — new generalized version.
- `memory-plan/plans/{legacy,redesign,protocol}/` — gain/refresh the three docs via sync-canonical.sh.
