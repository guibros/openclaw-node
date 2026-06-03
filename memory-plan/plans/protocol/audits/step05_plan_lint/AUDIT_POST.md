# AUDIT_POST — step 2.2 · plan-lint.sh conformance checker

## §1 Promised vs landed

| Promised (AUDIT_PRE §6) | Actual | Landed |
|---|---|---|
| plan-lint.sh executable + `--summary` | written; 6 surfaces, 3 tiers, exit 0/1/2 | yes |
| protocol bookkeeping | v2.2-pre → -mid → v2.2; row flips | yes |

## §2 Greppable deltas

- `workspace-bin/plan-lint.sh <id> --summary` per silo (run 2026-06-03 ~03:0x):
  `protocol 9P/2W/4F → NONCONFORMANT` · `redesign 12P/3W/1F → NONCONFORMANT` ·
  `repair 7P/4W/4F → NONCONFORMANT` · `legacy 13P/3W/0F → CONFORMANT`; rc matched verdict each time.

## §4 Findings

- [POSITIVE] The corpus behaved exactly per the step's Verify contract: protocol FAILs on
  precisely the four gaps 2.4 fills (REGISTRY, automation.json, TICK_PROMPT, tick-logs);
  redesign's sole FAIL is its 4 open deferred Block-7 rows lacking contracts (true state).
- [POSITIVE] legacy grades CONFORMANT — the grandfathering tiers (closed rows WARN, audit
  coverage WARN, ROADMAP-name WARN) avoid false reds on a healthy archived silo without
  weakening the rule for open work.
- [NEGATIVE] redesign + repair WARN "DECISIONS.md has no D-entries" — their ledgers use a
  different heading shape than `## D<n>`. Tier is WARN so no harm; heading-shape variance is a
  candidate for a future normalization pass (not this plan's scope).

## §6 Carry-forwards to 2.3

- Wire points confirmed: `--summary` is one stable line — preflight can print it verbatim;
  scaffold end should print the FULL report (the new plan's to-do list is the FAIL/WARN lines).
- Lint never writes; safe to call from any context (engine, scaffolder, CI, operator).

## Feeds landing (Phase 9)

`workspace-bin/plan-lint.sh` exists for: 2.3 (new-plan.sh + plan-tick.sh call it), the operator
(conformance report per silo on demand), future CI. Repair's 29 open uncontracted rows are now
visible work for whoever resumes that plan (captured by the lint, no retrofit done here — not
this plan's scope).
