# BLOCK_TEMPLATE — copy this into the plan's BLOCKED.md when a tick must stop

**Canonical doc.** Synced into every plan by `workspace-bin/sync-canonical.sh`.

Do not edit this template in place. Workers copy it (filling in placeholders) to
`memory-plan/plans/<id>/BLOCKED.md` — the plan's own dir, next to its INVENTORY.md. The operator
clears the block by **deleting that BLOCKED.md** after addressing the cause; the next tick then
runs normally. While present, the viewer surfaces the plan as blocked ("needs you") and every
tick short-circuits.

---

```markdown
# CONTINUATION_BLOCKED — <YYYY-MM-DD HH:MM TZ>

**Step**: <NN> (`vX.Y-<phase>`)
**Phase you were in**: <Phase 1 | Phase 4 | Phase 5 | Phase 7 | Phase 8 | Phase 8.5 | Phase 9>
**Trigger**: <one-line cause — one of the block triggers in PROTOCOL.md §3 / TICK_PROMPT>
**External action:** <the single concrete thing the operator must DO — run a command, approve a tool, manipulate a GUI. The viewer surfaces this as "needs you". Omit the line only if no human action is required.>

## What failed

<2-5 lines of detail. Quote the failing command output if a test/grep/gate check failed.>

## What's needed from the user

- <bullet>
- <bullet>

## How to resume

1. <action — what the human needs to do>
2. Delete `memory-plan/plans/<id>/BLOCKED.md`.
3. The next scheduled tick will pick up where this stopped.

## State at block

- `memory-plan/plans/<id>/VERSION`: `<value>`
- Working tree (`git status --short`):
  ```
  <paste output>
  ```
- Last successful commit: `<hash>` `<title>`
- Last completed step: `<NN>` (`v<X>.<Y>`)
- Currently-attempted step: `<NN>` (`v<X>.<Y>`)
```
