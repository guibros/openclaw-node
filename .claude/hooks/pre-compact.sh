#!/usr/bin/env bash
# pre-compact.sh — Dump session state before context compression.
# Hook: PreCompact
# Saves working state so it can be recovered after compaction.

set -euo pipefail

WORKSPACE="${HOME}/.openclaw/workspace"
STATE_FILE="${WORKSPACE}/.pre-compact-state.md"

{
  echo "# Pre-Compact State Dump"
  echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""

  # Current git state
  if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
    echo "## Git State"
    echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    echo ""
    echo "Modified files:"
    git diff --name-only 2>/dev/null || true
    echo ""
    echo "Staged files:"
    git diff --cached --name-only 2>/dev/null || true
    echo ""
  fi

  # WIP markers
  echo "## WIP Markers"
  grep -rn "WIP\|FIXME\|HACK\|XXX" --include="*.js" --include="*.ts" --include="*.md" . 2>/dev/null | head -10 || echo "None found"
  echo ""

  # Current companion state
  if [ -f "${WORKSPACE}/.companion-state.md" ]; then
    echo "## Companion State"
    cat "${WORKSPACE}/.companion-state.md"
    echo ""
  fi

} > "$STATE_FILE" 2>/dev/null || true

exit 0
