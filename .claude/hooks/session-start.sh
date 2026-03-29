#!/usr/bin/env bash
# session-start.sh — Load project context at session start.
# Hook: SessionStart
# Output goes to Claude's context as system information.

set -euo pipefail

WORKSPACE="${HOME}/.openclaw/workspace"

echo "=== Session Context ==="
echo ""

# Git state
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  echo "Branch: ${BRANCH}"
  echo ""
  echo "Recent commits:"
  git log --oneline -3 2>/dev/null || true
  echo ""
fi

# Active tasks (first 20 lines)
TASKS="${WORKSPACE}/memory/active-tasks.md"
if [ -f "$TASKS" ]; then
  echo "Active tasks:"
  head -20 "$TASKS"
  echo ""
fi

# Companion state
STATE="${WORKSPACE}/.companion-state.md"
if [ -f "$STATE" ]; then
  echo "Session state:"
  cat "$STATE"
  echo ""
fi

# Last session recap (first 15 lines)
RECAP="${WORKSPACE}/memory/last-session-recap.md"
if [ -f "$RECAP" ]; then
  echo "Last session recap:"
  head -15 "$RECAP"
fi

exit 0
