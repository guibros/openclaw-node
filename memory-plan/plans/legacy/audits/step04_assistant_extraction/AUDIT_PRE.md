# AUDIT_PRE — Step 0.4: Include assistant-role messages in extraction + add speaker field + new patterns

**Version:** v0.4-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

`extractFacts` in `lib/pre-compression-flush.mjs` currently filters `role === 'user'` only (line 162), discarding half the conversational signal. Assistant messages contain decisions, environment facts, and action declarations that are durable and worth extracting. This step:

1. Opens the role filter to include assistant messages.
2. Adds assistant-voice regex patterns (agent actions, findings).
3. Adds a `speaker` field on each extracted fact so downstream consumers (including MEMORY.md formatting) can attribute provenance.
4. Updates `mergeFacts` to format entries with `[speaker]` prefix and strip speaker tags during similarity comparison.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.4 | v0.4 | [A] | Include assistant-role messages in extraction + add speaker field + new patterns |

## §3 — Design decisions (consumed from Step 0.3 AUDIT_POST §6)

- Test baseline is now 472 tests (399 pass, 73 fail pre-existing). +5 tests from Step 0.3.
- The `confidence` field returned by `extractFacts` is still unused — deferred to Step 0.6 (delete dead artifacts).
- `extractFacts` still filters `role === 'user'` only. This step changes that.
- The `crypto` import in `pre-compression-flush.mjs` is now at line 20. Edits aware of shifted line numbers.
- `cleanParentheticalChains` is idempotent and low-cost. No action needed.

Additional design decision for this step:
- **Speaker tag format:** `[user]` / `[assistant]` prefix on fact text in MEMORY.md. A `stripSpeaker` helper strips the tag before similarity comparison, paralleling `stripSupersedes`.
- **New patterns scope:** Two new pattern groups for assistant voice: (1) agent actions/intents (`I'll`, `I'm going to`, `I will`, `let me`), (2) agent findings (`I found`, `I noticed`, `the issue is`, `the problem is`, `this is because`). These are conservative — they capture high-signal assistant statements without being overly broad.

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Assistant messages may produce lower-quality facts (tool output, code blocks) | LOW | The existing patterns are specific enough to avoid matching raw code. Tool output typically has `role === 'tool'`, not `'assistant'`. |
| Speaker tag prefix changes bigram similarity for existing entries | LOW | `stripSpeaker` ensures the tag is removed before comparison. New facts merge correctly against existing untagged entries. |
| New patterns too broad → noise from assistant verbosity | LOW | Patterns require 10+ char captures and specific prefixes. Can tighten in a later step if noise is observed. |

## §5 — Deferrals

- Rendering speaker attribution differently (e.g., footnotes vs. inline tags) — deferred to a future UX step.
- Filtering tool-role messages for structured data extraction — out of scope (not present in tail messages from transcript-parser).
- `confidence` field cleanup — deferred to Step 0.6.

## §6 — Phase 4 implementation outline

| # | File | Delta description |
|---|------|-------------------|
| 1 | `lib/pre-compression-flush.mjs` | Add `stripSpeaker(text)` helper function below `stripSupersedes` (~line 194): removes `[user] ` or `[assistant] ` prefix from text |
| 2 | `lib/pre-compression-flush.mjs` | Add two assistant-voice pattern groups to `patterns` array (~line 158): agent actions (`I'll/I'm going to/I will/let me`) and agent findings (`I found/I noticed/the issue is/the problem is/this is because`) |
| 3 | `lib/pre-compression-flush.mjs` | Change role filter (~line 162) from `if (msg.role !== 'user') continue;` to `if (msg.role !== 'user' && msg.role !== 'assistant') continue;` |
| 4 | `lib/pre-compression-flush.mjs` | Add `speaker: msg.role` to fact objects pushed at ~line 176 |
| 5 | `lib/pre-compression-flush.mjs` | Update `mergeFacts` to: (a) destructure `speaker` from facts, (b) format entries with `[speaker] ` prefix, (c) use `stripSpeaker` + `stripSupersedes` in similarity comparison |
| 6 | `test/memory-budget.test.mjs` | Add `extractFacts assistant extraction` describe block with tests: assistant messages included, speaker field present, assistant-voice patterns match, mixed-role extraction ordering, mergeFacts with speaker tags |

Expected test additions: 5 new tests. New baseline target: 477 (472 + 5).
