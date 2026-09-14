# AUDIT_PRE — step 6.2 · `lib/node-agent.mjs`

**Opened:** 2026-09-14, Montreal · **Carrier:** `v6.2-pre`

## What the seams actually are (read before designing)

- **`lib/llm-client.mjs`** (6.1): `generate(messages, { tools })` → `{ content, toolCalls, usage,
  finishReason }`, `toolCalls` already normalized to `{ id, name, arguments }` with object arguments
  on both backends. So the agent needs no backend branching of its own.
- **Fleet data** is `GET /api/mesh/nodes` → `{ nodes, tokenStats, meshStatus }`. Each node carries a
  `NodeHealth` blob: disk, mem, uptime, cpu, services[], agent{status,currentTask,llm,model,budget},
  capabilities[], stats{}, tailscale{peers[]}, nats{}. That is **far too large to hand a model
  whole** — a five-node fleet with tailscale peers is tens of KB. The tools must project.
- **Tasks** are `GET /api/mesh/tasks` → `{ tasks, natsAvailable }` (NATS KV entries, sorted by
  priority then age).
- **Memory** is `createMemoryInjector({knowledgeDb, extractionDb, graphCache})` → `{ retrieve }`.
- **Auth**: Mission Control requires its session token on *every* `/api` method. `lib/mc-session-token.mjs`
  exports `mcAuthHeaders()`, which node-watch and scheduler-heartbeat already use. One helper, not a
  fifth copy.

## The pattern being ported

God's Eye View's `src/data/analystEngine.js` keeps **all** query logic in pure functions over plain
record arrays (`applyFilter(records, {field, op, value})`, `applyScope`) and injects live data
through a `providers` object, so the engine is node-testable with no browser, no network and no
globe. `createAnalystEngine(providers)` only sequences and remembers.

Ported here: `applyFilter` with the same seven operators, minus the spatial half (`haversineKm`,
`applyScope`, `pointInRing`) which has no meaning for a fleet. Added in its place, because the
records here are shaped by us rather than by five upstream feeds: **a declared field whitelist per
record kind**. GEV's filter silently drops records whose field is missing; for a model-supplied
filter that is the wrong failure — `{field: "state", op: "eq", value: "down"}` against a record
whose field is `status` would return zero rows and the model would report an empty fleet. An
undeclared field is refused by name instead, and the error goes back to the model as a tool result
it can correct from.

## Design

`createNodeAgent({ client, providers, ... })` — providers injected exactly as GEV does it:
`getFleet()`, `getTasks()`, `recall(query)`. `createDefaultProviders()` builds the HTTP/injector-backed
set separately, so the agent stays testable without Mission Control, NATS or ollama.

Four tools, each returning a **projection**: `get_fleet_state` (one line per node + mesh summary),
`get_node_health` (the fuller blob for one named node), `query_tasks` (filtered, projected rows),
`recall_memory` (the injector's curated block). The system prompt carries GEV's "call context tools
first" discipline: answer about live state only from a tool result, and say so when a tool returns
nothing rather than filling the gap from training.

## Verify

- `code:` pure-filter tests (each operator, missing field, undeclared field refused by name,
  case-insensitive text, boolean `eq`); projection tests proving the fleet summary omits the heavy
  sub-objects; tool-dispatch tests including an unknown tool name and a tool that throws.
- `runtime:` the full loop against a **real HTTP stub model** speaking the Ollama native shape —
  round 1 returns a `get_fleet_state` tool call, round 2 an answer — with the fleet provider serving
  a recorded `/api/mesh/nodes` shape. The returned trace must show the tool call **preceding** the
  answer, and the answer must name the node that is actually down. Model-side selection quality
  (does qwen3 pick the right tool unprompted) stays the operator probe 6.1 already recorded.
