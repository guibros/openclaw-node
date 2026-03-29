#!/usr/bin/env bash
# log-agent.sh — Audit trail for subagent spawns.
# Hook: SubagentStart
# Logs each agent invocation for debugging and analysis.

set -euo pipefail

WORKSPACE="${HOME}/.openclaw/workspace"
AUDIT="${WORKSPACE}/memory/agent-audit.log"

mkdir -p "${WORKSPACE}/memory"

# Parse input for agent details
INPUT=$(cat 2>/dev/null || true)
AGENT_TYPE=""
if command -v jq &>/dev/null; then
  AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null || echo "unknown")
else
  AGENT_TYPE="unknown"
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) agent_spawn type=${AGENT_TYPE}" >> "$AUDIT" 2>/dev/null || true

exit 0
