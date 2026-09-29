#!/bin/sh
# Append-only archive of conversation transcripts.
# Guards against Claude Code's 30-day cleanup + gateway session pruning.
# rsync WITHOUT --delete: only ever adds/updates the archive, never removes.
set -eu
ARCHIVE="$HOME/.openclaw/transcript-archive"
LOG="$ARCHIVE/archive.log"
mkdir -p "$ARCHIVE/claude-projects" "$ARCHIVE/gateway-sessions"

# Claude Code transcripts (every project slug), .jsonl only
rsync -a -m --include='*/' --include='*.jsonl' --exclude='*' \
  "$HOME/.claude/projects/" "$ARCHIVE/claude-projects/" 2>/dev/null || true

# OpenClaw gateway sessions
rsync -a -m --include='*/' --include='*.jsonl' --exclude='*' \
  "$HOME/.openclaw/agents/main/sessions/" "$ARCHIVE/gateway-sessions/" 2>/dev/null || true

ts="$(date '+%Y-%m-%d %H:%M:%S %Z')"
count=$(find "$ARCHIVE/claude-projects" "$ARCHIVE/gateway-sessions" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
size=$(du -sh "$ARCHIVE" 2>/dev/null | cut -f1)
echo "$ts  archived ok — $count transcripts, $size total" >> "$LOG"
