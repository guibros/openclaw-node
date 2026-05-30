# AUDIT_PRE — Step 2.4: Mission-control API endpoint serving watcher records + health

## §0 Re-orient

- Where am I: Block 2 (L2 watcher), step 4/6, 14/40 overall.
- Last step changed: v2.3 added store-health probes (row counts, WAL, drift) on a 5-min timer to watcher.jsonl.
- This step contributes: exposes the watcher data over HTTP so mission-control's panel UI (step 2.5) can consume it.
- Block serves the north star via: D6 (full observability lens) — the watcher needs a readable surface.
- Still the right next step? Yes — the data exists (watcher.jsonl); the next consumer is the API.

## 1. Intent

Add a Next.js API route to mission-control that reads `~/.openclaw/watcher.jsonl` and serves:
- Recent event records (memory.ingested, memory.extracted, etc.) — most recent first
- The latest health probe record (op: 'health.probe')
- Query params for filtering (limit, status, op type)

## 2. Design

A single API route at `mission-control/src/app/api/watcher/route.ts`:

**`GET /api/watcher`** returns:
```json
{
  "events": [ ...recent event records... ],
  "health": { ...latest health.probe record or null... }
}
```

Query params:
- `limit` (default 50) — max event records to return
- `status` — filter events by ok/noop/error
- `op` — filter by operation type (e.g. memory.ingested)

Implementation reads the JSONL file, parses line-by-line, separates events from health probes, applies filters, returns JSON.

Carry-forward from step 2.3: normalize `last_indexed` epoch-ms to ISO in the health response.

The watcher.jsonl path: `path.join(os.homedir(), '.openclaw', 'watcher.jsonl')` — one level above WORKSPACE_ROOT.

## 3. Risk register

- JSONL file could be large — mitigated by reading from end (tail), or capping at limit. At current scale (tens of records) this is not a concern.
- Mission-control runtime is a separate copy, not symlinked — must deploy the new file to runtime and restart/hot-reload.

## 4. File-delta outline

| Action | File |
|---|---|
| CREATE | `mission-control/src/app/api/watcher/route.ts` |
