# AUDIT_PRE — step 6.3 · `POST /api/agent/ask`

**Opened:** 2026-09-14, Montreal · **Carrier:** `v6.3-pre`

## What the code already settles

**Auth is not this route's problem.** `src/middleware.ts` runs `decide()` on every request and
returns JSON `{error}` with a 4xx for any `/api` path without the session cookie, bearer or query
token. The route inherits that; the 401 the INVENTORY asks for is the middleware's, and the probe
must show it rather than a hand-rolled check.

**Loading a root `lib/*.mjs` from a Next route has one existing answer.** `src/lib/mesh-sign.ts`
imports `lib/operator-auth.mjs` at runtime by file URL with `turbopackIgnore`, trying
`$OPENCLAW_LIB_DIR`, then `<cwd>/../../lib` (installed layout), then `<cwd>/../lib` (repo checkout),
memoizing the promise and clearing it on failure so a fix can be retried. Its own header explains
why: a second TypeScript copy of the signing logic is "the twin-divergence pattern the review traced
the exec bypass to."

That argument applies to the *resolution rule* as much as to the signing: a second copy of the
candidate list would drift the day the install layout changes. So the loader is extracted to
`src/lib/openclaw-lib.ts` and `mesh-sign.ts` is rewritten onto it — not left beside a near-identical
twin. mesh-sign has no test today; the extraction gets one.

**The queue is the real design question.** `createLlmClient().generate()` routes through the ollama
queue as an **extraction** job: long-running, waits to completion, no fallback (`generateAnalysis`
is the one that degrades). That is right for a question an operator is waiting on — a wrong answer
fast is worse than a right answer late — but it means an ask issued while extraction is running
waits behind it, and an HTTP client hanging with no explanation is the worst version of that.

So the route bounds the wait and **names the cause** when it expires, rather than either hanging or
silently bypassing the queue. Bypassing would put a second inference on the GPU beside extraction,
which is exactly what the queue exists to prevent.

## Scope

- `src/lib/openclaw-lib.ts` — `loadOpenclawLib<T>(filename)`, memoized per filename.
- `src/lib/mesh-sign.ts` — rewritten onto it, behaviour unchanged.
- `src/lib/agent-ask.ts` — builds the agent (root module + `createLlmClient`), applies the deadline.
- `src/app/api/agent/ask/route.ts` — `POST {q}` → `{answer, trace, rounds, usage}`.

## Verify

- `runtime:` `curl -X POST /api/agent/ask -d '{"q":"which nodes are down"}'` with the session token
  returns the answer plus a trace naming the tool; the same call without the token returns 401 from
  the middleware.
- `code:` loader tests (explicit env dir, each cwd candidate, a named error listing what was tried,
  memoized once, retryable after failure); route-shape tests (missing `q` rejected, question capped,
  the deadline reported as a timeout naming the queue rather than a generic 500).
