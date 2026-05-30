# AUDIT_PRE — Step 2.5: Mission-control panel UI: live op stream + dedicated silent-failures view

## §0 Re-orient

- Where am I: Block 2 (L2 watcher), step 5/6, 15/40 overall.
- Last step changed: 2.4 added `GET /api/watcher` to mission-control — serves event records + health as JSON.
- This step contributes: the readable surface for the watcher — a live panel the operator can glance at to see what the memory system is doing and where it's failing silently.
- Block serves the north star via: DESIGN_INPUTS §2 ("one hop, no bullshit") + D6 (the lens, built early — every later fix confirmed in the watcher).
- Still the right next step? Yes — the API exists (2.4), the data flows (2.1–2.3), this step makes it visible.

## §1 Intent

Build a `/watcher` page in mission-control with two views:
1. **Live stream** — all memory operations in real time (polling /api/watcher every 3s), with status badges (ok=green, noop=yellow, error=red), timestamps, op types, durations.
2. **Silent failures** — a dedicated filtered view showing only noop + error ops (the things that ran but did nothing or broke).

Additionally, add a `useWatcher()` SWR hook to `src/lib/hooks.ts` following the existing codebase pattern.

## §2 Design decisions

- **Pattern:** follows the existing observability page (terminal-style, monospace, status-colored rows, auto-refresh via SWR `refreshInterval: 3000`).
- **No new API routes needed** — consumes the existing `GET /api/watcher` endpoint (step 2.4).
- **Tab-based view toggle** — "Stream" (all events) vs "Failures" (status=noop|error), client-side filter only.
- **Health summary card** at the top — shows store row counts, WAL sizes, drift status from the health probe.
- **No SSE/WebSocket** — consistent with all other mission-control pages (SWR polling).

## §3 Risk register

| Risk | Mitigation |
|---|---|
| Page doesn't hot-reload in runtime Next.js dev server | Copy file to runtime; restart if needed (dev server auto-detects new pages) |
| Runtime evidence requires visual browser observation | Verify page serves HTTP 200 + API returns events; induce an event and observe it in API response |

## §4 File-delta outline

| File | Action |
|---|---|
| `mission-control/src/app/watcher/page.tsx` | CREATE — the panel page |
| `mission-control/src/lib/hooks.ts` | EDIT — add `useWatcher()` hook + types |
