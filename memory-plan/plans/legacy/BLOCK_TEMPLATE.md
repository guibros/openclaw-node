# BLOCK_TEMPLATE — copy this into memory-plan/BLOCKED.md when a tick must stop

Do not edit this template in place. Tick workers copy it (filling in placeholders) to
`memory-plan/BLOCKED.md`. The operator clears the block by **deleting `BLOCKED.md`**
after addressing the cause; the next tick will then run normally.

---

```markdown
# CONTINUATION_BLOCKED — <YYYY-MM-DD HH:MM TZ>

**Step**: <NN> (`vX.Y-<phase>`)
**Phase you were in**: <Phase 1 | Phase 4 | Phase 5 | Phase 7 | Phase 8 | Phase 8.5 | Phase 9>
**Trigger**: <one-line cause — one of the §6 block triggers from FRAMEWORK.md>

## What failed

<2-5 lines of detail. Quote the failing command output if a test/grep/gate check failed.>

## What's needed from the user

- <bullet>
- <bullet>

## How to resume

1. <action — what the human needs to do>
2. Delete `memory-plan/BLOCKED.md`.
3. The next scheduled tick will pick up where this stopped.

## State at block

- `memory-plan/VERSION`: `<value>`
- Working tree (`git status --short`):
  ```
  <paste output>
  ```
- Last successful commit: `<hash>` `<title>`
- Last completed step: `<NN>` (`v<X>.<Y>`)
- Currently-attempted step: `<NN>` (`v<X>.<Y>`)
```
