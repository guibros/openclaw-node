# COMPONENT_REGISTRY — openviking-adopt plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a runtime probe verified, and date it. Claims older than 14 days decay (MASTER_PLAN §4.9).

**Probe context (2026-09-21):** the session that authored this plan ran in a remote container
holding only the repo checkout (no `~/.openclaw`, no Ollama, no bge-m3 model, no gateway).
Every row below is therefore CODE-VERIFIED (tests in the container) with runtime status UNPROBED
until the operator re-verifies on the node.

**Node probe (2026-09-21 deploy, rows updated 2026-09-27):** `deploy.sh` ran on the node; its record is
`audits/deploy_2026-09-21_113717.md`. Rows below say which parts that run actually reached.

## Family 1: Knowledge server

### lib/mcp-knowledge (stdio MCP + optional HTTP :KNOWLEDGE_PORT)

| | |
|---|---|
| **Status** | DOWN as an MCP server on the node (it does not start through the symlinked lib: db94e64's entrypoint guard compares the resolved module URL with the symlink path); library probed in-process / code-verified |
| **Verified** | 2026-09-21 — `node --test test/mcp-knowledge-path-scope.test.mjs test/mcp-knowledge-directory-summaries.test.mjs` green in the container (embedder-gated cases skip visibly). 2026-09-21 on the node — `probe.mjs` called the library in-process against the live `.knowledge.db`: scoped hits all inside their prefix, 25 directory summaries, 25 LLM-written; no MCP tool call. 2026-09-26 on the node — every Claude Code session logged `knowledge (CONNECTION_CLOSED)` |
| **Owner files** | `lib/mcp-knowledge/core.mjs`, `lib/mcp-knowledge/server.mjs`, `lib/mcp-knowledge/directory-summaries.mjs` |
| **Delta this plan** | `pathPrefix` on `semanticSearch`/`findRelated`; `directory_summaries` + `directory_vectors` tables (knowledge schema v2); tools `knowledge_tree`, `directory_overview`, `search_directories`; `dir_abstract` on hits |

## Family 2: Memory pipeline

### lib/extraction-store (state.db extraction tables)

| | |
|---|---|
| **Status** | LIVE (schema v6 on the node's state.db); typed merge on a live flush not yet observed (3.2) |
| **Verified** | 2026-09-21 — `node --test test/memory-types.test.mjs test/extraction-store.test.mjs test/extraction-prompt.test.mjs` green in the container. 2026-09-21 on the node — `state.db` user_version=6, `entity_aliases` and `decisions.superseded_by` present after the daemon restart (step 3.1's Verify) |
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
