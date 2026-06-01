# AUDIT_POST — Step 4.7: Install consolidation scheduler (plist) on the cadence

**Closed:** 2026-06-01 (implemented by autonomous tick; reviewed + runtime-verified + closed by operator) · **Version:** v4.7

## Provenance

Tick implemented + unit-tested, then **blocked at Phase 5b** (correctly): installing/loading a launchd plist and observing a cadence fire are outside its sandbox. Operator **reviewed the scheduler's safety design** before installing (this step schedules consolidation to run unattended), then ran the External-action commands.

## Operator design review (why this was safe to install unattended)

`bin/consolidation-scheduler.mjs` read in full. Guards confirmed:
- **Idle-gated** — `isSystemIdle` skips the cycle when Ollama has active inference (HTTP `/api/ps`) or the in-process queue is busy; logs a skip reason instead of running. Won't fight live work.
- **5-min hard cap** with a real `AbortController` (`runScheduledCycle`) — F-H19 fix passes `ac.signal` into the cycle so the work actually cancels; prevents overlapping cycles stacking on the DB.
- **Concurrency guard** with `maxAgeMs = hardCap + 60s` (F-Q306) — a wedged cycle can't permanently lock out future runs.
- **Single-shot per launchd fire** (check idle → run → exit), not a long-lived daemon.
- **Soft archival only** — consolidation moves entities below salience 0.05 to `entities_archived`, never hard-deletes. 30-min cadence (`StartInterval 1800`) is reasonable.

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE) | Actual | Match |
|---|---|---|
| `consolidation-scheduler.mjs` threads `eventLog`/`nodeId` into the cycle | added to `runScheduledCycle` + `createConsolidationScheduler` cycle call | ✓ |
| CLI connects to NATS (+`--no-events`), flush/close on exit | mirrors 4.6: `OPENCLAW_NATS` default, warn-and-continue if down, `cleanup()` on all exits | ✓ |
| Repo plist template (`services/launchd/…plist`) | `${NODE_BIN}`/`${OPENCLAW_WORKSPACE}`/`${HOME}` placeholders; resolved at install | ✓ |
| Symlink deploy | `~/.openclaw/workspace/bin/consolidation-scheduler.mjs` → repo (readlink confirms) | ✓ |

## 2. Done-evidence (runtime-observable)

INVENTORY criterion 4.7: *scheduler installed (`launchctl list`); a cycle fires on cadence unattended.*

**MET.** Resolved plist installed to `~/Library/LaunchAgents/ai.openclaw.consolidation-scheduler.plist` (`plutil -lint` OK), loaded via `launchctl bootstrap`.

- **Loaded:** `launchctl list | grep consolidation` → `- 0 ai.openclaw.consolidation-scheduler` (exit 0 = ran and exited clean).
- **Cadence fire** (via `launchctl kickstart`, simulating a scheduled tick): scheduler log —
  ```
  NATS connected (nats://127.0.0.1:4222), events will be emitted.
  [consolidation-scheduler] system idle — starting consolidation cycle
  [consolidation-scheduler] cycle complete (32ms)
    Decayed: 1064 entities, Reinforced: 102, Promotion: 33 entities, 105 decisions
  ```
- **Idle gate exercised** — it checked idle, passed, ran (not skipped).
- **Events from the scheduler path:** watcher decay/promote count 2 → 4; new records at the kickstart time —
  `{"op":"memory.decayed","status":"ok","actor":"daemon-daedalus"}` + `{"op":"memory.promoted","status":"ok","actor":"daemon-daedalus"}`.

The launchd service will now fire every 30 min, run only when idle, hard-cap at 5 min.

## 3. Carry-forwards

- Consolidation now runs unattended on cadence. Remaining Block 4: 4.8 (deterministic digest from vault) + 4.9 (retire the lossy hourly daily-log writer).
- If consolidation ever needs pausing: `launchctl bootout gui/$(id -u)/ai.openclaw.consolidation-scheduler`.
