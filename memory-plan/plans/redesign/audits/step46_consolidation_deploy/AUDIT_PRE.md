# AUDIT_PRE — Step 4.6: Deploy consolidation module; verify one manual cycle

**Started:** 2026-05-31 · **Version:** v4.5 → v4.6

## §0 Re-orient

- Where am I: Block 4 (Synthesis/wiki), step 6/9, 24/36 overall.
- Last step changed: 4.5 wired 30-min-while-active interval synthesis trigger into the daemon.
- This step contributes: makes the consolidation cycle (decay/reinforce/cluster/summarize/promote) actually runnable and observable via events.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy wiki — consolidation IS the "sleep" that refines raw into synthesis) + MASTER_PLAN §5 (done = runtime-observable).
- Still the right next step? Yes — triggers are wired (4.4/4.5), now the offline consolidation work needs to actually execute.

## 1. Intent

Deploy `bin/consolidate.mjs` to the runtime tree, wire `memory.decayed` + `memory.promoted` event emission into the consolidation cycle, and run one manual cycle against the production `state.db` to verify entities get archived/decayed and events appear in the local event stream.

## 2. Design

- `bin/consolidate.mjs` gains NATS connectivity: connect to local NATS, create event log, pass `eventLog`/`nodeId` to `runConsolidationCycle`.
- `runConsolidationCycle` gains optional `eventLog`/`nodeId` params. After `decayWeights`, emits `memory.decayed`; after `evaluatePromotionCandidates`, emits `memory.promoted`.
- Deploy: symlink `~/.openclaw/workspace/bin/consolidate.mjs` → `repo/bin/consolidate.mjs` (follows step 0.2 pattern).
- No scheduler (that's 4.7). This is a one-shot manual run.

## 3. Risk register

| Risk | Mitigation |
|------|-----------|
| state.db locked by running daemon during consolidation | WAL mode allows concurrent readers; consolidation runs in its own connection with `busy_timeout` |
| Decay archives many entities unexpectedly | The decay function is well-tested (F-C16, F-P212 fixes); entities are archived, not deleted permanently |
| NATS unavailable | Consolidation still runs to completion; events just don't emit (fire-and-forget pattern) |

## 4. File-delta outline

| File | Change |
|------|--------|
| `bin/consolidate.mjs` | Add NATS connect + event emission in CLI entry; add `eventLog`/`nodeId` to `runConsolidationCycle` opts |
| (symlink) | `~/.openclaw/workspace/bin/consolidate.mjs` → repo |
