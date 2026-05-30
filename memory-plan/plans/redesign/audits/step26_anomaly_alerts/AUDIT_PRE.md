# AUDIT_PRE — Step 2.6: Anomaly alerts: extraction validation-failure rate, empty-output ops, stalled jobs

## §0 Re-orient

- Where am I: Block 2 (L2 memory-watcher), step 6/6, 15/40 overall.
- Last step changed: 2.5 added the `/watcher` mission-control panel with live op stream + silent-failures view.
- This step contributes: completes the watcher by adding active anomaly detection — the system now actively alerts on degradation, not just passively displaying events.
- Block serves the north star via: DESIGN_INPUTS §2 "avoid silent failure" + MASTER_PLAN §5 runtime-observable verification. The watcher is the lens for all subsequent blocks.
- Still the right next step? Yes — this closes Block 2. The watcher passively shows events; anomaly alerts make it actively surface problems.

## 1. Intent

Add anomaly detection to the memory-watcher that evaluates incoming events against three rule types and writes alert records to `watcher.jsonl` when thresholds are crossed:

1. **extraction_failure** — immediate alert when a `memory.error` event arrives at an extraction boundary. This is a hard failure (Zod rejection).
2. **extraction_noop_rate** — if ≥50% of the last 10 `memory.extracted` events are `noop`, fire a rate alert. Catches the silent-failure pattern where extractions run but produce nothing.
3. **stalled** — on health probe, if no `memory.*` event in the last 30 minutes, fire a stalled alert.

Alert records written to `watcher.jsonl` with `op: 'watcher.alert'`. Cooldown per alert type (10 min) prevents spam. Surface in the mission-control panel as an "Alerts" tab.

## 2. Design decisions

- **Consume prior carry-forwards (step 2.5 §6):** "alert logic on top of the existing view" — yes, doing exactly that. "third tab or inline annotations" — choosing a third tab (clearest separation). "JSONL rotation" — still out of scope (already in OUT_OF_SCOPE).
- **Sliding window in memory, not re-reading JSONL** — the watcher's `processingLoop` already sees every event; keep a bounded circular buffer of recent events for rate calculations. No disk I/O for anomaly checks.
- **Alert record shape:** `{ts, op: 'watcher.alert', status: 'error', alert_type, detail, window?}` — treated as events by the existing API (since `op !== 'health.probe'`), filterable via `?op=watcher.alert`.
- **Cooldown:** per alert_type timestamp map. Same alert_type won't re-fire within 10 min.
- **No new dependencies.** Pure logic addition to the existing watcher.

## 3. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Alert spam if threshold too aggressive | LOW | 10-min cooldown per type; thresholds chosen conservatively |
| Sliding window memory growth | NEGLIGIBLE | Fixed-size buffer (20 events max) |
| Runtime verification of alert-fires | LOW | Can publish synthetic `memory.error` via `nats pub` and observe alert in watcher.jsonl + API |

## 4. File-delta outline

| File | Action | Delta |
|---|---|---|
| `lib/memory-watcher.mjs` | EDIT | Add `evaluateAnomalies()`, alert-record writer, sliding window buffer, cooldown map. Wire into `processingLoop` (on each event) + health probe (for stalled check). |
| `mission-control/src/app/api/watcher/route.ts` | EDIT | Add `alerts` key in response (filter `op === 'watcher.alert'` from records). |
| `mission-control/src/app/watcher/page.tsx` | EDIT | Add "Alerts" tab with alert-specific rendering (type badge, detail, timestamp). |
