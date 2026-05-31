# AUDIT_PRE — Step 4.5: 30-min-while-active synthesis trigger

**Date:** 2026-05-31 · **Version:** v4.4 → v4.5

## §0 Re-orient

- Where am I: Block 4 (L4 synthesis/wiki), step 5/9, 24/36 overall.
- Last step changed: 4.4 wired session-end synthesis at both IDLE→ENDED and ACTIVE→ENDED handlers.
- This step contributes: the second D2 trigger — periodic synthesis during long active sessions so wiki content stays fresh without waiting for session end.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy wiki — synthesis is the heart) + D2 (dual triggers).
- Still the right next step? Yes — session-end trigger (4.4) is done; the interval trigger completes the trigger pair.

## 1. Intent

Wire a 30-min interval synthesis trigger that fires during long active sessions. Currently, synthesis only fires on state transitions (ACTIVE→IDLE pre-compression flush, ACTIVE→ENDED, IDLE→ENDED). A session that stays ACTIVE for hours without going idle never gets synthesized mid-session. This step adds a throttled synthesis call in the Phase 2 throttled work loop, gated on ACTIVE state.

## 2. Design

- Add `synthesisMs: 1800000` (30 min) to config `intervals` defaults.
- Add `lastSynthesis: 0` to throttle state defaults.
- Pass `sessionState` to `runPhase2ThrottledWork` so it can gate synthesis on ACTIVE.
- In `runPhase2ThrottledWork`, add a new section in stage 1 that fires when `sessionState === STATES.ACTIVE` and `now - throttle.lastSynthesis >= config.intervals.synthesisMs`:
  - Calls `runFlush` (same pattern as ACTIVE→IDLE handler)
  - Emits `memory.extracted` if extraction produced results
  - Emits `memory.synthesized` with trigger `'interval'`
  - Reloads memory budget if new facts were added
  - Updates `throttle.lastSynthesis = now`
- Reset `throttle.lastSynthesis` on session transitions to ACTIVE (completeBoot) to avoid immediate synthesis on session start.

Carry-forwards consumed from 4.4:
- Natural end-to-end verification of session-end synthesis — not applicable to this step (but confirms the synthesis pipeline works).
- Frontmatter format — cosmetic, deferred.

## 3. Risk register

| Risk | Mitigation |
|---|---|
| Synthesis overlaps with ACTIVE→IDLE flush | The throttle timestamp is shared; if ACTIVE→IDLE fires first, the 30-min timer resets (we set `lastSynthesis` after the ACTIVE→IDLE flush too). Actually — the ACTIVE→IDLE handler is separate from throttled work. To avoid double synthesis within seconds: the ACTIVE→IDLE handler should also update `throttle.lastSynthesis`. However, this is minor — double synthesis is benign (same session, same data). Keep simple: just gate Phase 2 on the throttle timer. |
| LLM extraction takes too long and blocks the tick | runFlush is already async and used at other boundaries; the LLM model is qwen3:8b (fast). Same risk as ACTIVE→IDLE flush; acceptable. |

## 4. File-delta outline

| File | Change |
|---|---|
| `workspace-bin/memory-daemon.mjs` | Add `synthesisMs` to config defaults, `lastSynthesis` to throttle defaults, pass `sm.state` to `runPhase2ThrottledWork`, add 30-min synthesis block in stage 1 |
