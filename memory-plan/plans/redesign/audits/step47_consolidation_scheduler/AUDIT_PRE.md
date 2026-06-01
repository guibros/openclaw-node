# AUDIT_PRE — Step 4.7: Install consolidation scheduler (plist) on the cadence

**Version:** v4.6 → v4.7-pre

## §0 Re-orient

- Where am I: Block 4 (L4 synthesis/wiki), step 7/9, 25/36 overall.
- Last step changed: 4.6 deployed consolidation module; emits memory.decayed/promoted; one manual cycle verified.
- This step contributes: makes consolidation autonomous — a launchd plist fires the cycle every 30 min unattended, with idle-gating and event emission.
- Block serves the north star via: DESIGN_INPUTS §1 (Karpathy wiki) — consolidation is the decay/reinforce/cluster engine that keeps the wiki fresh.
- Still the right next step? Yes — 4.6 proved the module works manually; 4.7 makes it fire on cadence.

## 1. Intent

Install the consolidation scheduler as a launchd service that fires every 30 minutes, checks system idle state, and runs one consolidation cycle with NATS event emission. The scheduler binary and plist already exist as templates; this step resolves them to production paths, wires NATS event passthrough, symlink-deploys, and installs.

## 2. Design

### 2.1 Code change: wire NATS into the scheduler CLI

The scheduler's `runScheduledCycle` calls `runConsolidationCycle` but does NOT pass `eventLog` or `nodeId`. This means automated cycles don't emit `memory.decayed`/`memory.promoted` events — invisible to the watcher. Fix: propagate `eventLog`/`nodeId` through the chain.

- `runScheduledCycle(opts)`: accept + forward `opts.eventLog`, `opts.nodeId`
- `createConsolidationScheduler(opts)`: accept + forward same
- CLI entry: connect to NATS (same pattern as `consolidate.mjs` CLI), pass through

### 2.2 Plist template: add NATS env vars

Add `OPENCLAW_NATS` (`nats://127.0.0.1:4222`) and `OPENCLAW_NODE_ID` (`daedalus`) to the plist's EnvironmentVariables. These ensure the scheduler's NATS connection resolves correctly.

### 2.3 Runtime (operator-verified)

- Symlink `~/.openclaw/workspace/bin/consolidation-scheduler.mjs` → repo `bin/consolidation-scheduler.mjs`
- Install the resolved plist (real paths, not `${...}`) to `~/Library/LaunchAgents/ai.openclaw.consolidation-scheduler.plist`
- `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ai.openclaw.consolidation-scheduler.plist`
- Verify `launchctl list | grep consolidation`

## 3. Risk register

- **Low:** the relative import `./consolidate.mjs` in the scheduler resolves through the symlink to the repo's `bin/consolidate.mjs` — already verified (it's how consolidate.mjs is deployed today).
- **Low:** NATS connection in single-shot mode: the scheduler connects, runs, flushes, closes. Same pattern as `consolidate.mjs` CLI (proven in 4.6).
- **Medium:** launchd plist uses `StartInterval` (30 min) — the first cycle fires 30 min after install. For verification, the operator may need to temporarily shorten the interval or trigger manually via `launchctl kickstart`.

## 4. File-delta outline

| File | Change |
|---|---|
| `bin/consolidation-scheduler.mjs` | Wire NATS eventLog/nodeId through the opts chain; add NATS connect in CLI entry |
| `services/launchd/ai.openclaw.consolidation-scheduler.plist` | Add OPENCLAW_NATS + OPENCLAW_NODE_ID env vars |

## 5. Carry-forwards consumed

From 4.6 AUDIT_POST §3: "Repeatable verify recipe holds: backup state.db → deploy symlink → run with OPENCLAW_NATS/OPENCLAW_NODE_ID → confirm events in watcher → done."
