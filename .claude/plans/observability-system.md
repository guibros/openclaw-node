# Observability System — Implementation Plan

## Overview

Add comprehensive function-level observability across the entire OpenClaw node protocol with a dedicated Mission Control dashboard page showing system topology, live feed, and event timeline.

**Two modes:**
- **Dev mode (all tiers):** Every function call logged — ~500 instrumentation points. Toggle on/off from MC dashboard.
- **Production mode (smart sampling):** Only logs state transitions, errors, cross-node events, and slow calls (>500ms). Default.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Mission Control                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │  /observability page                              │   │
│  │  ┌────────────┐ ┌─────────────┐ ┌─────────────┐  │   │
│  │  │ System Map │ │  Live Feed  │ │  Timeline   │  │   │
│  │  │ (topology) │ │  (stream)   │ │  (history)  │  │   │
│  │  └────────────┘ └─────────────┘ └─────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│           ↑ SSE            ↑ GET                         │
│  ┌────────────────────────────────────────┐              │
│  │  /api/observability/stream  (SSE)      │              │
│  │  /api/observability/events  (REST)     │              │
│  │  /api/observability/config  (REST)     │              │
│  │  /api/observability/nodes   (REST)     │              │
│  └────────────────────────────────────────┘              │
│           ↑ NATS sub          ↑ SQLite                   │
└───────────┼───────────────────┼──────────────────────────┘
            │                   │
    NATS: openclaw.trace.>      │  observability_events table
            │                   │
┌───────────┴───────────────────┴──────────────────────────┐
│              lib/tracer.js (shared module)                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  trace(module, fn, args, result, duration, meta)    │ │
│  │  → NATS publish openclaw.trace.{nodeId}.{module}    │ │
│  │  → Local ring buffer (last 1000 events)             │ │
│  │  → Smart sampling filter                            │ │
│  └─────────────────────────────────────────────────────┘ │
│           ↑ called from every instrumented function      │
│                                                          │
│  bin/mesh-agent.js    (instrumented)                     │
│  bin/mesh-task-daemon  (instrumented)                    │
│  bin/mesh-bridge.js   (instrumented)                     │
│  lib/mesh-tasks.js    (instrumented)                     │
│  lib/mesh-collab.js   (instrumented)                     │
│  lib/mesh-plans.js    (instrumented)                     │
│  ... all ~500 functions                                  │
└──────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Create `lib/tracer.js` — Shared Instrumentation Core

New file. The heart of the system. ~150 lines.

**Exports:**
- `createTracer(moduleName)` — returns a module-scoped tracer
- `tracer.wrap(fnName, fn)` — wraps a function with automatic tracing
- `tracer.wrapAsync(fnName, fn)` — async version
- `tracer.wrapClass(instance, methodNames)` — bulk-wrap class methods
- `tracer.emit(event)` — manual event emission
- `setTraceMode('dev' | 'smart')` — toggle mode
- `getTraceMode()` — read current mode
- `getRecentEvents(limit)` — read from ring buffer

**Trace event schema:**
```js
{
  id: crypto.randomUUID(),
  timestamp: Date.now(),
  node_id: NODE_ID,
  module: 'mesh-tasks',        // source module
  function: 'markCompleted',   // function name
  tier: 1,                     // 1=critical, 2=important, 3=utility
  category: 'state_transition', // state_transition|error|cross_node|api_call|io|compute
  args_summary: 'taskId=T-042', // truncated arg summary (not full args — privacy)
  result_summary: 'completed',  // truncated result
  duration_ms: 12,
  error: null,                  // error message if thrown
  meta: { taskId: 'T-042', fromStatus: 'running', toStatus: 'completed' }
}
```

**Smart sampling filter:**
- Always log: `category === 'state_transition'`
- Always log: `category === 'error'`
- Always log: `category === 'cross_node'`
- Always log: `duration_ms > 500`
- Always log: `tier === 1`
- In smart mode, drop tier 2/3 events that don't match above criteria
- In dev mode, log everything

**Transport:**
- Primary: NATS publish to `openclaw.trace.{nodeId}.{module}` (if NATS connected)
- Fallback: local ring buffer (in-memory, last 1000 events)
- No file I/O — zero disk overhead

