# AUDIT_POST — Step 2.4: Mission-control API endpoint serving watcher records + health

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| CREATE `mission-control/src/app/api/watcher/route.ts` — Next.js API route reading watcher.jsonl | Done — 85-line route with GET handler, JSONL parser, health normalizer, query param filters. | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
mission-control/src/app/api/watcher/route.ts:1-85 — new file
  :8    — WATCHER_JSONL path derived from WORKSPACE_ROOT parent
  :10-20  — parseJsonlTail(filePath, maxLines): reads file, splits lines, parses JSON, returns tail
  :36-42  — normalizeHealth(record): adds last_indexed_iso from epoch-ms (carry-forward from 2.3)
  :53-83  — GET handler: parses limit/status/op params, separates events from health probes, filters, returns JSON
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests pass (baseline) | `npm test`: 1406 pass / 0 fail (no test files changed). |
| Endpoint responds | `curl http://localhost:3000/api/watcher` → 200 OK with `{events: [...], health: {...}, source: "..."}`. |
| Events returned | 12 event records spanning memory.ingested, memory.extracted, memory.retrieved, memory.injected, memory.error — all from watcher.jsonl. |
| Health returned | Latest health.probe record with state.db (sessions=233, entities=1039), knowledge.db (session_docs=225), graph-cache (nodes=65, edges=317), WAL sizes, drift symlinks. |
| last_indexed normalized | `last_indexed_iso: "2026-05-22T17:58:02.955Z"` added alongside raw epoch-ms (1779472682955). |
| Status filter works | `?status=error` → 1 error event only. |
| Op filter works | `?op=memory.ingested` → 3 ingested events only. |
| Limit works | `?limit=2` → 2 events returned. |
| INVENTORY done-evidence met | "`curl` the endpoint → current watcher records as JSON" — demonstrated above. |

## 4. Cross-refs

- Route reads `~/.openclaw/watcher.jsonl` — written by `lib/memory-watcher.mjs` (step 2.1) with event records and health probes (step 2.3).
- Record shape consumed: `{ts, op, status, actor, session, duration_ms}` for events, `{ts, op, status, stores, drift}` for health probes — both produced by `toWatcherRecord()` and `runStoreHealthProbes()`.
- `WORKSPACE_ROOT` imported from `@/lib/config` — the same config used by all other mission-control API routes.
- Deployed to runtime via file copy to `~/.openclaw/workspace/projects/mission-control/src/app/api/watcher/route.ts`; Next.js hot-reloaded.

## 5. Findings

- Mission-control runtime is a separate file copy, not symlinked to the repo (unlike lib/ and the daemon binary). The file was manually copied. This means future changes to the route require re-deployment. Not a regression — this is the existing deploy model for mission-control. Captured in OUT_OF_SCOPE if not already.
- The watcher.jsonl file is small (13 records). The `parseJsonlTail` reads the entire file then takes a tail slice — acceptable at current scale. If the file grows large (thousands of lines), a reverse-read strategy or log rotation would be needed (step 2.6 anomaly alerts may address this, or it's a future concern).

## 6. Carry-forwards for step 2.5

- The API shape (`{ events, health, source }`) is the data contract the mission-control panel UI (step 2.5) will consume.
- The panel should poll `GET /api/watcher` via SWR (the existing data-fetching pattern in mission-control).
- Health probe data includes all store metrics the panel needs (row counts, WAL sizes, drift, timestamps).
- Event records include status classification (ok/noop/error) for the "silent-failures view" in step 2.5.
