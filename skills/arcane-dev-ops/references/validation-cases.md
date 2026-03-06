# Validation Cases

## Trigger checks
- "Apply pass 10 review, run tests, commit safely, then push"
- "Port changes from temp repo to real Arcane repo and verify remote"

## Expected behavior
- Reads review doc first
- Runs targeted tests then full suite
- Stages explicit files only
- Verifies repo path + remote before push