### Step 2: Instrument `lib/` Store Classes (Tier 1) — ~76 methods

**Files:** `mesh-tasks.js`, `mesh-plans.js`, `mesh-collab.js`

Pattern: After class construction, wrap all methods:
```js
const tracer = require('./tracer').createTracer('mesh-tasks');

class TaskStore {
  constructor(kv) {
    this.kv = kv;
    // After all method definitions, wrap them
    tracer.wrapClass(this, [
      'claim', 'markRunning', 'markCompleted', 'markFailed',
      'markPendingReview', 'markApproved', 'markRejected',
      'markReleased', 'logAttempt', 'touchActivity',
      'findStalled', 'findOverBudget', 'list', 'get', 'put'
    ], { tier: 1, category: 'state_transition' });
  }
}
```

`wrapClass` replaces each method with a wrapper that calls `tracer.emit()` with timing, args summary, and result summary.

### Step 3: Instrument `bin/` Daemons (Tier 1-2) — ~100 functions

**Files:** `mesh-task-daemon.js`, `mesh-agent.js`, `mesh-bridge.js`, `lane-watchdog.js`, `mesh-health-publisher.js`

Pattern: Wrap each function at definition:
```js
const tracer = require('../lib/tracer').createTracer('mesh-task-daemon');

const handleSubmit = tracer.wrapAsync('handleSubmit', async (msg) => {
  // ... existing code unchanged ...
}, { tier: 1, category: 'state_transition' });
```

For the daemon's NATS handlers, the wrapping captures the full request-response cycle.

### Step 4: Instrument `lib/` Utility Modules (Tier 2-3) — ~95 functions

**Files:** `kanban-io.js`, `exec-safety.js`, `mesh-harness.js`, `role-loader.js`, `rule-loader.js`, `llm-providers.js`, `nats-resolve.js`, `agent-activity.js`, `memory-budget.mjs`, `session-store.mjs`, `hyperagent-store.mjs`

Same wrap pattern. Tier 2 for security/harness functions, Tier 3 for utilities.

### Step 5: Instrument MC API Routes (Tier 2) — ~80 handlers

**Pattern:** Create a `withTrace` higher-order function for route handlers:
```typescript
// mission-control/src/lib/tracer.ts
export function withTrace(module: string, method: string, handler: Function, opts?: TraceOpts) {
  return async (request: NextRequest, ...args: any[]) => {
    const start = Date.now();
    try {
      const result = await handler(request, ...args);
      emitTrace({ module, function: method, duration_ms: Date.now() - start, ... });
      return result;
    } catch (err) {
      emitTrace({ module, function: method, error: err.message, ... });
      throw err;
    }
  };
}
```

Apply to each route:
```typescript
export const GET = withTrace('tasks', 'GET /api/tasks', async (request) => {
  // ... existing handler ...
});
```

MC-side traces go directly to SQLite (same process) + NATS publish.

### Step 6: Create SQLite Table + API Routes

**New table** — `observability_events`:
```sql
CREATE TABLE IF NOT EXISTS observability_events (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  module TEXT NOT NULL,
  function TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 2,
  category TEXT NOT NULL,
  args_summary TEXT,
  result_summary TEXT,
  duration_ms INTEGER,
  error TEXT,
  meta TEXT,  -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_obs_timestamp ON observability_events(timestamp DESC);
CREATE INDEX idx_obs_module ON observability_events(module);
CREATE INDEX idx_obs_category ON observability_events(category);
CREATE INDEX idx_obs_node ON observability_events(node_id);
```

**Auto-cleanup:** Delete events older than 24h every hour (cron or on-read).

**New API routes:**

1. `GET /api/observability/stream` — SSE endpoint, subscribes to `openclaw.trace.>` via NATS
2. `GET /api/observability/events?since=&module=&node=&category=&limit=` — historical query from SQLite
3. `GET/PATCH /api/observability/config` — read/toggle trace mode (dev vs smart)
4. `GET /api/observability/nodes` — live node topology (health + daemon status)

### Step 7: NATS → SQLite Ingestion

In the SSE route handler (or a background process), subscribe to `openclaw.trace.>` and batch-insert events into SQLite every 500ms. Use a write buffer to avoid per-event DB writes.

