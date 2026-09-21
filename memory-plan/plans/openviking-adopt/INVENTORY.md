# openviking-adopt — Step Inventory

Adopt OpenViking's strongest ideas into the local memory stack: path-scoped knowledge search,
per-directory L0/L1 summaries, typed memory merge with read-before-write extraction, gateway
context-engine plugin.

**How this plan ran (2026-09-21):** the operator requested the whole batch interactively
("implement this"). The code for every step below landed in ONE labeled scope batch
(`SCOPE.md` block `2026-09-21-openviking-adopt`) with `code:` verification executed in the
session container. No row is closed by that batch: each step flips `[ ]`→`[x]` only when its
`runtime:` Verify is observed on the deployed node (MASTER_PLAN §4.1/§5). The first `[ ]` row is
therefore the operator's next runtime action, not a code task.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed · `[D]` deferred.
**Version:** `v<block>.<step>`; carrier starts at `v0.0`.
**Table format is load-bearing:** the tick engine greps rows shaped exactly
`| <block> | <b>.<s> | v<b>.<s> | [ ] | <description> |` — keep the five columns, one row per step.

---

## Block 1 — Path-scoped knowledge search

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [ ] | semantic_search and find_related accept a path_prefix and return only hits under it |

> **1.1 — Goal:** a knowledge search can be confined to one directory subtree.
> **Needs:** `lib/mcp-knowledge/core.mjs` (`semanticSearch`, `findRelated`), `server.mjs` tool schemas, a populated `.knowledge.db` on the node.
> **Feeds:** the knowledge MCP tools (Claude Code stdio + mesh HTTP); Block 2 tree navigation.
> **Verify:** `runtime:` on the node, `semantic_search {query:"memory", path_prefix:"memory/"}` returns ≥1 hit and every hit path starts with `memory/`; the same query with `path_prefix:"projects/"` returns no `memory/` path · `code:` `node --test test/mcp-knowledge-path-scope.test.mjs` green.

## Block 2 — Per-directory L0/L1 summaries

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | directory_summaries built bottom-up on every index pass with deterministic abstract/overview; knowledge_tree and directory_overview tools |
| 2 | 2.2 | v2.2 | [ ] | LLM-written abstract/overview when Ollama answers, hash-gated per directory, and directory-level vector search |

> **2.1 — Goal:** every indexed directory has an L0 abstract and an L1 overview after an index pass.
> **Needs:** step 1.1; `lib/mcp-knowledge/directory-summaries.mjs`; `indexWorkspace` calling it.
> **Feeds:** `knowledge_tree` / `directory_overview` MCP tools; `dir_abstract` on search hits.
> **Verify:** `runtime:` `sqlite3 ~/.openclaw/workspace/.knowledge.db "SELECT COUNT(*) FROM directory_summaries"` > 0 after the daemon's next index pass, and `knowledge_tree {depth:2}` shows a non-empty abstract per row · `code:` `node --test test/mcp-knowledge-directory-summaries.test.mjs` green.

> **2.2 — Goal:** with Ollama reachable, directory abstracts are LLM-written, and a query can rank directories.
> **Needs:** step 2.1; `lib/llm-client.mjs` `generateAnalysis`; the bge-m3 embedder on the node.
> **Feeds:** `search_directories` MCP tool; future tiered injection (out of plan).
> **Verify:** `runtime:` `SELECT COUNT(*) FROM directory_summaries WHERE generator='llm'` > 0 on the node, and re-running the index pass with no file change performs 0 LLM calls (daemon log) · `code:` same test file, LLM path exercised with a stub client.

## Block 3 — Typed memory merge + read-before-write extraction

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | memory-types registry with per-field merge ops applied by extraction-store (entity type immutable, aliases union, decision supersession) |
| 3 | 3.2 | v3.2 | [ ] | extractor is shown known-memory candidates and its ref/aliases/supersedes fields resolve to existing rows |

> **3.1 — Goal:** the store merges an incoming memory into an existing row by declared field ops instead of ad-hoc upserts.
> **Needs:** `lib/extraction-store.mjs` schema v6 (`entities.aliases`, `decisions.superseded_by`), `lib/memory-types.mjs`.
> **Feeds:** step 3.2; `generateMemoryContent`; injector/retrieval (superseded decisions excluded).
> **Verify:** `runtime:` on the node after the daemon restarts, `sqlite3 ~/.openclaw/state.db "PRAGMA user_version"` = 6 and `entity_aliases` exists · `code:` `node --test test/memory-types.test.mjs test/extraction-merge.test.mjs test/extraction-store.test.mjs` green.

> **3.2 — Goal:** a re-mention of a known entity under a new spelling lands as an alias, not a new row.
> **Needs:** step 3.1; `lib/extraction-prompt.mjs` known-memories section; `pre-compression-flush.mjs` passing candidates.
> **Feeds:** `memory.extracted` event (aliases_resolved, decisions_superseded counts); MEMORY.md.
> **Verify:** `runtime:` on the node after live flushes, `sqlite3 ~/.openclaw/state.db "SELECT COUNT(*) FROM entity_aliases"` ≥ 1 or `"SELECT COUNT(*) FROM decisions WHERE superseded_by IS NOT NULL"` ≥ 1, and `entities` row count is unchanged on a re-flush of the same tail (the daemon log line for the flush shows `aliases_resolved`; the event payload does not carry it yet — OUT_OF_SCOPE) · `code:` `node --test test/extraction-merge.test.mjs test/extraction-prompt.test.mjs test/extraction-store.test.mjs` green.

## Block 4 — OpenClaw context-engine plugin

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | gateway loads packages/openclaw-memory-context-engine in plugins.slots.contextEngine and assemble() injects the :7893 memory block |

> **4.1 — Goal:** the gateway receives the memory block natively, without companion-bridge.
> **Needs:** `packages/openclaw-memory-context-engine/{openclaw.plugin.json,index.js}`; the daemon's inject server on :7893 with its token file; OpenClaw ≥ 2026.5.27 on the node.
> **Feeds:** every gateway turn's system prompt; `memory.injected` events with `frontend: "openclaw-context-engine"`.
> **Verify:** `runtime:` `openclaw config get plugins.slots.contextEngine` = `openclaw-node-memory` and the next `memory.injected` event on the node carries `frontend: "openclaw-context-engine"` · `code:` `node --test test/openclaw-context-engine.test.mjs` green (fake inject server).

## Block 5 — Docs

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | CLAUDE.md queued-repair paragraph no longer lists the closed /api/ps false-busy skip; README documents the plugin |

> **5.1 — Goal:** CLAUDE.md's runtime-repair list matches the protocol ledger.
> **Needs:** `memory-plan/plans/protocol/OUT_OF_SCOPE.md` v4.1 close record.
> **Feeds:** every future session's bootstrap read.
> **Verify:** `code:` `grep -c "api/ps" CLAUDE.md` = 0.
