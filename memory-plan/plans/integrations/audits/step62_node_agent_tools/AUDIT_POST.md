# AUDIT_POST — step 6.2 · `lib/node-agent.mjs`

**Closed:** 2026-09-14, Montreal · **Carrier:** `v6.2` · **Branch:** `claude/hermes-essential-skills-ch3s0o`

## What shipped

`createNodeAgent({ client, providers })` — a tool-calling loop over the four grounding tools
`get_fleet_state`, `get_node_health`, `query_tasks`, `recall_memory`. All query logic is in pure
functions over plain record arrays (`applyFilter`, `projectFleet`, `projectNodeHealth`,
`projectTasks`); live data arrives through an injected `providers` object, and
`createDefaultProviders()` builds the real one against Mission Control with `mcAuthHeaders()`. That
split is the whole reason the loop could be driven end to end in this container with no ollama.

`ask()` returns `{ answer, trace, rounds, usage }`. The trace is not decoration: it is the record of
what the answer was built from, and it is what 6.3 will surface.

## Three judgements worth recording

**The tools project; they do not forward.** A `NodeHealth` blob carries `services[]`,
`capabilities[]`, `stats{}` and `tailscale.peers[]`. A five-node fleet with a dozen peers each is
tens of KB of context spent before the model has read the question. `get_fleet_state` returns one
line per node and `get_node_health` serves the rest for the single node that needs explaining —
which is the reason the two are separate tools rather than one with a verbosity flag. A test asserts
the fleet summary stays under 1200 bytes and that neither `tailscale` nor the service names appear
in it, so the split cannot silently rot.

**The filter declares its fields (D11).** GEV's `applyFilter` drops records whose field is missing,
correct for ragged upstream feeds. Ported unchanged, it would turn a model's schema mistake into a
confident wrong answer: `{field: 'state', op: 'eq', value: 'down'}` against records keyed `status`
matches nothing, and "no nodes match" is indistinguishable from "the fleet is fine". `FILTERABLE`
refuses an undeclared field by name and lists what does exist.

**A failing tool is a tool result, not an exception.** `no node "laptop" in the mesh — known nodes:
vm` goes back to the model as the tool's content; it can correct on the next round, and the operator
sees the error in the trace either way. A thrown error would have ended the turn with nothing.

## Evidence

### `runtime:` — the loop against the **real** Mission Control API

`next dev` on 127.0.0.1:3000, real session token, real `/api/mesh/nodes` and `/api/mesh/tasks`.
Only the model is stubbed — an HTTP server speaking Ollama's native `/api/chat` shape, because this
container has no ollama. So the grounding path is real end to end; only the language is not.

```
[round 1] tools advertised: get_fleet_state, get_node_health, query_tasks, recall_memory
  system   You answer questions about this OpenClaw node and the mesh it belongs to. Call a context tool…
  user     which nodes are down

[round 2] tools advertised: get_fleet_state, get_node_health, query_tasks, recall_memory
  system   …
  user     which nodes are down
  assistant->tool_call  [{"type":"function","function":{"name":"get_fleet_state","arguments":"{}"}}]
  tool:get_fleet_state  {"nodes":[{"nodeId":"vm","status":"online","role":"lead","platform":"linux",
                         "agentStatus":"not installed","currentTask":null,"staleSeconds":3,
                         "cpuLoadPercent":8,"diskPercent":32,"activeTaskCount":0}],"mesh":{…}}

trace : [{"tool":"get_fleet_state","args":{},"ms":28,"error":null}]
rounds: 2
answer: All 1 node(s) online.
```

**The ordering is the claim and it holds:** round 1 carries no tool message, round 2 carries the
tool result before the model produces any answer, and the tools were genuinely advertised in the
request body rather than held locally. The row is this container's own node as Mission Control
reports it — `vm`, online, lead, linux, disk 32%, cpu 8%.

Second probe, same live API, the other two paths:

| Question | Tool | Result |
|---|---|---|
| "what work is queued" | `query_tasks{status=queued}` 159 ms | `{"count":0,"tasks":[]}` from real NATS KV |
| "how is the laptop doing" | `get_node_health{nodeId:"laptop"}` 28 ms | `no node "laptop" in the mesh — known nodes: vm` — returned as a tool result, trace error recorded, loop continued |

**What the live probe does not show:** this container's real fleet has exactly one node and it is
healthy, so the answer is "All 1 node(s) online" rather than a named casualty. The down-node claim
in the INVENTORY goal is proven in the test below against a recorded two-node `/api/mesh/nodes`
payload, where the answer names `studio` and is asserted **not** to name the online node. And
whether a real qwen3 reaches for `get_fleet_state` unprompted is the model-side probe 6.1 already
left with the operator; this step proves the loop, the grounding and the discipline, not the model.

### `code:` — `node --test test/node-agent.test.mjs` → 21/21

Filter: every operator, numeric-vs-string comparison, case-insensitive text, boolean `eq`, a missing
field dropping out, an absent filter not behaving as an empty one, an undeclared field refused by
name, an unimplemented operator refused. Projections: the fleet summary's fields and size bound,
per-node health, case-insensitive node match, the unknown-node message listing real nodes, and
`assignee` read from either `assignee` or `claimed_by` as the KV entries use both. Dispatch: status
filtering, task filter + limit, an unknown tool naming what exists, and every advertised tool name
actually dispatchable — so `TOOLS` cannot drift from the switch. Loop: the ordered transcript
against a real HTTP stub model, the correctable-error round, and a bounded stop when the model never
stops calling tools.

### Regression guard — full root suite, like-for-like

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| baseline `768930f` (worktree) | 2167 | 1881 | **211** | 7 |
| branch, after 3.2 | 2175 | 1889 | **211** | 7 |
| branch, after 6.2 | 2196 | 1910 | **211** | 7 |

Failure lists diffed by name against the previous run: **zero regressions, zero newly passing** —
the 21-test delta is exactly this step's file. The 211 are the container's standing environmental
failures (no NATS, no ollama, no `~/.openclaw` runtime).

## Left open

- 6.3 puts this behind `POST /api/agent/ask`. One thing to settle there: `generate()` routes through
  the ollama queue as an *extraction* job — long-running, no fallback. That is right for a question
  the user is waiting on (it must complete, not degrade), but it means an interactive ask can queue
  behind a running extraction. The route needs to say so rather than hang silently.
- `recall_memory` returns `{unavailable: "no memory injector configured"}` until a caller passes one;
  wiring the real injector needs the knowledge and extraction DBs, which 6.3 has access to and this
  module deliberately does not open for itself.
