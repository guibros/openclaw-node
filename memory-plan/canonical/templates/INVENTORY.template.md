# {{PLAN_ID}} — Step Inventory

{{GOAL}}

Every `ROADMAP.md` block decomposed to **true atomic grain**. **One step = one
independently-verifiable runtime outcome = one 9-phase cycle = one commit** (`PROTOCOL.md` §3).
Each step carries done-evidence that is *runtime-observable* (MASTER_PLAN §5), written next to
the table, not just tests-green.

**Atomicity test (apply to every step):** does it produce exactly one verifiable behavior change?
If describing it needs "and" between two independently-testable outcomes, split it.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed.
**Version:** `v<block>.<step>`; carrier starts at `v0.0`.
**Table format is load-bearing:** the tick engine greps rows shaped exactly
`| <block> | <b>.<s> | v<b>.<s> | [ ] | <description> |` — keep the five columns, one row per step.

Every block boundary triggers the **macro Re-Orient** (PROTOCOL §5.2); every step opens with the
**micro Re-Orient** (PROTOCOL §5.1).

---

## Block 1 — <name the first milestone>

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [ ] | <first atomic step> |

> **1.1:** <done-evidence: the log line / SQL count / HTTP probe / process state that only this step's change produces>.