### Step 8: Build MC Dashboard Page — `/observability`

**New page:** `mission-control/src/app/observability/page.tsx`

**Layout (3 panels):**

```
┌──────────────────────────────────────────────────────┐
│  [Dev Mode ◉] [Smart Mode ○]    Filter: [________]   │
├──────────────────────────────────────────────────────┤
│                  SYSTEM MAP (top)                     │
│  ┌──────────┐     NATS      ┌──────────┐            │
│  │ Lead     │◄─────────────►│ Worker   │            │
│  │ macOS    │               │ Ubuntu   │            │
│  │          │               │          │            │
│  │ ● daemon │               │ ● agent  │            │
│  │ ● bridge │               │ ● health │            │
│  │ ● agent  │               │ ● deploy │            │
│  │ ● MC     │               │          │            │
│  └──────────┘               └──────────┘            │
│  (green=active, gray=idle, red=error)                │
├─────────────────────┬────────────────────────────────┤
│   TIMELINE (left)   │      LIVE FEED (right)         │
│                     │                                │
│  ● 19:42:03 T-042  │  [19:42:03.412] mesh-tasks     │
│    completed        │    markCompleted(T-042)        │
│                     │    12ms ✓ running→completed    │
│  ● 19:42:01 T-042  │                                │
│    metric passed    │  [19:42:01.891] mesh-agent     │
│                     │    evaluateMetric(npm test)    │
│  ● 19:41:55 T-043  │    3401ms ✓ passed             │
│    claimed          │                                │
│                     │  [19:41:55.102] mesh-tasks     │
│  ○ 19:41:30 collab  │    claim() → T-043            │
│    round started    │    8ms ✓                       │
│                     │                                │
│  Click to filter ↑  │  Auto-scroll ↓                 │
└─────────────────────┴────────────────────────────────┘
```

**Components:**
- `SystemMap` — node topology with daemon status indicators. Uses NATS health data.
- `EventTimeline` — left sidebar, grouped by task/session. Click to filter the feed.
- `LiveFeed` — scrolling log stream via SSE. Color-coded by category. Expandable rows for detail.
- `TraceConfigToggle` — dev/smart mode switch, hits `PATCH /api/observability/config`
- `FilterBar` — filter by node, module, category, severity, text search

**Data flow:**
- SSE from `/api/observability/stream` → LiveFeed + EventTimeline (real-time)
- REST from `/api/observability/events` → EventTimeline (historical on page load)
- REST from `/api/observability/nodes` → SystemMap (poll every 5s)

### Step 9: Add Sidebar Link + Navigation

Add "Observability" to the MC sidebar in `mission-control/src/components/layout/sidebar.tsx`.

---

## File Changes Summary

**New files (7):**
- `lib/tracer.js` — core instrumentation module (~200 lines)
- `mission-control/src/lib/tracer.ts` — MC-side trace helper (~80 lines)
- `mission-control/src/app/observability/page.tsx` — dashboard page (~300 lines)
- `mission-control/src/components/observability/system-map.tsx` (~150 lines)
- `mission-control/src/components/observability/live-feed.tsx` (~200 lines)
- `mission-control/src/components/observability/event-timeline.tsx` (~150 lines)
- `mission-control/src/app/api/observability/` — 4 route files (~400 lines total)

**Modified files (~40):**
- All `lib/*.js` and `lib/*.mjs` — add tracer imports + wrap calls
- All `bin/*.js` — add tracer imports + wrap handlers
- `mission-control/src/lib/db/index.ts` — add observability_events table
- `mission-control/src/lib/db/schema.ts` — add schema definition
- `mission-control/src/components/layout/sidebar.tsx` — add nav link
- ~25 MC API route files — wrap handlers with `withTrace`

**Estimated scope:** ~2,500 lines new code, ~500 lines of modifications across ~47 files.

---

## Implementation Order

1. `lib/tracer.js` + tests — the core, everything depends on it
2. DB schema + API routes — the backend
3. Instrument Tier 1 (stores + daemon handlers) — immediate value
4. SSE endpoint + NATS ingestion — real-time pipeline
5. Dashboard page (system map + live feed + timeline) — the UI
6. Instrument Tier 2-3 (remaining ~400 functions) — full coverage
7. Sidebar link + polish
