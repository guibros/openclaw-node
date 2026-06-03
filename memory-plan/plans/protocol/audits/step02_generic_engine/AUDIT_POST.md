# AUDIT_POST — step 1.2 · Generic chain engine plan-tick.sh

## §1 Promised vs landed

| Promised (AUDIT_PRE §6) | Actual | Landed |
|---|---|---|
| `workspace-bin/plan-tick.sh` new executable | written, chmod +x; all state derived from `$1` | yes |
| protocol VERSION/INVENTORY bookkeeping | v1.2-pre → v1.2-mid → v1.2; row flips | yes |

## §2 Greppable deltas

- `grep -c 'PLAN_ID' workspace-bin/plan-tick.sh` → 10 (full parameterization).
- Preflight run 2026-06-03T02:42:20-0500 against 4 targets (see §4 evidence).

## §3 Cross-refs

redesign-tick.sh / memory-plan-tick.sh untouched; redesign/legacy automation.json still point at
their historical scripts. PROTOCOL §7 already describes this engine + shim convention (written
in 1.1, now true on disk except the shim generator, which is 1.3).

## §4 Findings

- [POSITIVE] One engine handled all four silo states live: redesign (open deferred row 7.1
  reported), repair (BLOCKED.md PRESENT → would exit), protocol (in-flight v1.2-mid, dirty tree
  tolerated), nonexistent id (FATAL rc=1).
- [NEGATIVE] The INVENTORY done-evidence line for 1.2 predicted redesign would report "complete,
  no next step"; reality is "next step 7.1 (DEFERRED)" because Block 7 rows are still `[ ]`.
  The engine is right; the prediction was wrong. Evidence wording corrected at close — deferral
  is a TICK_PROMPT-layer rule (redesign's prompt BLOCKs on Block 7), not a wrapper rule.
- [POSITIVE] repair's inventory parses with the same `next_step()` grep (desc column shows "—",
  a cosmetic difference in that plan's table style).

## §6 Carry-forwards to 1.3

- The scaffolded shim must be `exec "$(dirname)/plan-tick.sh" <id> "$@"` so `--preflight`
  passes through for operators while launchd/viewer argv-less calls still work.
- Template INVENTORY must lock the table format `| B | X.Y | vX.Y | [ ] | desc |` that
  `next_step()` greps — put the format rule next to the table header in the template.
