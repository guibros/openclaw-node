# DECISIONS — openviking-adopt plan (append-only)

Architectural decisions for this plan. Newest at bottom. Never rewrite an entry; supersede with
a new one.

Entry shape: **Decision** (what was chosen) · **Why** (the constraint or evidence that forced it)
· **Consequences** (what this commits us to / rules out).

---

## D1 — Borrow OpenViking's ideas, not its code or runtime (2026-09-21)

**Decision.** Implement four ideas from `volcengine/OpenViking` natively in this repo's Node
stack: (1) path-prefix scoping on knowledge search, (2) per-directory L0 abstract / L1 overview
summaries built bottom-up and hash-gated, (3) typed memory schemas with declared per-field merge
operations plus a read-before-write extraction step, (4) an OpenClaw context-engine plugin that
injects the daemon's `:7893` block in-process. Do NOT vendor OpenViking code and do NOT replace
the five local stores with an OpenViking server.

**Why.** The 2026-09-21 review found OpenViking's data model (a `viking://` filesystem with
per-directory summaries, typed YAML memory schemas with merge ops, an extractor that reads
existing memory before writing) stronger than ours on exactly the failure modes the 2026-09-06
adversarial review recorded (mention inflation, resurrection, duplicate decisions, no search
scoping), and its gateway integration (context-engine slot) is the path our companion-bridge
dependency lacks. Against that: its core is AGPL-3.0 (incompatible with this MIT repo for
vendoring), it is a ~400k-line Python/Rust/C++ monolith that defaults to cloud VLM/embedding
providers, ships unauthenticated-ROOT + wildcard-CORS defaults, and does not run its own unit
suite in PR CI. Redesign DECISIONS D1 ("keep all 5 stores, collapse nothing") also rules out a
backend swap.

**Consequences.** Every feature is additive to the existing SQLite stores (new tables/columns,
schema `user_version` bumps), deterministic without an LLM and LLM-enhanced when Ollama answers,
and testable offline. The plugin depends only on the inject server's HTTP contract, so the
daemon stays the single owner of retrieval and extraction. Merge policy is algorithmic
(declared ops), not prompt-governed as in OpenViking. Running OpenViking as a side-by-side
service remains a separate operator decision, not this plan's.

## D2 — This batch lands code; runtime closure stays per-step (2026-09-21)

**Decision.** The operator asked for the whole batch at once, so all five blocks land in one
labeled SCOPE batch and one PR, with `code:` verification run in the session container. No
INVENTORY row is closed by the batch; each closes on its `runtime:` Verify observed on the node.

**Why.** MASTER_PLAN §4.1: code on disk ≠ shipped. The session ran in a remote container with no
`~/.openclaw` runtime, no Ollama and no embedder, so runtime evidence cannot be produced here.
Fake-closing is the cardinal failure the protocol exists to prevent.

**Consequences.** After merge the operator (or a tick) deploys, restarts the daemon, observes
each step's `runtime:` line, and closes rows in order. Until then the plan reads `v0.0` with
five open blocks by design.
