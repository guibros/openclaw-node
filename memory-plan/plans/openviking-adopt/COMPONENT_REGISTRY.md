# COMPONENT_REGISTRY — openviking-adopt plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a runtime probe verified, and date it. Claims older than 14 days decay (MASTER_PLAN §4.9).

**Probe context (2026-09-21):** the session that authored this plan ran in a remote container
holding only the repo checkout (no `~/.openclaw`, no Ollama, no bge-m3 model, no gateway).
Every row below is therefore CODE-VERIFIED (tests in the container) with runtime status UNPROBED
until the operator re-verifies on the node.

## Family 1: Knowledge server

### lib/mcp-knowledge (stdio MCP + optional HTTP :KNOWLEDGE_PORT)

| | |
|---|---|
| **Status** | UNPROBED (runtime) / code-verified |
| **Verified** | 2026-09-21 — `node --test test/mcp-knowledge-path-scope.test.mjs test/mcp-knowledge-directory-summaries.test.mjs` green in the container (embedder-gated cases skip visibly) |
| **Owner files** | `lib/mcp-knowledge/core.mjs`, `lib/mcp-knowledge/server.mjs`, `lib/mcp-knowledge/directory-summaries.mjs` |
| **Delta this plan** | `pathPrefix` on `semanticSearch`/`findRelated`; `directory_summaries` + `directory_vectors` tables (knowledge schema v2); tools `knowledge_tree`, `directory_overview`, `search_directories`; `dir_abstract` on hits |

## Family 2: Memory pipeline

### lib/extraction-store (state.db extraction tables)

| | |
|---|---|
| **Status** | UNPROBED (runtime) / code-verified |
| **Verified** | 2026-09-21 — `node --test test/memory-types.test.mjs test/extraction-store.test.mjs test/extraction-prompt.test.mjs` green in the container |
| **Owner files** | `lib/memory-types.mjs`, `lib/extraction-store.mjs`, `lib/extraction-schema.mjs`, `lib/extraction-prompt.mjs`, `lib/pre-compression-flush.mjs` |
| **Delta this plan** | schema v6: `entities.aliases` (JSON union), `decisions.superseded_by`; merge ops applied via `memory-types`; known-memory candidates in the extraction prompt; `ref`/`aliases`/`supersedes` accepted from the LLM; injector + decision-FTS channel skip superseded decisions |

## Family 3: Gateway integration

### packages/openclaw-memory-context-engine (OpenClaw contextEngine slot)

| | |
|---|---|
| **Status** | UNBUILT on the node / code-verified |
| **Verified** | 2026-09-21 — `node --test test/openclaw-context-engine.test.mjs` green against a fake loopback inject server in the container |
| **Owner files** | `packages/openclaw-memory-context-engine/{openclaw.plugin.json,index.js,memory-client.js,package.json,README.md}` |
| **Runtime dependency** | daemon inject server :7893 (LIVE at the 2026-09 probe per CLAUDE.md) + token file `~/.openclaw/config/memory-injection-token`; OpenClaw ≥ 2026.5.27 (gateway was DOWN at the last probe) |
