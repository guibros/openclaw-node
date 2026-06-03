# AUDIT_PRE — step 1.2 · Generic chain engine plan-tick.sh

## §0 Re-orient

- Where am I: Block 1 (protocol base), step 2/3, 2/3 overall.
- Last step changed: PROTOCOL.md + two doc hoists, synced to all 4 silos (incl. surprise `repair/`).
- This step contributes: the executable half of the base — one engine any silo can be driven by, ending per-plan tick-script copies (the drift source COWORK_MODEL §5 flags).
- Serves the north star via: COWORK_MODEL §3 (the chain engine) + MASTER_PLAN §4.6 (no parallel implementations — one engine, not N copies).
- Still the right next step? Yes — engine before scaffolder; the scaffolder's shim points at this.

## §1 Intent

`workspace-bin/plan-tick.sh <plan-id> [--preflight]`: redesign-tick.sh's engine parameterized by
plan id. Repo root from script location; plan dir, prompt, inventory, version, lock, tick-logs,
digest all derived from the id. Guards unchanged (BLOCKED short-circuit, dirty-tree stall block,
per-plan lock, autopause). redesign-tick.sh / memory-plan-tick.sh remain untouched (historical,
still referenced by redesign/legacy automation.json).

## §4 Risks

- Carry-forward from 1.1: viewer spawns tick_command with no argv → the engine alone is not
  viewer-wireable; the `<id>-tick.sh` shim (generated in 1.3) is the wiring. Documented in
  PROTOCOL §7 already.
- Per-plan INVENTORY table format must match `next_step()` grep — PROTOCOL §1.2 + the 1.3
  template lock the format.

## §6 File deltas

- `workspace-bin/plan-tick.sh` — new executable.
- `memory-plan/plans/protocol/{VERSION,INVENTORY.md}` — carrier/status bookkeeping.
