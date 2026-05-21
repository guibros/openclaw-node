# AUDIT_PRE — Step 0.3: Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup)

**Version:** v0.3-pre
**Date:** 2026-05-21
**Author:** memory-plan-tick

---

## §1 — Intent

Fix the `mergeFacts` merge path in `lib/pre-compression-flush.mjs` which currently
accumulates parenthetical chains of the form `"<old> (updated: <new>)"`. After N merges,
entries become unreadably long and waste budget characters on stale information. Replace
with a clean "supersedes" model: write the NEW fact verbatim plus an invisible HTML
comment `<!-- supersedes: <old-text-hash> -->`. Add a one-time cleanup function that
strips existing `(updated: …)` chains from MEMORY.md content. Add a regression test
that runs `mergeFacts` 10 times on similar facts and verifies the output stays clean.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 0 | 0.3 | v0.3 | [A] | Fix mergeFacts parenthetical chain (supersedes-event-id comment model + one-time cleanup) |

## §3 — Design decisions (consumed from Step 0.2 AUDIT_POST §6)

- The `COMPANION` variable name in `daily-log-writer.mjs` still says "COMPANION" but now points to `.daemon-state-${NODE_ID}.md`. Cosmetic rename deferred. No interaction with this step.
- `.claude/hooks/session-start.sh` is sandbox-restricted. Step 0.6 needs operator pre-apply workaround. No interaction with this step.
- Test baseline: 467 tests (394 pass, 73 fail pre-existing). No test additions from Step 0.2.
- `memory-daemon.mjs` NODE_ID constant does not interact with mergeFacts. No collision.

### Supersedes-ID approach

The REFERENCE_PLAN specifies `<!-- supersedes-event-id: <id> -->`. Since event IDs
(Phase 1, Step 1.2) do not yet exist, the comment will use a short content hash of the
superseded entry text: `<!-- supersedes: <8-char-hex> -->`. This is forward-compatible —
Phase 1 can switch to real event IDs when they exist. The hash serves only as a
machine-readable breadcrumb; it has no consumers yet.

The HTML comment format ensures:
1. Invisible when MEMORY.md is rendered into a prompt (HTML comments are stripped by LLMs).
2. No parenthetical accumulation — each merge writes the NEW fact clean.
3. Budget cost is fixed (~30 chars per comment) regardless of merge count.

### Cleanup function

A `cleanParentheticalChains(content)` function will regex-strip all `(updated: …)` chains
from existing MEMORY.md content, keeping only the innermost (most recent) segment of each
chain. This runs once at the top of `mergeFacts` to clean legacy entries.

Pattern: `/ \(updated: (.+?)\)$/` applied greedily to each bullet line. If nested, the
outermost `(updated: ...)` is stripped and the process repeats until no parentheticals remain.
The final remaining text is the most recent fact.

### parseMemoryMd adjustment

`parseMemoryMd` extracts `entry.text` from bullet lines. The similarity check needs to
compare clean text (sans HTML comments). A small helper `stripSupersedes(text)` removes
`<!-- supersedes: ... -->` before similarity comparison. This prevents the hash from
polluting bigram similarity scores.

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Cleanup regex strips legitimate parentheticals from user-authored facts | LOW | The `(updated: ...)` pattern is machine-generated and unlikely to appear in user text. The regex anchors to end-of-line and the exact `(updated: ` prefix. |
| 2 | HTML comments visible in some MEMORY.md renderers | LOW | Standard markdown renderers strip HTML comments. Even if visible, they're short and non-disruptive. |
| 3 | Content hash collisions produce misleading supersedes markers | LOW | The hash is a breadcrumb only, not a lookup key. Collision has zero functional impact. |

## §5 — Deferrals

- Full event-ID provenance (Step 1.2) will replace content hashes with real UUIDs.
- The `confidence` field returned by `extractFacts` is unused — deferred to Step 0.6 (delete dead artifacts).
- `extractFacts` filtering `role === 'user'` only — deferred to Step 0.4.

## §6 — Phase 4 implementation outline

| # | File | Delta description |
|---|------|-------------------|
| 1 | `lib/pre-compression-flush.mjs` | Add `stripSupersedes(text)` helper (~3 lines). Used in similarity comparison to ignore HTML comments. |
| 2 | `lib/pre-compression-flush.mjs` | Add `cleanParentheticalChains(content)` function (~15 lines). Strips `(updated: ...)` chains from bullet lines, keeping only the most recent segment. |
| 3 | `lib/pre-compression-flush.mjs` | Modify `mergeFacts()` merge path (lines 246-251): replace parenthetical append with new-fact-verbatim + `<!-- supersedes: <hash> -->` comment. Call `cleanParentheticalChains` on input content at function entry. Adjust similarity comparison to use `stripSupersedes`. |
| 4 | `test/memory-budget.test.mjs` | Add `describe('mergeFacts parenthetical regression')` block with tests: (a) 10 sequential merges stay clean, (b) cleanParentheticalChains strips nested chains, (c) supersedes comment is present after merge. |
