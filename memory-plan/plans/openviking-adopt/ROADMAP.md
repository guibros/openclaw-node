# openviking-adopt — Roadmap

**Goal.** Adopt OpenViking's strongest ideas into the local memory stack without adopting its
code (AGPL-3.0) or its runtime (a 400k-line Python/Rust/C++ server): path-scoped knowledge
search, per-directory L0/L1 summaries, typed memory merge with read-before-write extraction,
and a native OpenClaw context-engine plugin.
**Created:** 2026-09-21
**Origin:** the 2026-09-21 review of `volcengine/OpenViking` against this repo. The review's
comparison table is reproduced in DECISIONS D1.

## Block 1 — Path-scoped knowledge search

- **Intent:** the knowledge server's `semantic_search` / `find_related` accept a directory
  prefix, so an agent can search "only the lore" or "only memory/" instead of the whole index.
  OpenViking scopes every query to a `viking://` subtree; here scoping was index-time only.
- **Exit criterion (runtime-observable):** `semantic_search {query, path_prefix:"memory/"}`
  over the live `.knowledge.db` returns only paths under `memory/`, and the same query without
  the prefix returns at least one path outside it.
- **Unblocks:** Block 2 (tree navigation needs prefix-scoped search to be useful).

## Block 2 — Per-directory L0/L1 summaries

- **Intent:** every indexed directory carries an L0 abstract (one line) and an L1 overview
  (children with their abstracts), built bottom-up and hash-gated so unchanged subtrees cost
  nothing. Deterministic when no LLM is reachable; LLM-written when Ollama answers. Exposed as
  `knowledge_tree` and `directory_overview` MCP tools, as `dir_abstract` on every search hit,
  and as a directory-level vector search so an agent can find the right folder before the
  right file.
- **Exit criterion (runtime-observable):** after one index pass on the node,
  `SELECT COUNT(*) FROM directory_summaries` > 0 in `.knowledge.db`, and `knowledge_tree {depth:2}`
  returns the workspace tree with a non-empty abstract per directory.
- **Unblocks:** terminal (feeds the inject block later, out of this plan).

## Block 3 — Typed memory merge + read-before-write extraction

- **Intent:** memory kinds (entity, theme, decision) carry a declared per-field merge
  operation (immutable / replace / max / union / supersede) applied by the store instead of
  ad-hoc upserts, and the extractor is shown the known memories relevant to the transcript
  before it writes, so a re-mention resolves to an existing row (alias) and a changed decision
  supersedes rather than duplicates. This is the structural fix for the review's amplifier
  findings (mention inflation, resurrection, duplicate decisions).
- **Exit criterion (runtime-observable):** a live flush on the node emits `memory.extracted`
  whose stored rows show ≥1 entity alias resolved to an existing id (`entities.aliases` non-empty)
  or ≥1 decision with `superseded_by` set, and `entities` row count does not grow for a
  re-flush of the same tail.
- **Unblocks:** terminal.

## Block 4 — OpenClaw context-engine plugin

- **Intent:** the gateway loads `packages/openclaw-memory-context-engine` in its
  `plugins.slots.contextEngine` slot; `assemble()` calls the daemon's loopback
  `POST /memory/inject` and returns the block as the system-prompt addition. This replaces the
  dependency on the external companion-bridge proxy (down at the last probe) with the path
  OpenViking uses.
- **Exit criterion (runtime-observable):** with the plugin installed and the daemon up, the
  gateway's next turn shows `[memory: recent relevant context]` in its system prompt (gateway
  debug log or `memory.injected` event with `frontend: "openclaw-context-engine"`).
- **Unblocks:** terminal.

## Block 5 — Docs

- **Intent:** CLAUDE.md's "queued runtime repair" paragraph no longer lists the `/api/ps`
  false-busy skip that the protocol ledger closed at v4.1; README documents the plugin.
- **Exit criterion:** `grep -c "api/ps" CLAUDE.md` = 0.
- **Unblocks:** terminal.
