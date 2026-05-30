# AUDIT_PRE — Step 2.1: Watcher core: subscribe to the event log, persist one record per op to JSONL

## §0 Re-orient

- Where am I: Block 2 (L2 memory-watcher), step 1/6, 10/40 overall.
- Last step changed: 1.5 wired memory.error at all caught boundaries — closed Block 1 (event log spine complete).
- This step contributes: the watcher's core loop — subscribe to the event stream and persist per-op records. Foundation for classification (2.2), health probes (2.3), and the mission-control surface (2.4–2.6).
- Block serves the north star via: DESIGN_INPUTS §2 "one hop" observability + D6 "the lens, built early."
- Still the right next step? Yes — Block 1 delivered the event stream; Block 2 reads it.

## 1. Intent

Create `lib/memory-watcher.mjs` — a module that subscribes to the per-node JetStream stream `local-events-<nodeId>` via a durable consumer, and for each event writes one JSONL record to `~/.openclaw/watcher.jsonl`. Wire it into the daemon after the local event log is initialized. No classification (2.2), no health probes (2.3), no API (2.4) — just the subscribe-and-persist loop.

## 2. Design

### Module: `lib/memory-watcher.mjs`

Export: `createMemoryWatcher(nc, nodeId, opts)` → `Promise<{ stop() }>`

- `opts.outputPath` — path to the JSONL file (default `~/.openclaw/watcher.jsonl`)
- `opts.log` — logger function

Behavior:
1. Create a durable JetStream consumer `watcher-<nodeId>` on stream `local-events-<nodeId>`, deliver_policy `all` (catch up on startup).
2. For each message: parse JSON, extract a flat record, append to outputPath as one JSON line + `\n`.
3. Ack each message after writing.
4. `stop()` — drain the consumer iterator.

Export: `toWatcherRecord(event)` — pure function, testable.

Record shape (per INVENTORY done-evidence):
```json
{"ts":"<ISO>","op":"memory.ingested","actor":"daemon-daedalus","session":"<id-or-null>","duration_ms":<n-or-null>}
```

Fields extracted from the event envelope + data:
- `ts` ← `event.timestamp`
- `op` ← `event.event_type`
- `actor` ← `event.actor.id`
- `session` ← `event.data.session_id` (if present, else null)
- `duration_ms` ← `event.data.duration_ms` (if present, else null)

No classification (ok/noop/error) — that's step 2.2.

### Daemon wiring: `workspace-bin/memory-daemon.mjs`

After `localEventLog` is initialized (~line 1180):
```
const watcher = await createMemoryWatcher(natsConn, NODE_ID, { log });
```

In shutdown handler (~line 1264), add `watcher.stop()`.

### Test: `test/memory-watcher.test.mjs`

Verify that `toWatcherRecord(event)` produces the correct flat record shape from a memory event built by `buildMemoryEvent`.

## 3. Risk register

| Risk | Mitigation |
|---|---|
| Consumer on same stream as producer — could miss messages during init | JetStream guarantees: durable consumer with deliver_policy `all` catches up on all persisted messages. |
| JSONL file grows unbounded | Out of scope for 2.1. Step 2.3 (health probes) or later can add rotation. Capture in OUT_OF_SCOPE if needed. |
| Daemon fails to start if watcher init fails | Wrap in try/catch like every other NATS component — log and continue without watcher. |

## 4. File-delta outline

| File | Change |
|---|---|
| `lib/memory-watcher.mjs` | NEW — watcher core module |
| `workspace-bin/memory-daemon.mjs` | EDIT — import + init watcher after localEventLog; shutdown cleanup |
| `test/memory-watcher.test.mjs` | NEW — unit test for record extraction |

## 5. Carry-forwards consumed

From step 1.5 AUDIT_POST §6:
- "The watcher can now consume `memory.error` events from the stream to classify error outcomes" — consumed; the watcher will receive these events and persist them. Classification is 2.2.
- "`error_code` is a string, not an enum — the watcher should group by this field" — noted for 2.2.
