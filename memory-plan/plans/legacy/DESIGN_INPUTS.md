# Design Inputs — What the Memory Redesign Must Honor

**Date:** 2026-05-27. **Source:** reading the full "old memory-plan" corpus — the `memory-plan/` framework docs (REFERENCE_PLAN, RESUME, the reviews, HANDOFF, MEMORY_SYSTEM_MAP) + the workspace memory logs/summaries (`~/.openclaw/workspace/memory/` back to Feb 2026).

This is **not a plan**. It's the distilled intent + constraints + scars that any redesign of the memory infrastructure must start from. The redesign proposal (when it happens) should be checkable against this document.

---

## 1. The north star: Karpathy's "LLM Wiki" (3-layer knowledge base)

The operator returned to [Karpathy's LLM Wiki gist] repeatedly across April–May 2026. It is the recurring design reference for what the memory/knowledge layer should *be*:

| Layer | Karpathy | OpenClaw mapping (intended) |
|---|---|---|
| 1. Raw sources | immutable docs | session transcripts (JSONL → state.db) |
| 2. **Wiki** | LLM-generated markdown pages that **synthesize + cross-link** the raw | concept notes / Obsidian vault — auto-written, cross-linked |
| 3. Index | navigation over the wiki | the graph (wikilinks / adjacency) + retrieval |

**The load-bearing word is "synthesize."** The point isn't to store more rows — it's to turn raw history into a small set of readable, cross-linked pages a human (or agent) can actually navigate. The current system stores 1039 entities / 2074 mentions but produces no readable synthesis; its daily logs are lossy noise (§4). That inverts the intent.

**Redesign implication:** the synthesis layer (LLM turns raw → wiki pages) is the heart, not an afterthought. Retrieval/extraction/federation are in service of it.

## 2. The operator's architectural taste: one hop, no bullshit

Direct evidence from the logs — the observability refactor the operator celebrated:

> "ANY component → tracer.emit() → SQLite → MC reads it → UI. One hop. That's it."
> *(136 lines added, 227 removed — net negative, and that was the win.)*

And: *"Done. Terminal log viewer. One stream. Every event inline. No bullshit."*

**This is the opposite of what the memory system became:** 7-component daemon, 5-channel retrieval, event-sourced dual-write, 2-layer federation, 10 phases, 59 steps. The ambition outran the taste.

**Redesign implication:** bias hard toward the fewest moving parts that deliver the Karpathy-wiki intent. Every component must justify its existence against "could this be one hop fewer?" Prefer deleting over adding. A redesign that adds a 6th store is suspect.

## 3. The tension to resolve (the core lesson)

- The **framework docs** (REFERENCE_PLAN's 10 phases, federation, 5 stores) encode *ambition*.
- The **workspace logs** encode *taste*: simplicity, one-hop, the wiki concept, "no bullshit."

The current state — 59 "closed" steps, ~0 working production output, lossy logs, a 4-day repo/runtime gap, crash loops — is what you get when ambition runs without taste as a brake.

**Redesign implication:** the redesign's job is NOT to finish the federation cathedral. It's to serve the Karpathy-wiki intent with one-hop simplicity. Federation, event-sourcing, spreading-activation, broadcast protocol are all *optional* and must each re-earn their place against the simplicity bar. Local-first, single-node, readable-synthesis is the core; everything else is opt-in.

## 4. The current memory output is the thing most broken

Reading the workspace logs surfaced that the memory system's primary *readable* surface is near-useless (captured in `OUT_OF_SCOPE.md`): daily logs truncated at ~150 chars, the same hourly snapshot repeated ~18×/day, monthly summaries that concatenate the repetition, stale boilerplate "Files Modified" lists.

**Redesign implication:** "did we produce a readable, accurate synthesis of what happened?" is the acceptance test for the memory system — not "did extraction write rows." If the daily/weekly output isn't something the operator would actually read, the system has failed regardless of internal sophistication.

## 5. Hard operating constraints (from the deployment memory + the scars)

- **Consumer hardware.** MacBook / mid-range Linux. Tiered local LLM (qwen3:8b floor). No big-RAM assumptions.
- **Multilingual.** Non-English content is in scope — embedding model must handle it (BGE-M3 class, not English-only MiniLM).
- **LLM-frontend-agnostic.** The harness (companion-bridge `harness.ts`) sits between any OpenAI-compatible client and any LLM. Memory works for Claude / Kimi / DeepSeek / local Qwen alike.
- **Health-checked, no crash-loops.** Scar: the memory daemon once crash-looped **13,834×** (every 10s), burning tokens. Scar: `knowledge.db` WAL **bloated to 331 MB** because checkpoints never fired. The redesign must self-monitor, restart cleanly, and manage its own storage (WAL checkpointing, busy_timeout, integrity checks).
- **Local-first, federation-second.** Single node must work fully offline. Federation is opt-in, never a precondition.

## 6. What's confirmed about the runtime (so the redesign starts from truth)

- The **harness** (rule + memory injection) lives in companion-bridge's `harness.ts`, NOT the gateway or Claude Code. It's the real injection point.
- The **production memory daemon** is `~/.openclaw/workspace/bin/memory-daemon.mjs` (a deployed copy), reading `~/.openclaw/workspace/lib/` — a tree that drifts from the dev repo because nothing auto-deploys (MASTER_PLAN §4.1).
- Extraction **does** run (1039 entities etc. in state.db) but degraded — `mentions.turn_index` always NULL, many extractions fail Zod validation silently.
- Federation / consolidation / event-log are **not deployed** (code-on-disk only).
- See `COMPONENT_REGISTRY.md` for the full current-state inventory and `AUDIT_2026-05-27.md` for the verified audit.

## 7. Open design questions the redesign must answer (not answered here)

1. **Does the redesign keep SQLite + Obsidian, or collapse stores?** The Karpathy model wants raw + wiki + index — that could be 2 stores, not 5.
2. **Is the synthesis layer scheduled (consolidation cycle) or streaming (on session end)?** The one-hop taste argues for the simplest trigger.
3. **What is the minimum viable memory daemon?** Ingest + synthesize + serve-injection might be the whole thing; everything else is optional.
4. **Does federation survive the simplicity bar at all,** or get cut to "single-node first, revisit if a second node ever exists"?
5. **What's the readable weekly/daily artifact** that replaces the lossy logs, and what writes it?
6. **The "memory watcher"** the operator described as indispensable for debug/QA — what does it watch, and does it need an event log to exist (which would pull event-sourcing back in)?

These get decided WITH the operator at redesign-planning time, logged in `DECISIONS.md`, and only then turned into scoped work.

---

## How to use this doc

When the memory redesign is proposed, check it against §1–§5. If a proposed component doesn't serve the Karpathy-wiki intent (§1), can't survive the one-hop bar (§2), or reintroduces the ambition-over-taste failure (§3), it needs explicit justification logged in DECISIONS.md before it's built. §7 is the agenda for the redesign-planning session.
