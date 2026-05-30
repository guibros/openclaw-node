# AUDIT_POST — Step 2.3: Store-health probes: row counts, last-write, WAL size, repo↔runtime drift

## 1. Files-vs-plan ledger

| Plan (AUDIT_PRE §4) | Actual | Match |
|---|---|---|
| EDIT `lib/memory-watcher.mjs` — add `runStoreHealthProbes(opts)` export | Done — `probeStore` helper at lines 18–30, `runStoreHealthProbes` at lines 32–72. Probes 3 stores (state, knowledge, graph_cache), WAL sizes, symlink drift. | ✓ |
| EDIT `test/memory-watcher.test.mjs` — add probe tests | Done — 6 new test cases in `runStoreHealthProbes` describe block: state.db row counts, graph-cache counts, missing DBs → null, WAL size, symlink drift, timestamp validity. | ✓ |
| EDIT `workspace-bin/memory-daemon.mjs` — wire timer + shutdown | Done — import at line 50; probe timer (5 min interval + immediate initial run) at lines 1195–1209; `clearInterval` in shutdown at line 1298. | ✓ |

No unplanned files touched.

## 2. Greppable deltas

```
lib/memory-watcher.mjs:10-16     — DEFAULT_*_DB / DEFAULT_WORKSPACE_* path constants
lib/memory-watcher.mjs:18-20     — walSize(dbPath): stat WAL file, 0 if absent
lib/memory-watcher.mjs:22-23     — isSymlink(p): lstat check
lib/memory-watcher.mjs:25-35     — probeStore(Database, dbPath, queries): readonly open, run named queries, add wal_bytes
lib/memory-watcher.mjs:37-72     — runStoreHealthProbes(opts): probes 3 stores + drift, returns structured record
workspace-bin/memory-daemon.mjs:50  — import runStoreHealthProbes
workspace-bin/memory-daemon.mjs:1195-1209 — health probe timer (5 min) + initial run
workspace-bin/memory-daemon.mjs:1298 — clearInterval(healthProbeTimer) in shutdown
test/memory-watcher.test.mjs:1-5 — added imports (fs, os, path, before, after, runStoreHealthProbes)
test/memory-watcher.test.mjs:197-298 — 6 test cases for runStoreHealthProbes
```

## 3. Done-evidence (runtime-observable)

| Evidence | Result |
|---|---|
| Unit tests pass | `npm test`: 1406 pass / 0 fail (+6 new from probe tests). |
| Daemon running new code | PID restarted via `launchctl kickstart -k`. Log: `[watcher] health probe: 3 stores checked` at 21:59:12. |
| Probe output in watcher.jsonl | `{"ts":"2026-05-30T01:59:12.830Z","op":"health.probe","status":"ok","stores":{"state":{"sessions":233,"messages":8012,"entities":1039,"themes":615,"mentions":2074,"decisions":291,"last_session":"2026-05-28T21:42:00.697Z","wal_bytes":4556752},"knowledge":{"session_documents":225,"session_chunks":11952,"last_indexed":1779472682955,"wal_bytes":4713312},"graph_cache":{"nodes":65,"edges":317,"last_refresh":"2026-05-25T23:45:31.750Z","wal_bytes":32992}},"drift":{"lib_symlinked":true,"daemon_symlinked":true}}` |
| Probe matches known DB state | Entities=1039, themes=615, mentions=2074, decisions=291 — exact match to COMPONENT_REGISTRY (verified 2026-05-27). Sessions 233 (≈230+3 new). Graph-cache nodes=65, edges=317 — exact match. |
| WAL size shown | state.db=4,556,752 bytes; knowledge.db=4,713,312 bytes; graph-cache.db=32,992 bytes. All non-zero. |
| INVENTORY done-evidence met | "probe output matches a direct SQL count" — the probe runs `SELECT COUNT(*)` queries readonly; output consistent with the last audited registry values. "WAL size shown" — three WAL sizes reported in the probe output. |

## 4. Cross-refs

- `probeStore` uses the `{ readonly: true }` pattern established by `lib/health-check.mjs:146` for safe concurrent reads.
- `runStoreHealthProbes` is fully injectable (Database constructor, all paths) for testability — same DI pattern as `runHealthCheck(opts)`.
- The daemon wires the probe after watcher init (line 1195) and clears on shutdown (line 1298), following the same lifecycle pattern as the watcher itself.
- Health probe records share `watcher.jsonl` with event records but are distinguishable by `op: 'health.probe'` (vs `memory.*` for events).

## 5. Findings

- `knowledge.db` `last_indexed` column stores epoch milliseconds, not ISO 8601. The probe faithfully returns what the DB stores (1779472682955). Consumers of the probe output should be aware of this inconsistency across stores. Not a bug — the knowledge module's schema predates the redesign.
- All three WAL files are non-zero, confirming no WAL checkpoint has run recently. This validates the Block 6 concern (step 6.4: WAL checkpoint on graceful shutdown).

## 6. Carry-forwards for step 2.4

- Step 2.4 (mission-control API endpoint serving watcher records + health) can read both event records and health probe records from `watcher.jsonl`. The `op` field distinguishes them: `memory.*` = event records, `health.probe` = store health snapshots.
- The health probe timer runs every 5 minutes; the API endpoint should serve the most recent probe record without needing its own timer.
- The `last_indexed` epoch-ms vs ISO inconsistency should be normalized at the API layer if needed for the panel UI.
