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
| 1 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.8234 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |
| 2 | 867a9511-6333-488f-900e-d1ebe281e31c | 138 | assistant | 0.8089 | [assistant] Now add the HTTP fallback to `lib/tracer.js`. When NATS is not conne |  |
| 3 | 867a9511-6333-488f-900e-d1ebe281e31c | 144 | assistant | 0.8053 | [assistant] No memory-daemon events yet. The memory-daemon might not be connecti |  |
| 4 | 867a9511-6333-488f-900e-d1ebe281e31c | 140 | assistant | 0.7976 | [assistant] NATS is installed. Let me start it with JetStream enabled (needed fo |  |
| 5 | 61a8e162-269e-4c07-960c-c5ea44fba075 | 52 | user | 0.7965 | [user] The core insight: NATS + JetStream + SQLite per node gives you everything |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.016393 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |
| 2 | 867a9511-6333-488f-900e-d1ebe281e31c | 138 | assistant | 0.016129 | [assistant] Now add the HTTP fallback to `lib/tracer.js`. When NATS is not conne |  |
| 3 | 867a9511-6333-488f-900e-d1ebe281e31c | 144 | assistant | 0.015873 | [assistant] No memory-daemon events yet. The memory-daemon might not be connecti |  |
| 4 | 867a9511-6333-488f-900e-d1ebe281e31c | 140 | assistant | 0.015625 | [assistant] NATS is installed. Let me start it with JetStream enabled (needed fo |  |
| 5 | 61a8e162-269e-4c07-960c-c5ea44fba075 | 52 | user | 0.015385 | [user] The core insight: NATS + JetStream + SQLite per node gives you everything |  |

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
| 1 | b3114595-1889-43d2-a348-40b744c67e9e | 12 | assistant | 0.7873 | [assistant] You're right. A memory system that relies on "remember to maintain y |  |
| 2 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 36 | assistant | 0.7817 | [assistant] Now restart the daemon to pick up the auto-reload feature: |  |
| 3 | b3eda774-7249-40ac-9c84-d1c7be27a014 | 38 | assistant | 0.7726 | [assistant] The problem is clear: `claude_compile: prose_slim` on "Memory" (H2)  |  |
| 4 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 29 | assistant | 0.7682 | [assistant] Now restart the memory-daemon to pick up the NODE_PATH change: |  |
| 5 | de15883f-a4c2-42a5-8148-1073414d6012 | 26 | assistant | 0.763 | [assistant] Yeah. The adapter already injects instructions for summary and state |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b3114595-1889-43d2-a348-40b744c67e9e | 12 | assistant | 0.016393 | [assistant] You're right. A memory system that relies on "remember to maintain y |  |
| 2 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 36 | assistant | 0.016129 | [assistant] Now restart the daemon to pick up the auto-reload feature: |  |
| 3 | b3eda774-7249-40ac-9c84-d1c7be27a014 | 38 | assistant | 0.015873 | [assistant] The problem is clear: `claude_compile: prose_slim` on "Memory" (H2)  |  |
| 4 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 29 | assistant | 0.015625 | [assistant] Now restart the memory-daemon to pick up the NODE_PATH change: |  |
| 5 | de15883f-a4c2-42a5-8148-1073414d6012 | 26 | assistant | 0.015385 | [assistant] Yeah. The adapter already injects instructions for summary and state |  |

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
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 32 | assistant | 0.7889 | [assistant] Adding auto-reload to the daemon. Simplest approach: check the daemo |  |
| 2 | 867a9511-6333-488f-900e-d1ebe281e31c | 156 | assistant | 0.7863 | [assistant] State is ACTIVE, ticking (lastActivityTime is recent). The daemon IS |  |
| 3 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 69 | assistant | 0.7847 | [assistant] Good, both files look solid. Let me test the daemon now — start it,  |  |
| 4 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 15 | assistant | 0.7844 | [assistant] Daemon is alive and running (pid 36887, state S). No more crash loop |  |
| 5 | 61e9eb73-81f1-48e9-ad49-84d794d4e52d | 33 | assistant | 0.7823 | [assistant] Daemon restarted and already picked up a stale session from the prio |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 32 | assistant | 0.016393 | [assistant] Adding auto-reload to the daemon. Simplest approach: check the daemo |  |
| 2 | 867a9511-6333-488f-900e-d1ebe281e31c | 156 | assistant | 0.016129 | [assistant] State is ACTIVE, ticking (lastActivityTime is recent). The daemon IS |  |
| 3 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 69 | assistant | 0.015873 | [assistant] Good, both files look solid. Let me test the daemon now — start it,  |  |
| 4 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 15 | assistant | 0.015625 | [assistant] Daemon is alive and running (pid 36887, state S). No more crash loop |  |
| 5 | 61e9eb73-81f1-48e9-ad49-84d794d4e52d | 33 | assistant | 0.015385 | [assistant] Daemon restarted and already picked up a stale session from the prio |  |

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
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 219 | assistant | 0.7577 | [assistant] **Bottom line:** It's an impressive prompt engineering template — we |  |
| 2 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 41 | assistant | 0.7537 | [assistant] `all-MiniLM-L6-v2` has a 256 token context. Let me also ensure we ha |  |
| 3 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 32 | assistant | 0.7532 | [assistant] Need to change `WHERE embedding MATCH ? ... LIMIT 5` to `WHERE embed |  |
| 4 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 299 | assistant | 0.7521 | [assistant] You're right — much simpler. Just render inside each cell with negat |  |
| 5 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 27 | assistant | 0.7514 | [assistant] Chunker and sqlite-vec pass. The model needs a HuggingFace token or  |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 219 | assistant | 0.016393 | [assistant] **Bottom line:** It's an impressive prompt engineering template — we |  |
| 2 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 41 | assistant | 0.016129 | [assistant] `all-MiniLM-L6-v2` has a 256 token context. Let me also ensure we ha |  |
| 3 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 32 | assistant | 0.015873 | [assistant] Need to change `WHERE embedding MATCH ? ... LIMIT 5` to `WHERE embed |  |
| 4 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 299 | assistant | 0.015625 | [assistant] You're right — much simpler. Just render inside each cell with negat |  |
| 5 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 27 | assistant | 0.015385 | [assistant] Chunker and sqlite-vec pass. The model needs a HuggingFace token or  |  |

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
| 1 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 56 | assistant | 0.779 | [assistant] Now fix **session-recap** — strip gateway noise, reduce to 2 session |  |
| 2 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 11 | assistant | 0.779 | [assistant] Let me check today's session transcripts to find what you were actua |  |
| 3 | 6d6267cc-85e0-41aa-952a-05f05eb0ee16 | 193 | assistant | 0.7766 | [assistant] Key finding: `sessions.send` method exists! And there's proper proto |  |
| 4 | 867a9511-6333-488f-900e-d1ebe281e31c | 143 | assistant | 0.7742 | [assistant] Daemon logs are flowing. Now the key question — **your current sessi |  |
| 5 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 57 | assistant | 0.7729 | [assistant] Now strip the gateway metadata noise from message excerpts — `Conver |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 56 | assistant | 0.016393 | [assistant] Now fix **session-recap** — strip gateway noise, reduce to 2 session |  |
| 2 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 11 | assistant | 0.016129 | [assistant] Let me check today's session transcripts to find what you were actua |  |
| 3 | 6d6267cc-85e0-41aa-952a-05f05eb0ee16 | 193 | assistant | 0.015873 | [assistant] Key finding: `sessions.send` method exists! And there's proper proto |  |
| 4 | 867a9511-6333-488f-900e-d1ebe281e31c | 143 | assistant | 0.015625 | [assistant] Daemon logs are flowing. Now the key question — **your current sessi |  |
| 5 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 57 | assistant | 0.015385 | [assistant] Now strip the gateway metadata noise from message excerpts — `Conver |  |

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
| 1 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 85 | assistant | 0.7952 | [assistant] Done. Now the reverse index for node→session lookup in `detectStalls |  |
| 2 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 89 | assistant | 0.7758 | [assistant] I'll add `findSessionsByNode()` right after `findByTaskId()` (line 1 |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 103 | assistant | 0.7658 | [assistant] Now modify `tieredSearch` to expand queries via the graph: |  |
| 4 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 88 | assistant | 0.764 | [assistant] Now I'll add a `findSessionsByNode()` method to `CollabStore` — a di |  |
| 5 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 14 | assistant | 0.7623 | [assistant] Now the sessions, assign, and events routes. |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 85 | assistant | 0.016393 | [assistant] Done. Now the reverse index for node→session lookup in `detectStalls |  |
| 2 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 89 | assistant | 0.016129 | [assistant] I'll add `findSessionsByNode()` right after `findByTaskId()` (line 1 |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 103 | assistant | 0.015873 | [assistant] Now modify `tieredSearch` to expand queries via the graph: |  |
| 4 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 88 | assistant | 0.015625 | [assistant] Now I'll add a `findSessionsByNode()` method to `CollabStore` — a di |  |
| 5 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 14 | assistant | 0.015385 | [assistant] Now the sessions, assign, and events routes. |  |

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
| 1 | d6607f55-28af-4b85-99c8-f091457c646a | 77 | assistant | 0.7788 | [assistant] Same issue — `storeArtifact` uses a manual CAS loop but returns the  |  |
| 2 | 3b07d1ff-88b1-4529-a770-c362a0427f7f | 2 | assistant | 0.7452 | [assistant] Saved. Couldn't pull the tweet content (X blocks headless fetches),  |  |
| 3 | 65e47c9c-411c-4159-b0a6-49822c140004 | 5 | assistant | 0.7445 | [assistant] Can't find that specific post — it's either too fresh to be indexed  |  |
| 4 | d6607f55-28af-4b85-99c8-f091457c646a | 78 | assistant | 0.7425 | [assistant] The `storeArtifact` manual CAS loop looks correct — it returns `null |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 75 | assistant | 0.7408 | [assistant] It links to an X article. Let me try to fetch its content. |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d6607f55-28af-4b85-99c8-f091457c646a | 77 | assistant | 0.016393 | [assistant] Same issue — `storeArtifact` uses a manual CAS loop but returns the  |  |
| 2 | 3b07d1ff-88b1-4529-a770-c362a0427f7f | 2 | assistant | 0.016129 | [assistant] Saved. Couldn't pull the tweet content (X blocks headless fetches),  |  |
| 3 | 65e47c9c-411c-4159-b0a6-49822c140004 | 5 | assistant | 0.015873 | [assistant] Can't find that specific post — it's either too fresh to be indexed  |  |
| 4 | d6607f55-28af-4b85-99c8-f091457c646a | 78 | assistant | 0.015625 | [assistant] The `storeArtifact` manual CAS loop looks correct — it returns `null |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 75 | assistant | 0.015385 | [assistant] It links to an X article. Let me try to fetch its content. |  |

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
| 1 | 61a8e162-269e-4c07-960c-c5ea44fba075 | 52 | user | 0.7825 | [user] The core insight: NATS + JetStream + SQLite per node gives you everything |  |
| 2 | 56db18ab-84db-4062-836d-b726ceeedab5 | 5 | user | 0.7732 | [user] That's a fundamentally different architecture than "sync a JSON file betw |  |
| 3 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.7504 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |
| 4 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 79 | assistant | 0.7488 | [assistant] JetStream is running fine — 2 streams, 32 messages, 0 errors, 30KB s |  |
| 5 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 81 | assistant | 0.7474 | [assistant] 4 NATS connections, all active with subscriptions. Let me also confi |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 61a8e162-269e-4c07-960c-c5ea44fba075 | 52 | user | 0.016393 | [user] The core insight: NATS + JetStream + SQLite per node gives you everything |  |
| 2 | 56db18ab-84db-4062-836d-b726ceeedab5 | 5 | user | 0.016129 | [user] That's a fundamentally different architecture than "sync a JSON file betw |  |
| 3 | 867a9511-6333-488f-900e-d1ebe281e31c | 141 | assistant | 0.015873 | [assistant] NATS is running with JetStream on port 4222. Now sync everything and |  |
| 4 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 79 | assistant | 0.015625 | [assistant] JetStream is running fine — 2 streams, 32 messages, 0 errors, 30KB s |  |
| 5 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 81 | assistant | 0.015385 | [assistant] 4 NATS connections, all active with subscriptions. Let me also confi |  |

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
| 1 | d6607f55-28af-4b85-99c8-f091457c646a | 308 | assistant | 0.7869 | [assistant] Multiple references to `event.status` across all components. Need to |  |
| 2 | 6d6267cc-85e0-41aa-952a-05f05eb0ee16 | 198 | assistant | 0.7864 | [assistant] Both work. Let me check if system events appear in presence: |  |
| 3 | d6607f55-28af-4b85-99c8-f091457c646a | 303 | assistant | 0.7755 | [assistant] Found it — line 57: `event.module.includes("state")` crashes when `e |  |
| 4 | 61e9eb73-81f1-48e9-ad49-84d794d4e52d | 14 | assistant | 0.7747 | [assistant] **35/36 pass.** Only the event stream test fails — it claims the `cl |  |
| 5 | d6607f55-28af-4b85-99c8-f091457c646a | 307 | assistant | 0.7739 | [assistant] Now let me check for any other references to `event.status` in the l |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | d6607f55-28af-4b85-99c8-f091457c646a | 308 | assistant | 0.016393 | [assistant] Multiple references to `event.status` across all components. Need to |  |
| 2 | 6d6267cc-85e0-41aa-952a-05f05eb0ee16 | 198 | assistant | 0.016129 | [assistant] Both work. Let me check if system events appear in presence: |  |
| 3 | d6607f55-28af-4b85-99c8-f091457c646a | 303 | assistant | 0.015873 | [assistant] Found it — line 57: `event.module.includes("state")` crashes when `e |  |
| 4 | 61e9eb73-81f1-48e9-ad49-84d794d4e52d | 14 | assistant | 0.015625 | [assistant] **35/36 pass.** Only the event stream test fails — it claims the `cl |  |
| 5 | d6607f55-28af-4b85-99c8-f091457c646a | 307 | assistant | 0.015385 | [assistant] Now let me check for any other references to `event.status` in the l |  |

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
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.8137 | [assistant] First, let me check how many facts are already in the DB and backfil |  |
| 2 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 41 | assistant | 0.787 | [assistant] The merge result with `conflict: true` is already handled — `keepBra |  |
| 3 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 155 | assistant | 0.787 | [assistant] Let me read both files fully one more time to merge them precisely. |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 137 | assistant | 0.7834 | [assistant] The flush endpoint expects pre-extracted facts. Let me create a quic |  |
| 5 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 39 | assistant | 0.7824 | [assistant] The merge race: two parallel nodes call `commitAndMergeWorktree()` c |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 135 | assistant | 0.016393 | [assistant] First, let me check how many facts are already in the DB and backfil |  |
| 2 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 41 | assistant | 0.016129 | [assistant] The merge result with `conflict: true` is already handled — `keepBra |  |
| 3 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 155 | assistant | 0.015873 | [assistant] Let me read both files fully one more time to merge them precisely. |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 137 | assistant | 0.015625 | [assistant] The flush endpoint expects pre-extracted facts. Let me create a quic |  |
| 5 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 39 | assistant | 0.015385 | [assistant] The merge race: two parallel nodes call `commitAndMergeWorktree()` c |  |

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
| 1 | de15883f-a4c2-42a5-8148-1073414d6012 | 28 | assistant | 0.7518 | [assistant] I'll add a `lastDailyLogTurn` field to track when we last triggered  |  |
| 2 | 65e47c9c-411c-4159-b0a6-49822c140004 | 144 | assistant | 0.7503 | [assistant] Background task b79795d (MESH-WRITE-002) completed — already verifie |  |
| 3 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 16 | assistant | 0.7436 | [assistant] There it is. The daily-log-writer:  1. **Is wired into the daemon**  |  |
| 4 | 867a9511-6333-488f-900e-d1ebe281e31c | 117 | assistant | 0.7416 | [assistant] No events since restart. The `insertEvent` catch is swallowing error |  |
| 5 | 2e16b25f-3c65-4a43-a162-30fcece40c7e | 34 | assistant | 0.7393 | [assistant] Now add event publishing to the daemon. I'll add a `publishEvent` he |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | de15883f-a4c2-42a5-8148-1073414d6012 | 28 | assistant | 0.016393 | [assistant] I'll add a `lastDailyLogTurn` field to track when we last triggered  |  |
| 2 | 65e47c9c-411c-4159-b0a6-49822c140004 | 144 | assistant | 0.016129 | [assistant] Background task b79795d (MESH-WRITE-002) completed — already verifie |  |
| 3 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 16 | assistant | 0.015873 | [assistant] There it is. The daily-log-writer:  1. **Is wired into the daemon**  |  |
| 4 | 867a9511-6333-488f-900e-d1ebe281e31c | 117 | assistant | 0.015625 | [assistant] No events since restart. The `insertEvent` catch is swallowing error |  |
| 5 | 2e16b25f-3c65-4a43-a162-30fcece40c7e | 34 | assistant | 0.015385 | [assistant] Now add event publishing to the daemon. I'll add a `publishEvent` he |  |

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
| 1 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 38 | assistant | 0.7959 | [assistant] **session-store: imported 189 sessions** — it's working. No errors.  |  |
| 2 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 36 | assistant | 0.7819 | [assistant] Now restart the daemon one more time to verify session-store loads: |  |
| 3 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 33 | assistant | 0.7693 | [assistant] NODE_PATH is set. But `session-store.mjs` uses a static ESM `import  |  |
| 4 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.768 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 5 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 88 | assistant | 0.7658 | [assistant] Now I'll add a `findSessionsByNode()` method to `CollabStore` — a di |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 38 | assistant | 0.016393 | [assistant] **session-store: imported 189 sessions** — it's working. No errors.  |  |
| 2 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 36 | assistant | 0.016129 | [assistant] Now restart the daemon one more time to verify session-store loads: |  |
| 3 | 2db8ce86-6605-4d5b-9eee-d0490e3b8cf5 | 33 | assistant | 0.015873 | [assistant] NODE_PATH is set. But `session-store.mjs` uses a static ESM `import  |  |
| 4 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.015625 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 5 | 9a3aa72c-9b76-40da-a4ac-cdbdeed06f36 | 88 | assistant | 0.015385 | [assistant] Now I'll add a `findSessionsByNode()` method to `CollabStore` — a di |  |

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
| 1 | ae711e37-421a-4439-8605-debb2dadc945 | 10 | assistant | 0.8264 | [assistant] Lock file from the dead process. Let me clean it up and retry. |  |
| 2 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 163 | assistant | 0.8158 | [assistant] Now compile check before deleting the old files — make sure nothing  |  |
| 3 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 166 | assistant | 0.8096 | [assistant] No external imports of the old files. Safe to delete. |  |
| 4 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 199 | assistant | 0.7915 | [assistant] Only 1 deleted — the rest were already gone via KV delete (tombstone |  |
| 5 | c267ef52-dfe9-4592-8b3f-e61487b7e858 | 2 | assistant | 0.7846 | [assistant] Let me grab the files that failed. |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | ae711e37-421a-4439-8605-debb2dadc945 | 10 | assistant | 0.016393 | [assistant] Lock file from the dead process. Let me clean it up and retry. |  |
| 2 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 163 | assistant | 0.016129 | [assistant] Now compile check before deleting the old files — make sure nothing  |  |
| 3 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 166 | assistant | 0.015873 | [assistant] No external imports of the old files. Safe to delete. |  |
| 4 | aba1553c-016a-44b9-81f6-a1259f1ca9db | 199 | assistant | 0.015625 | [assistant] Only 1 deleted — the rest were already gone via KV delete (tombstone |  |
| 5 | c267ef52-dfe9-4592-8b3f-e61487b7e858 | 2 | assistant | 0.015385 | [assistant] Let me grab the files that failed. |  |

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
| 1 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 40 | assistant | 0.8537 | [assistant] Now write the daily log. |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 62 | assistant | 0.8523 | [assistant] Got it. Writing the daily log now. |  |
| 3 | dfe97968-4ff6-4020-b778-c3c3653c436c | 58 | assistant | 0.8178 | [assistant] Now let me update the daily log with everything from this analysis p |  |
| 4 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 104 | assistant | 0.8143 | [assistant] Now update the daily log. |  |
| 5 | c267ef52-dfe9-4592-8b3f-e61487b7e858 | 71 | assistant | 0.8143 | [assistant] Now update the daily log. |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | bf7e0eff-962b-454b-b1c1-b5e8586ba694 | 40 | assistant | 0.016393 | [assistant] Now write the daily log. |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 62 | assistant | 0.016129 | [assistant] Got it. Writing the daily log now. |  |
| 3 | dfe97968-4ff6-4020-b778-c3c3653c436c | 58 | assistant | 0.015873 | [assistant] Now let me update the daily log with everything from this analysis p |  |
| 4 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 104 | assistant | 0.015625 | [assistant] Now update the daily log. |  |
| 5 | c267ef52-dfe9-4592-8b3f-e61487b7e858 | 71 | assistant | 0.015385 | [assistant] Now update the daily log. |  |

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
| 1 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 33 | assistant | 0.7544 | [assistant] Now fix the same pattern in the server — both `semanticSearch` and ` |  |
| 2 | 53e8f342-f0e0-43aa-826b-794ea3e916d2 | 1 | assistant | 0.7402 | [assistant] Yo. Yeah, I'm here.  Deep research — yes, I can do it. I have web se |  |
| 3 | f764a662-ba35-4319-aef7-63bf62c8ce60 | 10 | assistant | 0.7355 | [assistant] Still running, no owner claimed yet. Let me check if the collaborati |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 103 | assistant | 0.7345 | [assistant] Now modify `tieredSearch` to expand queries via the graph: |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 109 | assistant | 0.7324 | [assistant] Now add the contradiction detection + superseding function, and hook |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b85f402e-01db-4438-8c0f-8000f8a474e9 | 33 | assistant | 0.016393 | [assistant] Now fix the same pattern in the server — both `semanticSearch` and ` |  |
| 2 | 53e8f342-f0e0-43aa-826b-794ea3e916d2 | 1 | assistant | 0.016129 | [assistant] Yo. Yeah, I'm here.  Deep research — yes, I can do it. I have web se |  |
| 3 | f764a662-ba35-4319-aef7-63bf62c8ce60 | 10 | assistant | 0.015873 | [assistant] Still running, no owner claimed yet. Let me check if the collaborati |  |
| 4 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 103 | assistant | 0.015625 | [assistant] Now modify `tieredSearch` to expand queries via the graph: |  |
| 5 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 109 | assistant | 0.015385 | [assistant] Now add the contradiction detection + superseding function, and hook |  |

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
| 1 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 65 | assistant | 0.7579 | [assistant] Good — `MESH_TASKS` KV bucket created. No TTL (tasks persist), 5 his |  |
| 2 | d6607f55-28af-4b85-99c8-f091457c646a | 87 | assistant | 0.7533 | [assistant] FTS5 injection fixes landed. 3 agents still running. |  |
| 3 | f764a662-ba35-4319-aef7-63bf62c8ce60 | 12 | assistant | 0.7498 | [assistant] Task daemon created the collab session. Let me check the collab sess |  |
| 4 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 21 | assistant | 0.7446 | [assistant] Now let me update session-recap and launch the big modules in parall |  |
| 5 | 9442bc23-9560-415b-b863-c1936e730d30 | 63 | assistant | 0.7421 | [assistant] 5.5s is too slow. moltymac shows online with data — so KV works for  |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 65 | assistant | 0.016393 | [assistant] Good — `MESH_TASKS` KV bucket created. No TTL (tasks persist), 5 his |  |
| 2 | d6607f55-28af-4b85-99c8-f091457c646a | 87 | assistant | 0.016129 | [assistant] FTS5 injection fixes landed. 3 agents still running. |  |
| 3 | f764a662-ba35-4319-aef7-63bf62c8ce60 | 12 | assistant | 0.015873 | [assistant] Task daemon created the collab session. Let me check the collab sess |  |
| 4 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 21 | assistant | 0.015625 | [assistant] Now let me update session-recap and launch the big modules in parall |  |
| 5 | 9442bc23-9560-415b-b863-c1936e730d30 | 63 | assistant | 0.015385 | [assistant] 5.5s is too slow. moltymac shows online with data — so KV works for  |  |

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
| 1 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 105 | assistant | 0.7742 | [assistant] Same issue. Claude hangs when spawned via Node.js but completes inst |  |
| 2 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 40 | assistant | 0.7656 | [assistant] Good — the mesh CLI is a Node.js script using the `nats` npm package |  |
| 3 | a9dc03c6-085b-46d7-b50a-0d99d0850d12 | 24 | assistant | 0.764 | [assistant] Now add `mesh_task_id` and `mesh_node` to the parser, serializer, sy |  |
| 4 | dfe97968-4ff6-4020-b778-c3c3653c436c | 22 | assistant | 0.7635 | [assistant] Now the remaining JS/shell files with the hardcoded IP: |  |
| 5 | d6607f55-28af-4b85-99c8-f091457c646a | 509 | assistant | 0.7621 | [assistant] Node.js isn't in PATH for the background process. Let me find it and |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 4ab87c86-dac5-4761-816e-b5fa21e9feec | 105 | assistant | 0.016393 | [assistant] Same issue. Claude hangs when spawned via Node.js but completes inst |  |
| 2 | e7ccaaf9-5113-4b8c-9f94-59cbe4a11b92 | 40 | assistant | 0.016129 | [assistant] Good — the mesh CLI is a Node.js script using the `nats` npm package |  |
| 3 | a9dc03c6-085b-46d7-b50a-0d99d0850d12 | 24 | assistant | 0.015873 | [assistant] Now add `mesh_task_id` and `mesh_node` to the parser, serializer, sy |  |
| 4 | dfe97968-4ff6-4020-b778-c3c3653c436c | 22 | assistant | 0.015625 | [assistant] Now the remaining JS/shell files with the hardcoded IP: |  |
| 5 | d6607f55-28af-4b85-99c8-f091457c646a | 509 | assistant | 0.015385 | [assistant] Node.js isn't in PATH for the background process. Let me find it and |  |

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
| 1 | de06c210-f214-4b15-9ea1-9fea90a8510e | 8 | assistant | 0.8441 | [assistant] Now let me write the migration script and update the code in paralle |  |
| 2 | b530ac03-39df-4b9c-b004-199766e79b45 | 16 | assistant | 0.8108 | [assistant] ✅ Migration done. Scripts now derive paths from their location, not  |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 98 | assistant | 0.7855 | [assistant] Now add the migration SQL to `index.ts`: |  |
| 4 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 10 | assistant | 0.7853 | [assistant] Now add the migrations to `db/index.ts`. |  |
| 5 | b8fac530-4793-411a-9524-a5c19de02b32 | 9 | assistant | 0.78 | [assistant] Now let me write and execute the move + link update script. |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | de06c210-f214-4b15-9ea1-9fea90a8510e | 8 | assistant | 0.016393 | [assistant] Now let me write the migration script and update the code in paralle |  |
| 2 | b530ac03-39df-4b9c-b004-199766e79b45 | 16 | assistant | 0.016129 | [assistant] ✅ Migration done. Scripts now derive paths from their location, not  |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 98 | assistant | 0.015873 | [assistant] Now add the migration SQL to `index.ts`: |  |
| 4 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 10 | assistant | 0.015625 | [assistant] Now add the migrations to `db/index.ts`. |  |
| 5 | b8fac530-4793-411a-9524-a5c19de02b32 | 9 | assistant | 0.015385 | [assistant] Now let me write and execute the move + link update script. |  |

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
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 100 | assistant | 0.7879 | [assistant] Now wire entity extraction into the existing `storeExtractedFacts` p |  |
| 2 | 2572dd5d-aec8-4a3a-8eec-7edd77e825d1 | 11 | toolResult | 0.7751 | [toolResult] ### [10] TURINGERY: DIFFERENCING AS TRUTH EXTRACTION FROM NOISE - * |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 137 | assistant | 0.7681 | [assistant] The flush endpoint expects pre-extracted facts. Let me create a quic |  |
| 4 | 925de000-a4dc-4a4a-bdcc-592257c417f6 | 6 | assistant | 0.7671 | [assistant] Output truncated — let me grab the summary. |  |
| 5 | b3114595-1889-43d2-a348-40b744c67e9e | 27 | assistant | 0.7611 | [assistant] The MC sync is already wired. The fact extraction gap is architectur |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 100 | assistant | 0.016393 | [assistant] Now wire entity extraction into the existing `storeExtractedFacts` p |  |
| 2 | 2572dd5d-aec8-4a3a-8eec-7edd77e825d1 | 11 | toolResult | 0.016129 | [toolResult] ### [10] TURINGERY: DIFFERENCING AS TRUTH EXTRACTION FROM NOISE - * |  |
| 3 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 137 | assistant | 0.015873 | [assistant] The flush endpoint expects pre-extracted facts. Let me create a quic |  |
| 4 | 925de000-a4dc-4a4a-bdcc-592257c417f6 | 6 | assistant | 0.015625 | [assistant] Output truncated — let me grab the summary. |  |
| 5 | b3114595-1889-43d2-a348-40b744c67e9e | 27 | assistant | 0.015385 | [assistant] The MC sync is already wired. The fact extraction gap is architectur |  |

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
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 188 | user | 0.7963 | [user] Skip entirely:  - chokidar file watching (use mtime polling)  - Obsidian  |  |
| 2 | b8fac530-4793-411a-9524-a5c19de02b32 | 58 | assistant | 0.7835 | [assistant] Good overview. The subfolder `_index.md` files use Dataview queries  |  |
| 3 | 4e37115a-40da-4af0-995e-fa44d9c193a6 | 3 | assistant | 0.782 | [assistant] `lib/mcp-knowledge/` already uses sqlite-vec — Phase 2 may already b |  |
| 4 | d6607f55-28af-4b85-99c8-f091457c646a | 281 | assistant | 0.7693 | [assistant] MC is down since you killed PID 20936. Start it back up:  ```bash cd |  |
| 5 | 2b7ca28c-d3c0-4a76-9e69-2d1a14b13909 | 5 | assistant | 0.7667 | [assistant] Let me also grab the MCP manager directly since WebFetch couldn't re |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 443a3cb8-1072-4c6d-b520-c06afda1cff0 | 188 | user | 0.016393 | [user] Skip entirely:  - chokidar file watching (use mtime polling)  - Obsidian  |  |
| 2 | b8fac530-4793-411a-9524-a5c19de02b32 | 58 | assistant | 0.016129 | [assistant] Good overview. The subfolder `_index.md` files use Dataview queries  |  |
| 3 | 4e37115a-40da-4af0-995e-fa44d9c193a6 | 3 | assistant | 0.015873 | [assistant] `lib/mcp-knowledge/` already uses sqlite-vec — Phase 2 may already b |  |
| 4 | d6607f55-28af-4b85-99c8-f091457c646a | 281 | assistant | 0.015625 | [assistant] MC is down since you killed PID 20936. Start it back up:  ```bash cd |  |
| 5 | 2b7ca28c-d3c0-4a76-9e69-2d1a14b13909 | 5 | assistant | 0.015385 | [assistant] Let me also grab the MCP manager directly since WebFetch couldn't re |  |

---

### q21: What is the MEMORY.md file format and how is it structured?

**Category:** memory-lifecycle | **Expected topic:** working memory, sections, budget, rendered output

**FTS5** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b3eda774-7249-40ac-9c84-d1c7be27a014 | 13 | assistant | 15.705821 | [assistant] Here's a deep dive, section by section.  ## The Core Question  Prose |  |
| 2 | d58dd76d-9ef0-42aa-a370-c313095453f8 | 38 | user | 7.335538 | [user] [Mon 2026-03-16 16:58 GMT-5] so this is basically what s been missing out |  |

**Semantic** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b3114595-1889-43d2-a348-40b744c67e9e | 23 | assistant | 0.792 | [assistant] Now update MEMORY.md — it's 13 days stale: |  |
| 2 | b3114595-1889-43d2-a348-40b744c67e9e | 44 | assistant | 0.7894 | [assistant] Good, I have the full picture. Now let me build the MEMORY_SPEC.md — |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 43 | assistant | 0.7879 | [assistant] Here. Two items queued — MEMORY_SPEC.md first, then token cost estim |  |
| 4 | b3114595-1889-43d2-a348-40b744c67e9e | 17 | assistant | 0.7774 | [assistant] ✅ `bin/memory-maintenance` built — handles archival, prediction clos |  |
| 5 | 4e37115a-40da-4af0-995e-fa44d9c193a6 | 0 | user | 0.7721 | [user] @/Users/moltymac/Downloads/openclaw-memory-implementation-plan.md can you |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | b3114595-1889-43d2-a348-40b744c67e9e | 23 | assistant | 0.016393 | [assistant] Now update MEMORY.md — it's 13 days stale: |  |
| 2 | b3114595-1889-43d2-a348-40b744c67e9e | 44 | assistant | 0.016129 | [assistant] Good, I have the full picture. Now let me build the MEMORY_SPEC.md — |  |
| 3 | b3114595-1889-43d2-a348-40b744c67e9e | 43 | assistant | 0.015873 | [assistant] Here. Two items queued — MEMORY_SPEC.md first, then token cost estim |  |
| 4 | b3114595-1889-43d2-a348-40b744c67e9e | 17 | assistant | 0.015625 | [assistant] ✅ `bin/memory-maintenance` built — handles archival, prediction clos |  |
| 5 | 4e37115a-40da-4af0-995e-fa44d9c193a6 | 0 | user | 0.015385 | [user] @/Users/moltymac/Downloads/openclaw-memory-implementation-plan.md can you |  |

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
| 1 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 73 | assistant | 0.8101 | [assistant] No new user message — just stale agent notifications and file change |  |
| 2 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 31 | assistant | 0.8022 | [assistant] Now let me find the local/companion-bridge side that injects the rul |  |
| 3 | 6d6267cc-85e0-41aa-952a-05f05eb0ee16 | 138 | assistant | 0.7979 | [assistant] Now update the PATCH handler to send the right message format: |  |
| 4 | 6121e967-d752-4927-85f7-41d0a251969c | 47 | assistant | 0.7972 | [assistant] Agents are stuck. Let me check what's happening by messaging agent-a |  |
| 5 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 75 | assistant | 0.7944 | [assistant] All system echoes, no user message. Standing by. |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 73 | assistant | 0.016393 | [assistant] No new user message — just stale agent notifications and file change |  |
| 2 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 31 | assistant | 0.016129 | [assistant] Now let me find the local/companion-bridge side that injects the rul |  |
| 3 | 6d6267cc-85e0-41aa-952a-05f05eb0ee16 | 138 | assistant | 0.015873 | [assistant] Now update the PATCH handler to send the right message format: |  |
| 4 | 6121e967-d752-4927-85f7-41d0a251969c | 47 | assistant | 0.015625 | [assistant] Agents are stuck. Let me check what's happening by messaging agent-a |  |
| 5 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 75 | assistant | 0.015385 | [assistant] All system echoes, no user message. Standing by. |  |

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
| 1 | 5845dc9f-1bea-4b33-9702-fb7549305678 | 20 | assistant | 0.7416 | [assistant] Now the two-tier retry logic. Normal exit (Claude ran, metric failed |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 161 | assistant | 0.7387 | [assistant] Now let me also check the entities module to understand the data sha |  |
| 3 | de15883f-a4c2-42a5-8148-1073414d6012 | 22 | assistant | 0.7376 | [assistant] The companion bridge is no longer a second-class citizen for memory. |  |
| 4 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 250 | assistant | 0.7372 | [assistant] The duplicate is likely because meta-tasks show up both as bars in t |  |
| 5 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 5 | assistant | 0.7366 | [assistant] Let me explore the existing codebase in parallel to understand patte |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | 5845dc9f-1bea-4b33-9702-fb7549305678 | 20 | assistant | 0.016393 | [assistant] Now the two-tier retry logic. Normal exit (Claude ran, metric failed |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 161 | assistant | 0.016129 | [assistant] Now let me also check the entities module to understand the data sha |  |
| 3 | de15883f-a4c2-42a5-8148-1073414d6012 | 22 | assistant | 0.015873 | [assistant] The companion bridge is no longer a second-class citizen for memory. |  |
| 4 | 04baed44-7eda-4fbb-9085-0a2de6086e8d | 250 | assistant | 0.015625 | [assistant] The duplicate is likely because meta-tasks show up both as bars in t |  |
| 5 | 107aeeae-da9b-4b15-afd8-c9d52ee65686 | 5 | assistant | 0.015385 | [assistant] Let me explore the existing codebase in parallel to understand patte |  |

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
| 1 | de15883f-a4c2-42a5-8148-1073414d6012 | 29 | assistant | 0.858 | [assistant] Now initialize it in the session creation. |  |
| 2 | 22c63342-4fea-46c2-87ed-d2b928bd296a | 25 | assistant | 0.7809 | [assistant] Now update CLAUDE.md — remove the session-start commands since the d |  |
| 3 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 21 | assistant | 0.7797 | [assistant] Now let me update session-recap and launch the big modules in parall |  |
| 4 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.77 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 5 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 14 | assistant | 0.7696 | [assistant] Now the sessions, assign, and events routes. |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | de15883f-a4c2-42a5-8148-1073414d6012 | 29 | assistant | 0.016393 | [assistant] Now initialize it in the session creation. |  |
| 2 | 22c63342-4fea-46c2-87ed-d2b928bd296a | 25 | assistant | 0.016129 | [assistant] Now update CLAUDE.md — remove the session-start commands since the d |  |
| 3 | 755c8dcd-162e-4e0a-a445-bab39c00108b | 21 | assistant | 0.015873 | [assistant] Now let me update session-recap and launch the big modules in parall |  |
| 4 | 4d7c11e6-920d-4851-8e5f-8cffb2f8981c | 12 | assistant | 0.015625 | [assistant] Store session_id in the task when auto-creating a session in `handle |  |
| 5 | 25d932b5-44ce-4d31-8ff5-b1c0aed22ee5 | 14 | assistant | 0.015385 | [assistant] Now the sessions, assign, and events routes. |  |

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
| 1 | e03cf9bc-99d3-48b3-b940-2847597c2255 | 1 | assistant | 0.7564 | [assistant] Let me check what's pushed vs. what's local. |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 22 | assistant | 0.7534 | [assistant] Now I'll replace the knowledge_base catch-all with targeted pillar r |  |
| 3 | f764a662-ba35-4319-aef7-63bf62c8ce60 | 62 | assistant | 0.7466 | [assistant] Now deploy this fix to both nodes. The local copy is already updated |  |
| 4 | 6a9573e2-b803-407f-9527-c69bc8ad82ad | 7 | assistant | 0.7457 | [assistant] Yeah that's rough. Let me find where the local prompt is assembled s |  |
| 5 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 31 | assistant | 0.7432 | [assistant] Now let me find the local/companion-bridge side that injects the rul |  |

**Hybrid** results:

| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |
|------|---------|------|------|-------|---------|-----------------|
| 1 | e03cf9bc-99d3-48b3-b940-2847597c2255 | 1 | assistant | 0.016393 | [assistant] Let me check what's pushed vs. what's local. |  |
| 2 | da6f5e80-cdc4-4cf6-a13d-ba225d04f3b4 | 22 | assistant | 0.016129 | [assistant] Now I'll replace the knowledge_base catch-all with targeted pillar r |  |
| 3 | f764a662-ba35-4319-aef7-63bf62c8ce60 | 62 | assistant | 0.015873 | [assistant] Now deploy this fix to both nodes. The local copy is already updated |  |
| 4 | 6a9573e2-b803-407f-9527-c69bc8ad82ad | 7 | assistant | 0.015625 | [assistant] Yeah that's rough. Let me find where the local prompt is assembled s |  |
| 5 | 68f30a37-77fb-444f-9887-c1fd7811a77d | 31 | assistant | 0.015385 | [assistant] Now let me find the local/companion-bridge side that injects the rul |  |

---
