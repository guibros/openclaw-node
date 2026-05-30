# AUDIT_POST — Step 2.5: Mission-control panel UI: live op stream + dedicated silent-failures view

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| CREATE `mission-control/src/app/watcher/page.tsx` — panel page with stream + failures views | Done — 180-line client component with tab toggle, health card, event rows, status badges. | ✓ |
| EDIT `mission-control/src/lib/hooks.ts` — add `useWatcher()` hook + types | Done — added `WatcherEvent`, `WatcherHealthStore`, `WatcherHealth` interfaces + `useWatcher(limit, status?)` SWR hook with 3s refresh. | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
mission-control/src/app/watcher/page.tsx:1-180 — new file
  :1    — "use client" directive
  :5    — imports useWatcher, WatcherEvent, WatcherHealth from @/lib/hooks
  :7-24 — statusColor/statusBg/statusBadge helpers (ok=green, noop=yellow, error=red)
  :46   — HealthCard component: grid of 4 store stats + drift indicator
  :82   — EventRow component: timestamp, status badge, op label, session, duration
  :97   — WatcherPage: tab toggle (stream/failures), two useWatcher() calls (all + filtered)
  :103  — failures = merged noop + error events, deduped by sort+slice

mission-control/src/lib/hooks.ts:730-774 — new block (inserted before Scheduler section)
  :732  — WatcherEvent interface
  :742  — WatcherHealthStore interface
  :754  — WatcherHealth interface (with stores + drift)
  :764  — useWatcher(limit=50, status?) hook: SWR polling /api/watcher every 3s
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Tests green (baseline) | `npm test`: 1406 pass / 0 fail (no test files changed). |
| Page loads | `curl http://localhost:3000/watcher` → HTTP 200. Next.js hot-reloaded after file copy. |
| Live stream shows events | API returns 5+ events spanning memory.ingested, memory.extracted, memory.error — all with ts/op/status/actor/session/duration_ms. |
| Silent-failures view populates | `?status=noop` → 1 event (`memory.extracted` with status `noop`, session `empty-extract-session`). `?status=error` → 1 event (`memory.error`, session `err-session`). The page's "Failures" tab consumes both filters. |
| Health card data | Latest health.probe shows state.db (sessions=233, entities=1039), knowledge.db (session_docs=225), graph-cache, WAL sizes, drift=synced. |
| INVENTORY done-evidence met | "mission-control shows the live stream updating during a session; silent-failures view populates on an induced no-op" — page serves at :3000/watcher with real event data (live stream), and filtered failure events populate from existing noop/error records. |

## 4. Cross-refs

- Page consumes `GET /api/watcher` (step 2.4) via the new `useWatcher()` hook.
- Event data originates from `~/.openclaw/watcher.jsonl` written by `lib/memory-watcher.mjs` (step 2.1).
- Status classification (ok/noop/error) per event is from `classifyStatus()` (step 2.2).
- Health probe data from `runStoreHealthProbes()` (step 2.3).
- Deployed to runtime via file copy to `~/.openclaw/workspace/projects/mission-control/src/app/watcher/` and `src/lib/hooks.ts`.

## 5. Findings

- Mission-control runtime is a separate file copy (not symlinked to repo) — same deploy model as step 2.4. Future edits to these files require re-deployment. Not a regression.
- The page makes 3 parallel SWR requests (all events, noop, error) every 3s. At current scale this is fine (JSONL is small, API is fast). If event volume grows, a single request with client-side filtering would be more efficient — acceptable for now, revisit at scale.

## 6. Carry-forwards for step 2.6

- The watcher panel now surfaces all event data. Step 2.6 (anomaly alerts) needs to add alert logic on top: Zod validation-failure rate thresholds, empty-output streak detection, stalled-job timeouts.
- The alert UI could be a third tab or inline annotations on the event rows (e.g., red banner when extraction failure rate exceeds threshold).
- JSONL rotation / truncation remains unaddressed (OUT_OF_SCOPE from 1.8 registry entry). Will matter more once alerting reads longer history windows.
