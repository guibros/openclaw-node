# AUDIT_POST — step 6.3 · `POST /api/agent/ask`

**Closed:** 2026-09-14, Montreal · **Carrier:** `v6.3` · **Branch:** `claude/hermes-essential-skills-ch3s0o`

## What shipped

`POST /api/agent/ask` with `{q}` returns `{answer, trace, rounds, usage}`. The trace ships with the
answer rather than behind a debug flag: it is the record of which tools the answer was built from,
and an answer about live state with no tool call behind it is one the operator should distrust.

Behind it, `src/lib/agent-ask.ts` supplies the two things the 6.2 loop deliberately does not open
for itself — an LLM client and the live providers — and bounds the wait.

**The loader was extracted rather than copied.** `mesh-sign.ts` already resolved a root `lib/*.mjs`
by absolute path (`$OPENCLAW_LIB_DIR`, then `<cwd>/../../lib` for the installed layout, then
`<cwd>/../lib` for a repo checkout), and its own header explains why the module is loaded rather
than reimplemented: "a second ed25519 + canonicalization copy is the twin-divergence pattern the
review traced the exec bypass to." That argument covers the *resolution rule* too — a second
candidate list drifts the day the install layout changes. `src/lib/openclaw-lib.ts` now holds it and
`mesh-sign.ts` is rewritten onto it, behaviour unchanged, and the rule finally has tests (it had
none).

## Two things the probes changed

**A test premise was wrong, and the code was right.** A case written to assert "a missing root
module is reported by name" failed with `client.generate is not a function` instead. The reason is
the fallback working: with `OPENCLAW_LIB_DIR` pointing at a temp dir that lacks `node-agent.mjs`,
the loader falls through to `<cwd>/../lib/node-agent.mjs` — the real module. The candidate list was
doing exactly its job. The test now asserts *that*: the real loop answers through the repo-checkout
candidate. The not-found message is tested in `openclaw-lib.test.ts` with a filename that exists
nowhere.

**The first live probe returned `500 {"error":"fetch failed"}`.** That is undici's bare string for a
refused connection and it tells an operator nothing — not which endpoint, not that the model is
simply not running. Fixed in scope: a refused socket now becomes `ModelUnreachable` and the route
answers **503** `local model unreachable at http://localhost:11434 (ECONNREFUSED)`, naming the
endpoint the way the local TTS provider names VoiceStudio. A dependency being down is not a fault in
this route, and 500 said it was.

## The queue, stated rather than worked around

`generate()` routes through the ollama queue as an *extraction* job: it waits to completion and
never degrades. That is right for a question an operator is waiting on — a wrong answer fast is
worse than a right answer late — but an ask issued during extraction queues behind it. The route
bounds the wait (`AGENT_ASK_TIMEOUT_MS`, default 120 s) and returns **504** naming the cause:
`no answer within 120s — the local model is busy (asks queue behind extraction jobs)`.

Bypassing the queue was rejected: it would put a second inference on the GPU beside the extraction,
which is what the queue exists to prevent. A run that exhausts its tool rounds without answering
also returns 504 with the real trace attached — it is not a server error, it just has no answer on
the end.

## Evidence

### `runtime:` — four probes against a live `next dev`

| Probe | Call | Result |
|---|---|---|
| A | POST with **no token** | **401** `application/json` — the middleware's, not a hand-rolled check |
| B | `{"q":"  "}` / `not json` with token | **400** `q is required` / **400** `body must be JSON` |
| C | the documented curl, **no ollama on this box** | **503** `local model unreachable at http://localhost:11434 (ECONNREFUSED)` (was `500 fetch failed` before the fix above) |
| D | the documented curl, model endpoint stubbed | **200** (below) |

```
$ curl -X POST /api/agent/ask -H "Authorization: Bearer $(cat ~/.openclaw/config/mc-session-token)" \
       -d '{"q":"which nodes are down"}'
{"answer":"All 1 node(s) online: vm (lead, disk 32%).",
 "trace":[{"tool":"get_fleet_state","args":{},"ms":54,"error":null}],
 "rounds":2,
 "usage":{"prompt_tokens":120,"completion_tokens":24,"total_tokens":144}}
```

Everything in that path is real except the model: real middleware and session token, real runtime
module load of `lib/node-agent.mjs`, the real ollama queue (no bypass), real `/api/mesh/nodes`
returning this container's own node. `vm (lead, disk 32%)` is live data, and the trace shows the
tool call it came from. Only `LLM_BASE_URL` pointed at a stub speaking Ollama's native `/api/chat`,
because this container has no ollama — the same substitution 6.2 used and 6.1 recorded.

### `code:` — Mission Control suite 13 files / 149 tests (was 138)

`openclaw-lib.test.ts` (5): candidate order pinned for both layouts — the installed one resolves
`workspace/lib`, two up, not `projects/lib` — the two-candidate shape with no env var, the memo
returning the same module object, a not-found error listing every path tried, and a failed load
staying retryable after the file appears.

`agent-ask.test.ts` (6): the question reaching the loop and the answer coming back with its trace,
the client and providers both actually supplied, the question capped at 2000 chars, the deadline
raising `AskTimeout` naming the queue, the repo-checkout fallback loading the real module, a refused
socket becoming `ModelUnreachable` with the endpoint named, and an ordinary error left alone rather
than blamed on the model.

`npx tsc --noEmit` clean.

### Regression guard — full root suite

2196 tests / 1910 pass / **211 fail** / 7 skipped — identical to the 6.2 run in every number, and the
failure lists diff empty in both directions. This step is Mission Control-only, so the root counts
should not move, and they did not. (The 211 are the container's standing environmental failures: no
NATS, no ollama, no `~/.openclaw` runtime.)

## Left open

- `recall_memory` still answers `{unavailable: "no memory injector configured"}`: wiring the real
  injector needs the knowledge and extraction DB handles, which is its own step rather than a
  side effect of this one.
- No UI. The route is curl-and-script reachable; a Mission Control panel and the voice path through
  Block 3 are separate work.
