# AUDIT_POST — mem.extraction stall RESOLVED (queue item 1)

**Closed:** 2026-07-18 ~16:00 EDT. The pipeline persisted facts again at 19:50:55Z after 45+ hours
frozen (entities MAX(first_seen): 2026-07-16T20:26:15Z → 2026-07-18T19:50:55Z).

## Fix chain (each layer observed, not inferred)

1. **format:json stall** — `useJsonFormat()` in lib/llm-client.mjs: thinking-family models
   (qwen3/deepseek-r1/magistral/gpt-oss) never get the JSON grammar; LLM_FORCE_FREE_FORM=1 stays
   as the global override. The PRE's mechanism needed one correction: the client already sends
   `think:false`, so the stall is grammar-vs-model regardless of the think toggle — A/B on
   identical trivial content: format:json = 5min stall → runner-watchdog kill → "fetch failed";
   free-form = correct entities/decisions in 148s.
2. **Transcript parroting** — first post-fix daemon flush (14:04) still degraded: free-form on a
   tail full of extraction-talk made the model continue the `[role]: …` pattern (err log captured
   it echoing this session's own lines). Fix: JSON-primer assistant turn in
   buildExtractionPrompt({jsonPrimer}) — only on the free-form path (a primer under format:json
   would fight the grammar's fresh `{`) — plus parseWithPrimer() restoring the consumed brace.
   Model/backends that ignore the primer still parse via the tolerant extractor (observed: qwen3
   answered fresh with an empty `<think></think>` preamble + full JSON; parsed fine).
3. **Degraded runner** — generation had collapsed to 1.1 tok/s with the model at 0.6GB VRAM
   (post-watchdog-kill residue). `ollama stop` + fresh load: 19s, 5.3GB VRAM, ~2.5+ tok/s,
   keep_alive 2h pinned manually (expires ~17:33 EDT — NOT a durable setting; ledgered below).
4. **Trigger path proven** — 6 published mesh.memory.extract_request messages all received
   (connz out_msgs delta + receipt lines; the earlier "lost triggers" were this session's own
   broken log-filter, confessed here), coalesced into one flush:
   **`nats-triggered flush [llm]: 9 facts, 9 added, 0 merged`** at 15:52:56 EDT, entities rows
   written at 19:50:55Z.

## Tests
test/llm-client-format.test.mjs — 6 tests: family gating (prefix-anchored), force-free-form
override, primer append/absence, parseWithPrimer brace restoration + echo tolerance. Suites
adjacent (memory-extraction-degradation) stay green.

## Honest limits (ledgered in OUT_OF_SCOPE)
- **Extraction quality on recursive tails**: the verified 9-fact run confabulated (Alice/Bob/
  Kafka narrative seeded by quoted test snippets in the transcript). Wiring is fixed; qwen3:8b
  content quality on sessions-about-extraction is worst-case. Historical normal-content runs
  (Jul 11–16) extracted 17–28 real facts. 4 junk entities now in the store (left to decay).
- **NATS bus flaps**: PROTOCOL_ERR 13:06, AUTHENTICATION_TIMEOUT 14:14, disconnects 13:37/15:45,
  and one unexplained unlogged trigger (13:35). Belongs with the queued NATS work.
- **Runner VRAM degradation pattern**: after watchdog kills, the reloaded model can land mostly
  off-GPU (0.6GB / 1.1 tok/s) and stay there. Recovery = stop + reload. A durable keep_alive in
  the daemon's calls is a RAM-budget tradeoff (5.3GB resident on a 19.5GB box) — operator call.
