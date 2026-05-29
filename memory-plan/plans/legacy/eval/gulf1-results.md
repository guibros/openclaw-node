# Gulf 1 Evaluation Results

**Date:** 2026-05-22
**Database:** /Users/moltymac/.openclaw/workspace/.knowledge.db
**Queries:** 25
**Top-N per mode:** 5

---

## Aggregate Scores

Fill in after scoring all queries. For each query, relevance scores are 0-2:
- **0** = not relevant (wrong session or wrong part)
- **1** = partially relevant (right session, wrong part)
- **2** = highly relevant (right session and right part)

| Mode | Total Possible | Total Score | Percentage |
|------|---------------|-------------|------------|
| FTS5 | 250 |  |  |
| Semantic | 250 |  |  |
| Hybrid | 250 |  |  |

## Decision

- [ ] Hybrid is **clearly better** than FTS5 on most queries → proceed to Phase 3
- [ ] Hybrid is **marginally better** → consider whether the rest of the plan is justified
- [ ] Hybrid is **no better or worse** → **stop the plan**

---

### q01: How is NATS JetStream configured for local event logging?

**Category:** architecture | **Expected topic:** local-event-log, JetStream R=1 stream, local-events stream

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 81 | assistant | 0.6011 | [assistant] 4 NATS connections, all active with subscriptions. Let me also confi |  |
| 2 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.5982 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |
| 3 | d6607f55-28af-4b85-99c8-f091457c646a | 216 | user | 0.5659 | [user] as it it via nats, does all node will stream at the same place, aka will  |  |
| 4 | 9442bc23-9560-415b-b863-c1936e730d30 | 64 | assistant | 0.5461 | [assistant] NATS connect is timing out from system node. The publisher works bec |  |
| 5 | f535a07c-eb1f-470b-95bc-7497abc49920 | 5 | assistant | 0.5324 | [assistant] No NATS subscriptions in the daemon. Let me check the NATS/mesh patt |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 81 | assistant | 0.016393 | [assistant] 4 NATS connections, all active with subscriptions. Let me also confi |  |
| 2 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.016129 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |
| 3 | d6607f55-28af-4b85-99c8-f091457c646a | 216 | user | 0.015873 | [user] as it it via nats, does all node will stream at the same place, aka will  |  |
| 4 | 9442bc23-9560-415b-b863-c1936e730d30 | 64 | assistant | 0.015625 | [assistant] NATS connect is timing out from system node. The publisher works bec |  |
| 5 | f535a07c-eb1f-470b-95bc-7497abc49920 | 5 | assistant | 0.015385 | [assistant] No NATS subscriptions in the daemon. Let me check the NATS/mesh patt |  |

---

### q02: What happens during memory compaction and how does reload work?

