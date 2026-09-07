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

# Force push is REFUSED here (exit 2), whatever position the flag sits in.
# settings.json carries a matching deny list, but permission rules are prefix
# matches and cannot see `git push origin main --force`; this hook can. The
# same script runs as the git pre-push hook, so it holds outside Claude Code too.
case "$COMMAND" in
  *"--force"*|*"-f "*|*" -f"*|*" +"*)
    echo "BLOCKED by validate-push.sh: force push refused ($COMMAND)." >&2
    echo "History rewrites on a shared branch are not allowed here; push a new commit instead." >&2
    exit 2
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
