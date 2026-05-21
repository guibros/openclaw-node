#!/usr/bin/env bash
# pre-compact.sh — Dump session state before context compression.
# Hook: PreCompact
# Saves working state so it can be recovered after compaction.

set -euo pipefail

WORKSPACE="${HOME}/.openclaw/workspace"

# Dead write to .pre-compact-state.md removed (Step 0.6).
# Hook retained for future rewiring in Phase 4 (Block 4).

exit 0
