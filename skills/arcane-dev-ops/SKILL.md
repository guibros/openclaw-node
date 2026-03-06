---
name: arcane-dev-ops
description: "Safe Arcane Solidity/Hardhat dev-ops: validate reviews, apply patches, add regression tests, run suites, commit/push with hygiene. Use for Pass fixes, test recovery, repo-porting, or any code+git execution in the Arcane project."
triggers:
  - "run the arcane tests"
  - "fix this failing test in arcane"
  - "commit and push the arcane changes"
  - "port these files to the arcane repo"
  - "apply this patch to the contracts"
negative_triggers:
  - "deploy the arcane contracts"
  - "write new arcane lore"
  - "check arcane security audit"
---

# Arcane DevOps

Use this workflow for high-confidence code + git execution in Arcane.

## Workflow

1. Confirm source of truth before edits:
   - Read review/requirements doc first.
   - Diff patch inputs against real contract/test files.
   - Identify the actual git repo with remote (never assume workspace root is the push repo).

2. Implement safely:
   - Apply minimal, auditable code changes.
   - Add regression tests for each bug/fix claim.
   - Prefer deterministic fixtures and explicit assertions.

3. Validate in order:
   - Run targeted tests for touched areas first.
   - Run full suite second.
   - Report pass/fail counts and root causes for any failures.

4. Commit hygiene:
   - Stage explicit file list only.
   - Avoid unrelated/untracked workspace artifacts.
   - Use clear commit message scope (`fix(...)`, `test(...)`, etc.).

5. Port/push hygiene:
   - Verify current repo path and `origin` URL before push.
   - If user has multiple local copies, port intentionally and re-run full tests in destination repo.
   - Push only after green suite unless user explicitly asks otherwise.

## Non-negotiables

- Never run destructive git commands without explicit user approval.
- Never assume the repo with code is the repo with remote.
- Prefer copying validated files over risky patch apply when paths diverge.

## Scripts

- `scripts/prepush_check.sh <repo-path> [full-test-cmd]`
  - Prints branch/remote/status/staged files and final push sanity context.

## References

- Use `references/checklist.md` for pre-push checklist.
- Use `references/validation-cases.md` for trigger/behavior smoke tests.
