#!/usr/bin/env bash
# pre-compact.sh — OpenClaw extraction trigger for Claude Code.
#
# Fires a mesh.memory.extract_request NATS event before context compaction.
# This hook is called by Claude Code's PreCompact lifecycle event.
#
# Requires: Node.js, nats npm package (installed with openclaw-nodedev).
# Env: NATS_URL (default nats://localhost:4222), OPENCLAW_NODE_ID (default hostname).

set -euo pipefail

# Resolve repo root relative to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Delegate to the shared CLI tool — fire-and-forget
node "$REPO_ROOT/bin/openclaw-extract-now.mjs" \
  --triggered-by=claude-code-pre-compact \
  2>/dev/null || true

exit 0
