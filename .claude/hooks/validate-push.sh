#!/usr/bin/env bash
# validate-push.sh — Pre-push validation hook.
# Hook: PreToolUse (matcher: Bash)
# Warns on pushes to protected branches.

INPUT=$(cat 2>/dev/null || true)
COMMAND=""
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
else
  COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//' || true)
fi

# Only validate git push commands
case "$COMMAND" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

# Check for force push (blocked by settings.json deny, but belt-and-suspenders)
case "$COMMAND" in
  *"--force"*|*"-f "*|*" -f"*)
    echo "WARNING: Force push detected. This can destroy remote history."
    ;;
esac

# Check target branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
case "$BRANCH" in
  main|master|production|release)
    echo "WARNING: Pushing directly to protected branch '$BRANCH'."
    echo "Consider using a feature branch and pull request instead."
    ;;
esac

exit 0
