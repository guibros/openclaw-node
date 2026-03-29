#!/usr/bin/env bash
# session-stop.sh — End-of-session housekeeping.
# Hook: Stop
# Logs session summary to daily memory file.

set -euo pipefail

WORKSPACE="${HOME}/.openclaw/workspace"
TODAY=$(date +%Y-%m-%d)
DAILY="${WORKSPACE}/memory/${TODAY}.md"

# Ensure memory directory exists
mkdir -p "${WORKSPACE}/memory"

{
  echo ""
  echo "### Session ended $(date -u +%H:%M:%S) UTC"

  if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    COMMITS=$(git log --oneline --since="1 hour ago" 2>/dev/null | wc -l | tr -d ' ')
    CHANGED=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
    echo "- Commits in last hour: ${COMMITS}"
    echo "- Uncommitted changes: ${CHANGED} files"
  fi
} >> "$DAILY" 2>/dev/null || true

exit 0
