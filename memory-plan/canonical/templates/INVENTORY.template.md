# {{PLAN_ID}} — Step Inventory

{{GOAL}}

Every `ROADMAP.md` block decomposed to **true atomic grain**. **One step = one
independently-verifiable runtime outcome = one 9-phase cycle = one commit** (`PROTOCOL.md` §3).
Each step carries done-evidence that is *runtime-observable* (MASTER_PLAN §5), written next to
the table, not just tests-green.

**Atomicity test (apply to every step):** does it produce exactly one verifiable behavior change?
If the Goal needs "and" between two independently-testable outcomes, split it. If the Needs span
two unrelated systems, split it. If the Verify proves two independent outcomes, split it
(PROTOCOL §11).

**Every open row requires the four-field contract** in the notes under its table — Goal · Needs
(pre-screen, checked in Phase 1; missing → BLOCK) · Feeds (post-use consumer, recorded at Phase 9)
· Verify (enforceable test tagged `runtime:` / `code:` / `visual:`). `plan-lint.sh` fails open
rows without it.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed · `[D]` deferred (deliberate; never a next step, never blocks completion).
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

> **1.1 — Goal:** <one sentence, one outcome>.
> **Needs:** <everything that must already exist: files, services, data, locked decisions>.
> **Feeds:** <where this result is consumed: step X.Y / component / viewer surface / operator workflow>.
> **Verify:** `runtime:` <probe/command + the WIN threshold that only this step's change produces> · `code:` <test/grep> · `visual:` <operator-confirmable state — drop the modalities that don't apply>.
