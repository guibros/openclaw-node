# AUDIT_POST — Step 2.6: Anomaly alerts: extraction validation-failure rate, empty-output ops, stalled jobs

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| EDIT `lib/memory-watcher.mjs` — add anomaly detection, alert writer, sliding window, cooldown | Done — added `createAnomalyDetector()` (exported, testable), 3 alert types, wired into `createMemoryWatcher` processing loop + self-contained stale timer. | ✓ |
| EDIT `mission-control/src/app/api/watcher/route.ts` — add `alerts` key in response | Done — `watcher.alert` records separated from events in the parse loop; returned as `alerts` array. | ✓ |
| EDIT `mission-control/src/app/watcher/page.tsx` — add "Alerts" tab | Done — third tab "Alerts" with `Bell` icon, red badge count, `AlertRow` component showing alert_type + detail. | ✓ |

Additional files touched (within scope):
- `mission-control/src/lib/hooks.ts` — added `WatcherAlert` interface + `alerts` to `useWatcher` return.
- `test/memory-watcher.test.mjs` — 8 new tests for `createAnomalyDetector`.

No unplanned files touched.

## 2. Greppable deltas

```
lib/memory-watcher.mjs:114-199 — new block
  :114-118 — constants: DEFAULT_COOLDOWN_MS (10min), WINDOW_SIZE (20), EXTRACTION_RATE_THRESHOLD (0.5), RATE_MIN_SAMPLE (3), STALE_THRESHOLD_MS (30min)
  :120     — createAnomalyDetector(opts) factory (exported)
  :130-134 — canFire/fired cooldown helpers
  :140-148 — buildAlert helper (op: 'watcher.alert', status: 'error')
  :151-181 — evaluate(record): extraction_failure on memory.error, extraction_noop_rate on window threshold
  :183-197 — evaluateStale(): stalled alert on old events
  :202-268 — createMemoryWatcher updated: anomalyDetector instance, writeRecord helper, stale timer, evaluate on each event, log on alert

mission-control/src/app/api/watcher/route.ts:71-81 — alerts separated from events
  :72      — alerts: WatcherRecord[] array added
  :76      — watcher.alert records routed to alerts array
  :87      — alerts.reverse() + slice in response

mission-control/src/app/watcher/page.tsx
  :4       — Bell icon imported
  :5       — WatcherAlert imported
  :54-60   — alertTypeLabel helper
  :134-148 — AlertRow component
  :151     — view state extended: "stream" | "failures" | "alerts"
  :154     — alerts destructured from useWatcher
  :180-195 — Alerts tab button with red badge
  :204-210 — stats label changes per view

mission-control/src/lib/hooks.ts:869-881 — WatcherAlert interface + alerts in useWatcher return
  :869     — WatcherAlert interface (alert_type, detail, window?, last_event_ts?, age_ms?)
  :889     — alerts added to SWR response type
  :898     — alerts: data?.alerts ?? [] in return

test/memory-watcher.test.mjs:354-413 — 8 new tests
  :354     — extraction_failure alert on memory.error
  :363     — cooldown respected
  :370     — extraction_noop_rate fires on threshold
  :381     — noop_rate does not fire below threshold
  :388     — stalled fires on old events
  :396     — stalled does not fire on recent events
  :402     — stalled does not fire with no events
  :407     — window bounds at windowSize
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Tests green | `npm test`: 1414 pass / 0 fail (8 new anomaly detector tests). |
| Daemon restart | PID 79988 after `launchctl kickstart -k`; log: `[watcher] Memory watcher initialized`. |
| Alert fires on induced Zod failure | `nats pub local.memory.error '{"event_type":"memory.error","data":{"boundary":"extract","error_code":"ZodError","error_message":"Zod validation failed","session_id":"zod-fail-session-26"},...}'` → daemon log: `[watcher] ALERT: extraction_failure — memory.error at zod-fail-session-26`. |
| Alert in watcher.jsonl | `{"ts":"2026-05-30T02:36:24.857Z","op":"watcher.alert","status":"error","alert_type":"extraction_failure","detail":"memory.error at zod-fail-session-26","session":"zod-fail-session-26"}`. |
| API returns alerts | `curl /api/watcher` → `alerts` array contains the fired alert record. |
| Panel loads | `curl -o /dev/null -w '%{http_code}' /watcher` → 200. |
| INVENTORY done-evidence | "induce a Zod validation failure; an alert fires (panel + log)" — ✓ both log line + JSONL alert record + API `alerts` array populated. |

## 4. Cross-refs

- Alert records written by `createAnomalyDetector` (this step) consume the `toWatcherRecord` classification from step 2.2.
- Stale timer in the watcher is self-contained (no daemon changes needed; lib/ is symlinked).
- API route separates alerts from events so existing SWR hooks for events/failures are unaffected.
- Mission-control deployed via file copy (same model as steps 2.4/2.5).

## 5. Findings

- The stale check's internal timer runs on a 5-min interval inside the watcher. This is independent of the daemon's health probe timer (also 5-min). Acceptable — they check different things (stale events vs DB health).
- JSONL rotation/truncation remains unaddressed (carried from step 2.5; already in OUT_OF_SCOPE from registry entry 1.8).

## 6. Carry-forwards for Block 3

- Block 2 (memory-watcher) is now complete. The watcher covers: event subscription + persistence (2.1), classification (2.2), store health probes (2.3), API endpoint (2.4), panel UI (2.5), anomaly alerts (2.6).
- Block 3 (ingest + extraction correctness) will use the watcher to verify fixes. Step 3.4 (tolerant extraction coercion) will reduce the extraction_failure alert rate — the alert validates the fix.
- JSONL rotation should be addressed before event volume grows significantly (Block 6 health/hygiene territory).