**Category:** memory-lifecycle | **Expected topic:** MemoryBudget.reload, pre-compression flush, compaction

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 37 | assistant | 0.5099 | [assistant] Running, new PID 39569. From now on, any edit to `memory-daemon.mjs` |  |
| 2 | 2bbff7ef-ca3a-4f07-94de-6e611320858c | 0 | user | 0.4947 | [user] Pre-compaction memory flush. Store durable memories now (use memory/2026- |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 112 | assistant | 0.4534 | [assistant] **Step 6: Consolidation pass** — add check #11 to `memory-maintenanc |  |
| 4 | b530ac03-39df-4b9c-b004-199766e79b45 | 29 | assistant | 0.453 | [assistant] The Claude Code adapter is `bin/auto-checkpoint` — a 40-line bash sc |  |
| 5 | b3114595-1889-43d2-a348-40b744c67e9e | 41 | assistant | 0.4392 | [assistant] Session resumed. Context was compacted — caught up via the continuat |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 37 | assistant | 0.016393 | [assistant] Running, new PID 39569. From now on, any edit to `memory-daemon.mjs` |  |
| 2 | 2bbff7ef-ca3a-4f07-94de-6e611320858c | 0 | user | 0.016129 | [user] Pre-compaction memory flush. Store durable memories now (use memory/2026- |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 112 | assistant | 0.015873 | [assistant] **Step 6: Consolidation pass** — add check #11 to `memory-maintenanc |  |
| 4 | b530ac03-39df-4b9c-b004-199766e79b45 | 29 | assistant | 0.015625 | [assistant] The Claude Code adapter is `bin/auto-checkpoint` — a 40-line bash sc |  |
| 5 | b3114595-1889-43d2-a348-40b744c67e9e | 41 | assistant | 0.015385 | [assistant] Session resumed. Context was compacted — caught up via the continuat |  |

---

### q03: How does the daemon state file work and why was it renamed?

**Category:** architecture-decision | **Expected topic:** companion-state collision, daemon-state-NODE_ID, migration

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 22c63342-4fea-46c2-87ed-d2b928bd296a | 31 | assistant | 0.5246 | [assistant] The daemon is registered and running. The `-` PID for memory-daemon  |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 11 | assistant | 0.5218 | [assistant] I notice the daemon log shows state transitions (`State: ENDED → BOO |  |
| 3 | b530ac03-39df-4b9c-b004-199766e79b45 | 41 | assistant | 0.5144 | [assistant] ---  ### SUMMARY — The Whole Thing In One Sentence  A launchd daemon |  |
| 4 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 69 | assistant | 0.502 | [assistant] Good, both files look solid. Let me test the daemon now — start it,  |  |
| 5 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 3 | assistant | 0.4733 | [assistant] **What it should be:** The daemon should **poll for its own signals* |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 22c63342-4fea-46c2-87ed-d2b928bd296a | 31 | assistant | 0.016393 | [assistant] The daemon is registered and running. The `-` PID for memory-daemon  |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 11 | assistant | 0.016129 | [assistant] I notice the daemon log shows state transitions (`State: ENDED → BOO |  |
| 3 | b530ac03-39df-4b9c-b004-199766e79b45 | 41 | assistant | 0.015873 | [assistant] ---  ### SUMMARY — The Whole Thing In One Sentence  A launchd daemon |  |
| 4 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 69 | assistant | 0.015625 | [assistant] Good, both files look solid. Let me test the daemon now — start it,  |  |
| 5 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 3 | assistant | 0.015385 | [assistant] **What it should be:** The daemon should **poll for its own signals* |  |

---

### q04: What embedding model is used and what are its dimensions?

**Category:** semantic-layer | **Expected topic:** Xenova/all-MiniLM-L6-v2, 384-dim, mcp-knowledge

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 41 | assistant | 0.3312 | [assistant] `all-MiniLM-L6-v2` has a 256 token context. Let me also ensure we ha |  |
| 2 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 60 | assistant | 0.2924 | [assistant] **Architecture (the agent's playground):** - GPT with configurable d |  |
| 3 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 34 | assistant | 0.2861 | [assistant] _🌐 Searching: Nyk @nyk_builderz "The Harness Is The Product. The Mo |  |
| 4 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 3 | assistant | 0.2806 | [assistant] Good context. Mission Control already has a 3D knowledge graph and a |  |
| 5 | 945d6f83-407f-4f9f-9e13-1997686b7291 | 2 | assistant | 0.2778 | [assistant] X won't render without JS, but Google Research dropped two things to |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 41 | assistant | 0.016393 | [assistant] `all-MiniLM-L6-v2` has a 256 token context. Let me also ensure we ha |  |
| 2 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 60 | assistant | 0.016129 | [assistant] **Architecture (the agent's playground):** - GPT with configurable d |  |
| 3 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 34 | assistant | 0.015873 | [assistant] _🌐 Searching: Nyk @nyk_builderz "The Harness Is The Product. The Mo |  |
| 4 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 3 | assistant | 0.015625 | [assistant] Good context. Mission Control already has a 3D knowledge graph and a |  |
| 5 | 945d6f83-407f-4f9f-9e13-1997686b7291 | 2 | assistant | 0.015385 | [assistant] X won't render without JS, but Google Research dropped two things to |  |

---

### q05: How does fact extraction work from session messages?

**Category:** extraction | **Expected topic:** extractFacts, pre-compression-flush, regex patterns, speaker field

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 136 | assistant | 0.4494 | [assistant] Zero facts in the DB — the extraction pipeline hasn't been triggered |  |
| 2 | 68a885e4-27ec-4811-a44d-6a4a66370dd8 | 3 | user | 0.4445 | [user] Each entry includes a "Bingo Factor" mapping these historical mechanisms  |  |
| 3 | 11edd5ea-ba95-451e-83dc-9e6e895aa3c5 | 59 | user | 0.4312 | [user] The Meta-Point Anthropic built the exact architecture OpenClaw is buildin |  |
| 4 | 11edd5ea-ba95-451e-83dc-9e6e895aa3c5 | 58 | user | 0.4312 | [user] The Meta-Point Anthropic built the exact architecture OpenClaw is buildin |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.4209 | [assistant] First, let me check how many facts are already in the DB and backfil |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 136 | assistant | 0.016393 | [assistant] Zero facts in the DB — the extraction pipeline hasn't been triggered |  |
| 2 | 68a885e4-27ec-4811-a44d-6a4a66370dd8 | 3 | user | 0.016129 | [user] Each entry includes a "Bingo Factor" mapping these historical mechanisms  |  |
| 3 | 11edd5ea-ba95-451e-83dc-9e6e895aa3c5 | 59 | user | 0.015873 | [user] The Meta-Point Anthropic built the exact architecture OpenClaw is buildin |  |
| 4 | 11edd5ea-ba95-451e-83dc-9e6e895aa3c5 | 58 | user | 0.015625 | [user] The Meta-Point Anthropic built the exact architecture OpenClaw is buildin |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.015385 | [assistant] First, let me check how many facts are already in the DB and backfil |  |

---

### q06: How are session turns chunked and indexed for search?

**Category:** semantic-layer | **Expected topic:** chunkSessionTurns, indexSessionTurns, session_chunks table

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 189 | assistant | 0.4475 | [assistant] With the additions (content hashing, recursive chunk splitting, resp |  |
| 2 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 14 | assistant | 0.4475 | [assistant] With the additions (content hashing, recursive chunk splitting, resp |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.4444 | [assistant] ### P4: Structured Tool-Call Indexing **Source inspiration**: Claude |  |
| 4 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 47 | assistant | 0.4443 | [assistant] 1. **Get chunk embeddings** (L418-431): Fetch all chunk vectors for  |  |
| 5 | 3116ae78-04ab-4998-9e89-7146032ee7b5 | 5 | user | 0.4355 | [user] 1. Pre-Compression Memory Flush (lib/pre-compression-flush.mjs) shouldFlu |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 189 | assistant | 0.016393 | [assistant] With the additions (content hashing, recursive chunk splitting, resp |  |
| 2 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 14 | assistant | 0.016129 | [assistant] With the additions (content hashing, recursive chunk splitting, resp |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.015873 | [assistant] ### P4: Structured Tool-Call Indexing **Source inspiration**: Claude |  |
| 4 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 47 | assistant | 0.015625 | [assistant] 1. **Get chunk embeddings** (L418-431): Fetch all chunk vectors for  |  |
| 5 | 3116ae78-04ab-4998-9e89-7146032ee7b5 | 5 | user | 0.015385 | [user] 1. Pre-Compression Memory Flush (lib/pre-compression-flush.mjs) shouldFlu |  |

---

### q07: What is the content-addressed artifact store and how does hashing work?

**Category:** infrastructure | **Expected topic:** lib/artifacts.mjs, SHA-256, sharded path, meta.json sidecar

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 60 | assistant | 0.438 | [assistant] ### 5. Content Hashing — `hashContent()` (line 221)  ```js SHA-256(f |  |
| 2 | 5b1c44ae-01b9-40d8-8b18-a785d2b91ec4 | 3 | toolResult | 0.4337 | [toolResult] - **Element**: User-added `X-No-Archive: Yes` requested exclusion f |  |
| 3 | 53517fbc-5301-43fa-9cb2-ffe01f385959 | 14 | assistant | 0.4201 | [assistant] Done — I appended a new **Batch 20R** section to:  `projects/arcane/ |  |
| 4 | b3114595-1889-43d2-a348-40b744c67e9e | 4 | assistant | 0.4166 | [assistant] Clean separation. Three layers:  **1. Private memory (per-node, neve |  |
| 5 | d20c7b22-8d31-4da1-b19e-a5d753c0ad10 | 17 | toolResult | 0.4058 | [toolResult] ### [07] DEJA NEWS INDEXING: EPHEMERAL TALK -> PERMANENT SEARCH ART |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 60 | assistant | 0.016393 | [assistant] ### 5. Content Hashing — `hashContent()` (line 221)  ```js SHA-256(f |  |
| 2 | 5b1c44ae-01b9-40d8-8b18-a785d2b91ec4 | 3 | toolResult | 0.016129 | [toolResult] - **Element**: User-added `X-No-Archive: Yes` requested exclusion f |  |
| 3 | 53517fbc-5301-43fa-9cb2-ffe01f385959 | 14 | assistant | 0.015873 | [assistant] Done — I appended a new **Batch 20R** section to:  `projects/arcane/ |  |
| 4 | b3114595-1889-43d2-a348-40b744c67e9e | 4 | assistant | 0.015625 | [assistant] Clean separation. Three layers:  **1. Private memory (per-node, neve |  |
| 5 | d20c7b22-8d31-4da1-b19e-a5d753c0ad10 | 17 | toolResult | 0.015385 | [toolResult] ### [07] DEJA NEWS INDEXING: EPHEMERAL TALK -> PERMANENT SEARCH ART |  |

---

### q08: How does the shared JetStream stream differ from the local one?

**Category:** federation | **Expected topic:** OPENCLAW_SHARED, R=3 vs R=1, shared-event-stream, 7 subject patterns

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 81 | assistant | 0.5284 | [assistant] 4 NATS connections, all active with subscriptions. Let me also confi |  |
| 2 | 61a8e162-269e-4c07-960c-c5ea44fba075 | 52 | user | 0.4883 | [user] The core insight: NATS + JetStream + SQLite per node gives you everything |  |
| 3 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 79 | assistant | 0.4814 | [assistant] JetStream is running fine — 2 streams, 32 messages, 0 errors, 30KB s |  |
| 4 | 2e16b25f-3c65-4a43-a162-30fcece40c7e | 68 | assistant | 0.4272 | [assistant] I'd go reconciliation first. It fixes both #2 and #10 with one routi |  |
| 5 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.3987 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 81 | assistant | 0.016393 | [assistant] 4 NATS connections, all active with subscriptions. Let me also confi |  |
| 2 | 61a8e162-269e-4c07-960c-c5ea44fba075 | 52 | user | 0.016129 | [user] The core insight: NATS + JetStream + SQLite per node gives you everything |  |
| 3 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 79 | assistant | 0.015873 | [assistant] JetStream is running fine — 2 streams, 32 messages, 0 errors, 30KB s |  |
| 4 | 2e16b25f-3c65-4a43-a162-30fcece40c7e | 68 | assistant | 0.015625 | [assistant] I'd go reconciliation first. It fixes both #2 and #10 with one routi |  |
| 5 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.015385 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |

---

### q09: What event schemas exist and how are they validated?

**Category:** schema | **Expected topic:** packages/event-schemas, Zod, discriminated union, 8 memory events

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d6607f55-28af-4b85-99c8-f091457c646a | 308 | assistant | 0.4569 | [assistant] Multiple references to `event.status` across all components. Need to |  |
| 2 | 273d8b89-3277-464b-8f28-662154d00228 | 2 | toolResult | 0.4244 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |
| 3 | 31e00c52-3876-4ab6-97d3-d4b3a9061bdd | 2 | toolResult | 0.4244 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |
| 4 | fa45e03f-294e-4221-847d-7d50946fb12a | 2 | toolResult | 0.4244 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |
| 5 | 465cae92-5e45-4416-994e-f378ffef8c57 | 37 | toolResult | 0.4244 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d6607f55-28af-4b85-99c8-f091457c646a | 308 | assistant | 0.016393 | [assistant] Multiple references to `event.status` across all components. Need to |  |
| 2 | 273d8b89-3277-464b-8f28-662154d00228 | 2 | toolResult | 0.016129 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |
| 3 | 31e00c52-3876-4ab6-97d3-d4b3a9061bdd | 2 | toolResult | 0.015873 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |
| 4 | fa45e03f-294e-4221-847d-7d50946fb12a | 2 | toolResult | 0.015625 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |
| 5 | 465cae92-5e45-4416-994e-f378ffef8c57 | 37 | toolResult | 0.015385 | [toolResult] ### 10. Society for Psychical Research (**SPR**) as Occult QA Lab ( |  |

---

### q10: How does the merge facts function handle duplicate entries?

**Category:** extraction | **Expected topic:** mergeFacts, supersedes comment model, similarity threshold 0.7-0.9

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.5021 | [assistant] ### P2: Memory Consolidation **Source inspiration**: LangMem **What  |  |
| 2 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 41 | assistant | 0.4475 | [assistant] The merge result with `conflict: true` is already handled — `keepBra |  |
| 3 | 29c20a2c-e677-40a0-9576-66b95185ec5d | 54 | assistant | 0.4143 | [assistant] Two duplicates — 14 appears twice. Let me fix the remaining steps. |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.4109 | [assistant] First, let me check how many facts are already in the DB and backfil |  |
| 5 | d6607f55-28af-4b85-99c8-f091457c646a | 147 | user | 0.3807 | [user] The superseding logic (line 86) uses token Jaccard >= 0.6 **plus** shared |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.016393 | [assistant] ### P2: Memory Consolidation **Source inspiration**: LangMem **What  |  |
| 2 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 41 | assistant | 0.016129 | [assistant] The merge result with `conflict: true` is already handled — `keepBra |  |
| 3 | 29c20a2c-e677-40a0-9576-66b95185ec5d | 54 | assistant | 0.015873 | [assistant] Two duplicates — 14 appears twice. Let me fix the remaining steps. |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.015625 | [assistant] First, let me check how many facts are already in the DB and backfil |  |
| 5 | d6607f55-28af-4b85-99c8-f091457c646a | 147 | user | 0.015385 | [user] The superseding logic (line 86) uses token Jaccard >= 0.6 **plus** shared |  |

---

### q11: What is dual-write shadow mode for the event log?

**Category:** architecture-decision | **Expected topic:** local-event-log, fire-and-forget publishing, MEMORY.md still primary

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 16 | assistant | 0.4572 | [assistant] There it is. The daily-log-writer:  1. **Is wired into the daemon**  |  |
| 2 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 24 | user | 0.4233 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |
| 3 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 31 | user | 0.4233 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |
| 4 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 74 | user | 0.4233 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |
| 5 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 334 | user | 0.4233 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 16 | assistant | 0.016393 | [assistant] There it is. The daily-log-writer:  1. **Is wired into the daemon**  |  |
| 2 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 24 | user | 0.016129 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |
| 3 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 31 | user | 0.015873 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |
| 4 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 74 | user | 0.015625 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |
| 5 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 334 | user | 0.015385 | [user] Keep it concise (<1000 chars per entry). Only log substantive events — sk |  |

---

### q12: How does the session store database work?

**Category:** infrastructure | **Expected topic:** state.db, session-store, better-sqlite3, messages table

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 38 | assistant | 0.461 | [assistant] **session-store: imported 189 sessions** — it's working. No errors.  |  |
| 2 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.4474 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 3 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 11 | assistant | 0.4278 | [assistant] You're right — the session recap only has Mar 29 sessions, which mea |  |
| 4 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 36 | assistant | 0.4171 | [assistant] Now restart the daemon one more time to verify session-store loads: |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.4099 | [assistant] ``` Session N:   P0 — Knowledge graph (entities + relations tables,  |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 38 | assistant | 0.016393 | [assistant] **session-store: imported 189 sessions** — it's working. No errors.  |  |
| 2 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.016129 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 3 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 11 | assistant | 0.015873 | [assistant] You're right — the session recap only has Mar 29 sessions, which mea |  |
| 4 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 36 | assistant | 0.015625 | [assistant] Now restart the daemon one more time to verify session-store loads: |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.015385 | [assistant] ``` Session N:   P0 — Knowledge graph (entities + relations tables,  |  |

---

### q13: What files were deleted as dead artifacts and why?

**Category:** cleanup | **Expected topic:** pre-compact-state, session-fingerprint, frontend-activity, confidence field

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 02f36480-cf78-42b3-a0a4-68090e41a951 | 51 | toolResult | 0.5135 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 2 | e2146b3c-1b75-44df-81f6-b853f9b642d7 | 2 | toolResult | 0.5094 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 3 | 435dc0f2-4b5e-4434-aaa2-2d3ad1e6350f | 2 | toolResult | 0.5094 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 4 | 6b5fce78-be05-4e8c-8002-66081e136712 | 12 | toolResult | 0.5094 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 5 | eb5f6a13-71ac-4903-b81b-d5bf1ab89245 | 4 | toolResult | 0.5094 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 02f36480-cf78-42b3-a0a4-68090e41a951 | 51 | toolResult | 0.016393 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 2 | e2146b3c-1b75-44df-81f6-b853f9b642d7 | 2 | toolResult | 0.016129 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 3 | 435dc0f2-4b5e-4434-aaa2-2d3ad1e6350f | 2 | toolResult | 0.015873 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 4 | 6b5fce78-be05-4e8c-8002-66081e136712 | 12 | toolResult | 0.015625 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |
| 5 | eb5f6a13-71ac-4903-b81b-d5bf1ab89245 | 4 | toolResult | 0.015385 | [toolResult] ### [09] WAYBACK MACHINE AS HAUNTOLOGICAL DEBUGGER - **Element**: S |  |

---

### q14: How does the daily log writer generate activity summaries?

**Category:** memory-lifecycle | **Expected topic:** daily-log-writer.mjs, workspace memory files, session recap

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 16 | assistant | 0.535 | [assistant] There it is. The daily-log-writer:  1. **Is wired into the daemon**  |  |
| 2 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 40 | assistant | 0.5036 | [assistant] Now write the daily log. |  |
| 3 | de15883f-a4c2-42a5-8148-1073414d6012 | 28 | assistant | 0.4985 | [assistant] I'll add a `lastDailyLogTurn` field to track when we last triggered  |  |
| 4 | ae062003-427e-4317-8d5a-4c2f642807b8 | 10 | user | 0.4984 | [user] Sender (untrusted metadata): ```json {   "label": "openclaw-tui (gateway- |  |
| 5 | ae062003-427e-4317-8d5a-4c2f642807b8 | 20 | assistant | 0.4922 | [assistant] Yes. Exactly. The recap system already does this. Every 10 minutes i |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 16 | assistant | 0.016393 | [assistant] There it is. The daily-log-writer:  1. **Is wired into the daemon**  |  |
| 2 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 40 | assistant | 0.016129 | [assistant] Now write the daily log. |  |
| 3 | de15883f-a4c2-42a5-8148-1073414d6012 | 28 | assistant | 0.015873 | [assistant] I'll add a `lastDailyLogTurn` field to track when we last triggered  |  |
| 4 | ae062003-427e-4317-8d5a-4c2f642807b8 | 10 | user | 0.015625 | [user] Sender (untrusted metadata): ```json {   "label": "openclaw-tui (gateway- |  |
| 5 | ae062003-427e-4317-8d5a-4c2f642807b8 | 20 | assistant | 0.015385 | [assistant] Yes. Exactly. The recap system already does this. Every 10 minutes i |  |

---

### q15: What is reciprocal rank fusion and how is it used for hybrid search?

**Category:** search | **Expected topic:** reciprocalRankFusion, k=60, FTS5 + semantic, chunk_id dedup

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 235 | assistant | 0.3498 | [assistant] **Circling:** Role diversity within same model class. Worker and Rev |  |
| 2 | 1913d946-8574-4ede-bde8-fd8b354b0cf0 | 9 | assistant | 0.3474 | [assistant] ## /last30days — Community Intelligence Aggregator  Claude Code skil |  |
| 3 | 1b6044f7-baaa-479a-903d-da7dcab581e0 | 8 | assistant | 0.3463 | [assistant] Got the full picture on both. Here's the structural comparison:  --- |  |
| 4 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 215 | assistant | 0.3304 | [assistant] _🔧 WebFetch_  _🔧 WebFetch_  ## /last30days — Community Intelligenc |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 159 | user | 0.3299 | [user] 2. Key Technical Concepts:    - **Knowledge Graph**: SQLite-based entity- |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 235 | assistant | 0.016393 | [assistant] **Circling:** Role diversity within same model class. Worker and Rev |  |
| 2 | 1913d946-8574-4ede-bde8-fd8b354b0cf0 | 9 | assistant | 0.016129 | [assistant] ## /last30days — Community Intelligence Aggregator  Claude Code skil |  |
| 3 | 1b6044f7-baaa-479a-903d-da7dcab581e0 | 8 | assistant | 0.015873 | [assistant] Got the full picture on both. Here's the structural comparison:  --- |  |
| 4 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 215 | assistant | 0.015625 | [assistant] _🔧 WebFetch_  _🔧 WebFetch_  ## /last30days — Community Intelligenc |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 159 | user | 0.015385 | [user] 2. Key Technical Concepts:    - **Knowledge Graph**: SQLite-based entity- |  |

---

### q16: How does the FTS5 virtual table stay in sync with session chunks?

**Category:** search | **Expected topic:** external content mode, INSERT/DELETE triggers, one-time rebuild

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 2e16b25f-3c65-4a43-a162-30fcece40c7e | 53 | user | 0.3981 | [user] This session is being continued from a previous conversation that ran out |  |
| 2 | d51f2b6b-53c1-4482-b39f-3e91aca89d5b | 127 | user | 0.3933 | [user] This session is being continued from a previous conversation that ran out |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 40 | user | 0.3749 | [user] This session is being continued from a previous conversation that ran out |  |
| 4 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 8 | assistant | 0.3717 | [assistant] Here's the full technical breakdown of how the collaborative system  |  |
| 5 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 14 | user | 0.37 | [user] This session is being continued from a previous conversation that ran out |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 2e16b25f-3c65-4a43-a162-30fcece40c7e | 53 | user | 0.016393 | [user] This session is being continued from a previous conversation that ran out |  |
| 2 | d51f2b6b-53c1-4482-b39f-3e91aca89d5b | 127 | user | 0.016129 | [user] This session is being continued from a previous conversation that ran out |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 40 | user | 0.015873 | [user] This session is being continued from a previous conversation that ran out |  |
| 4 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 8 | assistant | 0.015625 | [assistant] Here's the full technical breakdown of how the collaborative system  |  |
| 5 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 14 | user | 0.015385 | [user] This session is being continued from a previous conversation that ran out |  |

---

### q17: What is the NODE_ID convention across shell and JavaScript files?

**Category:** infrastructure | **Expected topic:** OPENCLAW_NODE_ID, os.hostname, consistent derivation

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 9442bc23-9560-415b-b863-c1936e730d30 | 89 | assistant | 0.4166 | [assistant] Zero hostname references in JS/TS. Let me check shell scripts too: |  |
| 2 | d6607f55-28af-4b85-99c8-f091457c646a | 205 | assistant | 0.4065 | [assistant] So `cli.js` is the `npx openclaw-node-harness` entry point, but it's |  |
| 3 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 31 | user | 0.3882 | [user] Sender (untrusted metadata): ```json {   "label": "openclaw-tui (gateway- |  |
| 4 | ae711e37-421a-4439-8605-debb2dadc945 | 45 | assistant | 0.3809 | [assistant] It's an ESM/CJS conflict. The file uses `import` but Node isn't trea |  |
| 5 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 29 | user | 0.3717 | [user] Conversation info (untrusted metadata): ```json {   "message_id": "3f67f9 |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 9442bc23-9560-415b-b863-c1936e730d30 | 89 | assistant | 0.016393 | [assistant] Zero hostname references in JS/TS. Let me check shell scripts too: |  |
| 2 | d6607f55-28af-4b85-99c8-f091457c646a | 205 | assistant | 0.016129 | [assistant] So `cli.js` is the `npx openclaw-node-harness` entry point, but it's |  |
| 3 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 31 | user | 0.015873 | [user] Sender (untrusted metadata): ```json {   "label": "openclaw-tui (gateway- |  |
| 4 | ae711e37-421a-4439-8605-debb2dadc945 | 45 | assistant | 0.015625 | [assistant] It's an ESM/CJS conflict. The file uses `import` but Node isn't trea |  |
| 5 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 29 | user | 0.015385 | [user] Conversation info (untrusted metadata): ```json {   "message_id": "3f67f9 |  |

---

### q18: How does the migration script for embedding existing sessions work?

**Category:** semantic-layer | **Expected topic:** embed-existing-sessions, checkpoint file, crash resumability, SIGINT

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b530ac03-39df-4b9c-b004-199766e79b45 | 16 | assistant | 0.493 | [assistant] ✅ Migration done. Scripts now derive paths from their location, not  |  |
| 2 | b530ac03-39df-4b9c-b004-199766e79b45 | 38 | user | 0.4854 | [user] This session is being continued from a previous conversation that ran out |  |
| 3 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 38 | assistant | 0.4604 | [assistant] **session-store: imported 189 sessions** — it's working. No errors.  |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 39 | user | 0.3962 | [user] Summary: 1. Primary Request and Intent:    The user ("Gui") asked to pick |  |
| 5 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 323 | assistant | 0.388 | [assistant] Only 1 entry — and it's from a different test entirely (timestamp 17 |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b530ac03-39df-4b9c-b004-199766e79b45 | 16 | assistant | 0.016393 | [assistant] ✅ Migration done. Scripts now derive paths from their location, not  |  |
| 2 | b530ac03-39df-4b9c-b004-199766e79b45 | 38 | user | 0.016129 | [user] This session is being continued from a previous conversation that ran out |  |
| 3 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 38 | assistant | 0.015873 | [assistant] **session-store: imported 189 sessions** — it's working. No errors.  |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 39 | user | 0.015625 | [user] Summary: 1. Primary Request and Intent:    The user ("Gui") asked to pick |  |
| 5 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 323 | assistant | 0.015385 | [assistant] Only 1 entry — and it's from a different test entirely (timestamp 17 |  |

---

### q19: What truncation strategy is used for extracted facts?

**Category:** extraction | **Expected topic:** truncateAtWord, 120 char limit, word boundary, 0.7 fallback threshold

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.4014 | [assistant] First, let me check how many facts are already in the DB and backfil |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 136 | assistant | 0.4008 | [assistant] Zero facts in the DB — the extraction pipeline hasn't been triggered |  |
| 3 | 68a885e4-27ec-4811-a44d-6a4a66370dd8 | 2 | assistant | 0.4002 | [assistant] <final>Researching 10 esoteric elements from the Renaissance and Age |  |
| 4 | b61580f4-669e-4f7f-aa98-b585a6fb2265 | 16 | assistant | 0.3944 | [assistant] Completed. I researched and added a 10-item “Bingo/WTF” set for:  Ge |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.3722 | [assistant] ### P2: Memory Consolidation **Source inspiration**: LangMem **What  |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.016393 | [assistant] First, let me check how many facts are already in the DB and backfil |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 136 | assistant | 0.016129 | [assistant] Zero facts in the DB — the extraction pipeline hasn't been triggered |  |
| 3 | 68a885e4-27ec-4811-a44d-6a4a66370dd8 | 2 | assistant | 0.015873 | [assistant] <final>Researching 10 esoteric elements from the Renaissance and Age |  |
| 4 | b61580f4-669e-4f7f-aa98-b585a6fb2265 | 16 | assistant | 0.015625 | [assistant] Completed. I researched and added a 10-item “Bingo/WTF” set for:  Ge |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.015385 | [assistant] ### P2: Memory Consolidation **Source inspiration**: LangMem **What  |  |

---

### q20: How does the mcp-knowledge server handle workspace file indexing?

**Category:** semantic-layer | **Expected topic:** indexWorkspace, polling, markdown chunking, document hashing

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 188 | user | 0.5852 | [user] **Fix:** Don't use chokidar. Use the same mtime polling pattern as everyt |  |
| 2 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 13 | user | 0.5852 | [user] **Fix:** Don't use chokidar. Use the same mtime polling pattern as everyt |  |
| 3 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 59 | assistant | 0.5607 | [assistant] ## `@openclaw/mcp-knowledge` — Full System Walkthrough  ### What it  |  |
| 4 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 42 | assistant | 0.5598 | [assistant] Now update the ObsidianReader to also handle non-indexed workspace f |  |
| 5 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 36 | assistant | 0.5236 | [assistant] Now the big UI overhaul — add a workspace file API endpoint for read |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 188 | user | 0.016393 | [user] **Fix:** Don't use chokidar. Use the same mtime polling pattern as everyt |  |
| 2 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 13 | user | 0.016129 | [user] **Fix:** Don't use chokidar. Use the same mtime polling pattern as everyt |  |
| 3 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 59 | assistant | 0.015873 | [assistant] ## `@openclaw/mcp-knowledge` — Full System Walkthrough  ### What it  |  |
| 4 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 42 | assistant | 0.015625 | [assistant] Now update the ObsidianReader to also handle non-indexed workspace f |  |
| 5 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 36 | assistant | 0.015385 | [assistant] Now the big UI overhaul — add a workspace file API endpoint for read |  |

---

### q21: What is the MEMORY.md file format and how is it structured?

**Category:** memory-lifecycle | **Expected topic:** working memory, sections, budget, rendered output

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b3eda774-7249-40ac-9c84-d1c7be27a014 | 13 | assistant | 15.706563 | [assistant] Here's a deep dive, section by section.  ## The Core Question  Prose |  |
| 2 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 38 | user | 7.335631 | [user] [Mon 2026-03-16 16:58 GMT-5] so this is basically what s been missing out |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b3114595-1889-43d2-a348-40b744c67e9e | 10 | assistant | 0.5717 | [assistant] ### What This Means for the Meta Protocol  Before you can enforce me |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 40 | assistant | 0.5309 | [assistant] Continuing the ARCHITECTURE.md update. Let me read the current state |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 40 | user | 0.4874 | [user]    - **memory/predictions.md** (REWRITTEN)      - All 3 predictions close |  |
| 4 | 2bbff7ef-ca3a-4f07-94de-6e611320858c | 0 | user | 0.4743 | [user] Pre-compaction memory flush. Store durable memories now (use memory/2026- |  |
| 5 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 164 | user | 0.4583 | [user] <file name="787fc083-d1c4-42ef-ab86-1f3ff7c98608.txt" mime="text/plain">  |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b3114595-1889-43d2-a348-40b744c67e9e | 10 | assistant | 0.016393 | [assistant] ### What This Means for the Meta Protocol  Before you can enforce me |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 40 | assistant | 0.016129 | [assistant] Continuing the ARCHITECTURE.md update. Let me read the current state |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 40 | user | 0.015873 | [user]    - **memory/predictions.md** (REWRITTEN)      - All 3 predictions close |  |
| 4 | 2bbff7ef-ca3a-4f07-94de-6e611320858c | 0 | user | 0.015625 | [user] Pre-compaction memory flush. Store durable memories now (use memory/2026- |  |
| 5 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 164 | user | 0.015385 | [user] <file name="787fc083-d1c4-42ef-ab86-1f3ff7c98608.txt" mime="text/plain">  |  |

---

### q22: How are assistant-role messages handled differently from user messages?

**Category:** extraction | **Expected topic:** role filter, agent_action patterns, finding patterns, speaker field

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 4a6c3f29-67a4-497e-a70c-04ee9fe25a33 | 10 | assistant | 0.5921 | [assistant] Yeah, I can read messages here in #général. What's on your mind? |  |
| 2 | 56db18ab-84db-4062-836d-b726ceeedab5 | 19 | assistant | 0.5921 | [assistant] Yeah, I can read messages here in #général. What's on your mind? |  |
| 3 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 30 | assistant | 0.584 | [assistant] Let me trace how they get from JSON to your messages. |  |
| 4 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 73 | assistant | 0.5681 | [assistant] No new user message — just stale agent notifications and file change |  |
| 5 | 6121e967-d752-4927-85f7-41d0a251969c | 47 | assistant | 0.5485 | [assistant] Agents are stuck. Let me check what's happening by messaging agent-a |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 4a6c3f29-67a4-497e-a70c-04ee9fe25a33 | 10 | assistant | 0.016393 | [assistant] Yeah, I can read messages here in #général. What's on your mind? |  |
| 2 | 56db18ab-84db-4062-836d-b726ceeedab5 | 19 | assistant | 0.016129 | [assistant] Yeah, I can read messages here in #général. What's on your mind? |  |
| 3 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 30 | assistant | 0.015873 | [assistant] Let me trace how they get from JSON to your messages. |  |
| 4 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 73 | assistant | 0.015625 | [assistant] No new user message — just stale agent notifications and file change |  |
| 5 | 6121e967-d752-4927-85f7-41d0a251969c | 47 | assistant | 0.015385 | [assistant] Agents are stuck. Let me check what's happening by messaging agent-a |  |

---

### q23: What idempotency mechanisms prevent duplicate data?

**Category:** infrastructure | **Expected topic:** content hash, idempotency_key, msgID dedup, indexSessionTurns skip

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.3846 | [assistant] ### P2: Memory Consolidation **Source inspiration**: LangMem **What  |  |
| 2 | 29c20a2c-e677-40a0-9576-66b95185ec5d | 54 | assistant | 0.3773 | [assistant] Two duplicates — 14 appears twice. Let me fix the remaining steps. |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 3 | user | 0.3737 | [user] Conversation info (untrusted metadata): ```json {   "message_id": "147839 |  |
| 4 | d6607f55-28af-4b85-99c8-f091457c646a | 147 | user | 0.3607 | [user] ### MEDIUM: Double-dispatch possible on concurrent `schedulerTick()` call |  |
| 5 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 144 | user | 0.3491 | [user] json {   "message_id": "1483915763093082223",   "sender_id": "76142511068 |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 86 | assistant | 0.016393 | [assistant] ### P2: Memory Consolidation **Source inspiration**: LangMem **What  |  |
| 2 | 29c20a2c-e677-40a0-9576-66b95185ec5d | 54 | assistant | 0.016129 | [assistant] Two duplicates — 14 appears twice. Let me fix the remaining steps. |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 3 | user | 0.015873 | [user] Conversation info (untrusted metadata): ```json {   "message_id": "147839 |  |
| 4 | d6607f55-28af-4b85-99c8-f091457c646a | 147 | user | 0.015625 | [user] ### MEDIUM: Double-dispatch possible on concurrent `schedulerTick()` call |  |
| 5 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 144 | user | 0.015385 | [user] json {   "message_id": "1483915763093082223",   "sender_id": "76142511068 |  |

---

### q24: How does the session-start hook initialize a new session?

**Category:** memory-lifecycle | **Expected topic:** session-start.sh, daemon state read, environment setup

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | de15883f-a4c2-42a5-8148-1073414d6012 | 29 | assistant | 0.5271 | [assistant] Now initialize it in the session creation. |  |
| 2 | 50aac400-1738-416b-8e13-b707d1bdb137 | 1 | assistant | 0.4696 | [assistant] Initial Session Greeting |  |
| 3 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.4612 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 4 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 323 | assistant | 0.4463 | [assistant] Only 1 entry — and it's from a different test entirely (timestamp 17 |  |
| 5 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 36 | assistant | 0.4404 | [assistant] Now restart the daemon one more time to verify session-store loads: |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | de15883f-a4c2-42a5-8148-1073414d6012 | 29 | assistant | 0.016393 | [assistant] Now initialize it in the session creation. |  |
| 2 | 50aac400-1738-416b-8e13-b707d1bdb137 | 1 | assistant | 0.016129 | [assistant] Initial Session Greeting |  |
| 3 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.015873 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 4 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 323 | assistant | 0.015625 | [assistant] Only 1 entry — and it's from a different test entirely (timestamp 17 |  |
| 5 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 36 | assistant | 0.015385 | [assistant] Now restart the daemon one more time to verify session-store loads: |  |

---

### q25: What is the promotion policy for sharing local knowledge to the cluster?

**Category:** federation | **Expected topic:** Block 4 future work, promoter, subscriber, provenance fields

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| — | — | — | — | — | (no results) |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 21 | assistant | 0.3679 | [assistant] Now the page and sidebar. Let me also add an "add member" dialog — I |  |
| 2 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 34 | assistant | 0.364 | [assistant] Operator intervenes → POST /api/cowork/intervene   → Direct write to |  |
| 3 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 3 | user | 0.3532 | [user] Sender (untrusted metadata): ```json {   "label": "openclaw-tui (gateway- |  |
| 4 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 107 | assistant | 0.3489 | [assistant] **No.** Keep yours.  Their breadth is impressive but it's generic Sa |  |
| 5 | a9dc03c6-085b-46d7-b50a-0d99d0850d12 | 8 | assistant | 0.3489 | [assistant] **No.** Keep yours.  Their breadth is impressive but it's generic Sa |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 21 | assistant | 0.016393 | [assistant] Now the page and sidebar. Let me also add an "add member" dialog — I |  |
| 2 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 34 | assistant | 0.016129 | [assistant] Operator intervenes → POST /api/cowork/intervene   → Direct write to |  |
| 3 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 3 | user | 0.015873 | [user] Sender (untrusted metadata): ```json {   "label": "openclaw-tui (gateway- |  |
| 4 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 107 | assistant | 0.015625 | [assistant] **No.** Keep yours.  Their breadth is impressive but it's generic Sa |  |
| 5 | a9dc03c6-085b-46d7-b50a-0d99d0850d12 | 8 | assistant | 0.015385 | [assistant] **No.** Keep yours.  Their breadth is impressive but it's generic Sa |  |

---
