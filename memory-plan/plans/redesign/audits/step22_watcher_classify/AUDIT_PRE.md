# AUDIT_PRE — Step 2.2: Classify each op ok / noop / error (incl. empty-output no-op detection)

## §0 Re-orient

- Where am I: Block 2 (L2 watcher), step 2/6, 11/40 overall.
- Last step changed: 2.1 shipped watcher core — subscribe to event log, persist `{ts,op,actor,session,duration_ms}` records to `~/.openclaw/watcher.jsonl`.
- This step contributes: adds semantic classification (`ok`/`noop`/`error`) to each watcher record, making the watcher useful for surfacing silent failures (the core L2 purpose).
- Block serves the north star via: DESIGN_INPUTS §2 "one hop" observability + §4 "did we produce readable output" — the watcher IS the lens that answers these.
- Still the right next step? Yes — classification is the first step that makes the watcher actionable (raw records without status are just event replay).

## §1 Intent

Add a `status` field to watcher records. Three values:
- `error` — event type is `memory.error`.
- `noop` — the operation ran but produced no useful output (zero-count detection).
- `ok` — the operation ran and produced meaningful output.

## §2 Design

Extend `toWatcherRecord` in `lib/memory-watcher.mjs` with a `classifyStatus(event)` function:

| event_type | noop condition | ok condition |
|---|---|---|
| `memory.error` | n/a — always `error` | n/a |
| `memory.ingested` | `messages_added === 0` | `messages_added > 0` |
| `memory.extracted` | sum of `entities_count + themes_count + mentions_count + decisions_count === 0` | sum > 0 |
| `memory.retrieved` | `results_count === 0` | `results_count > 0` |
| `memory.injected` | `blocks_count === 0` | `blocks_count > 0` |
| `memory.synthesized` | `artifacts_written.length === 0` | length > 0 |
| `memory.decayed` | `entities_decayed === 0` | > 0 |
| `memory.promoted` | `entities_promoted === 0` | > 0 |
| any other | — | default `ok` |

Carry-forward from 2.1: `toWatcherRecord` already extracts `ts/op/actor/session/duration_ms`. Adding `status` alongside these fields is a single-field extension.

## §3 Risk register

| Risk | Mitigation |
|---|---|
| Classification logic depends on event data field names — if a schema changes, classification breaks silently | Lock to the schemas defined in event-schemas (they're Zod-validated); the test suite covers each event type |
| New event types added later won't have classification rules | Default to `ok` for unknown ops — safe fallback |

## §4 File-delta outline

| File | Change |
|---|---|
| `lib/memory-watcher.mjs` | Add `classifyStatus(event)` function; add `status` field to `toWatcherRecord` return |
| `test/memory-watcher.test.mjs` | Add tests for each classification case: error, noop (per-op), ok |
