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
| **Status** | WORKING on the node as a stdio MCP server (observed 2026-09-26 21:56 EDT after the live deploy; re-checked 2026-09-27 10:36 EDT). It was DOWN from 2026-09-21 10:54 EDT until that deploy, because db94e64's entrypoint guard compared the resolved module URL with the symlinked `argv[1]`. |
| **Verified** | 2026-09-27 10:36 EDT — the live checkout on `node-deploy/2026-09-27-foreman` carries 6911644 and 0d1ca19, and `claude mcp list` reports `knowledge … ✓ Connected` in 3.4 s. 2026-09-26 21:56 EDT, right after the deploy — `claude mcp list` (Claude Code 2.1.50) reported ✓ Connected. The exact `.mcp.json` launch answers `initialize` in 0.8 s; with the entrypoint fix alone it took 137.8 s and 205.9 s, against Claude Code's 30 s. It serves `tools/list`, `knowledge_tree` and 1.1's `path_prefix` Verify while its index pass runs, and the pass finishes in the background (2 LLM abstracts). Earlier on 2026-09-26, every Claude Code session logged `knowledge (CONNECTION_CLOSED)`; the MCP logs show the last successful connect at 2026-09-21 10:50 EDT. 2026-09-21 on the node — `probe.mjs` called the library in-process against the live `.knowledge.db`: scoped hits all inside their prefix, 25 directory summaries, 25 LLM-written; no MCP tool call. 2026-09-21 — `node --test test/mcp-knowledge-path-scope.test.mjs test/mcp-knowledge-directory-summaries.test.mjs` green in the container (embedder-gated cases skip visibly). |
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
