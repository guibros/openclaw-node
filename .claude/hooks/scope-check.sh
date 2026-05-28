#!/usr/bin/env bash
# scope-check.sh — Enforce memory-plan/SCOPE.md on Edit/Write/MultiEdit/NotebookEdit.
# Hook: PreToolUse (matcher: Edit|Write|MultiEdit|NotebookEdit)
#
# Reads memory-plan/SCOPE.md and blocks (exit 2) if:
#   - SCOPE.md does not exist
#   - Status is not "active"
#   - Expires is in the past
#   - The ```files block is empty or missing
#   - The file being edited is not listed (exact or shell-glob match)
#
# Always permits writes to:
#   - memory-plan/OUT_OF_SCOPE.md  (the agnostic-spec capture mechanism; MASTER_PLAN §6.2 exception)
#   - memory-plan/SCOPE.md         (so the operator can update scope without first blocking themselves)
#
# Input: JSON via stdin (Claude Code hook protocol)
# Output on block: human-readable reason to stderr
# Exit codes: 0 = allow, 2 = block

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCOPE_FILE="$REPO_ROOT/memory-plan/SCOPE.md"

# --- Parse tool input ---------------------------------------------------------

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0  # no input, can't decide — fail-open
fi

if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null || true)
else
  FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//' || true)
  if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(echo "$INPUT" | grep -o '"notebook_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//' || true)
  fi
fi

if [ -z "$FILE_PATH" ]; then
  exit 0  # tool call with no path (shouldn't happen for these matchers, but be safe)
fi

# --- Compute repo-relative path (portable; macOS realpath lacks --relative-to) ---

# Make path absolute first
if [[ "$FILE_PATH" != /* ]]; then
  FILE_PATH="$REPO_ROOT/$FILE_PATH"
fi
# Strip the repo prefix; if not under the repo, keep as-is (the check will likely fail anyway)
case "$FILE_PATH" in
  "$REPO_ROOT"/*) RELATIVE_PATH="${FILE_PATH#$REPO_ROOT/}" ;;
  *)              RELATIVE_PATH="$FILE_PATH" ;;
esac

# --- Always-allowed paths (escape valves) -------------------------------------

case "$RELATIVE_PATH" in
  memory-plan/OUT_OF_SCOPE.md)
    exit 0
    ;;
  memory-plan/SCOPE.md)
    exit 0
    ;;
esac

# --- Require SCOPE.md to exist ------------------------------------------------

if [ ! -f "$SCOPE_FILE" ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: memory-plan/SCOPE.md does not exist.

You must set today's scope before editing any file. Create memory-plan/SCOPE.md
with at minimum:
  - **Status:** active
  - a \`\`\`files block listing allowed paths

Or capture the observation in memory-plan/OUT_OF_SCOPE.md instead (always writeable).
EOF
  exit 2
fi

# --- Status must be "active" --------------------------------------------------

STATUS=$(grep -iE '^\*\*Status:\*\*' "$SCOPE_FILE" 2>/dev/null | head -1 \
  | sed -E 's/^\*\*Status:\*\*[[:space:]]*//' \
  | tr -d ' ' \
  | tr 'A-Z' 'a-z' || true)

if [ "$STATUS" != "active" ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: SCOPE.md Status is '${STATUS:-<missing>}' (must be 'active').

Refresh SCOPE.md (set Status: active + update the files block) before editing,
or write your observation to memory-plan/OUT_OF_SCOPE.md.
EOF
  exit 2
fi

# --- Expires check ------------------------------------------------------------

EXPIRES=$(grep -iE '^\*\*Expires:\*\*' "$SCOPE_FILE" 2>/dev/null | head -1 \
  | sed -E 's/^\*\*Expires:\*\*[[:space:]]*//' \
  | tr -d ' ' || true)

if [ -n "$EXPIRES" ] && [ "$EXPIRES" != "no-expiry" ]; then
  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  # ISO 8601 strings are lexically comparable when zero-padded + UTC; we accept the same shape from operator.
  if [[ "$NOW" > "$EXPIRES" ]]; then
    cat >&2 <<EOF
BLOCKED by scope-check.sh: SCOPE.md expired at $EXPIRES (now $NOW).

Refresh the Expires line (and update files/goal as needed) before editing,
or write your observation to memory-plan/OUT_OF_SCOPE.md.
EOF
    exit 2
  fi
fi

# --- Operator override --------------------------------------------------------

OVERRIDE=$(grep -iE '^\*\*Override:\*\*' "$SCOPE_FILE" 2>/dev/null | head -1 \
  | sed -E 's/^\*\*Override:\*\*[[:space:]]*//' \
  | tr -d ' ' \
  | tr 'A-Z' 'a-z' || true)

if [ "$OVERRIDE" = "true" ]; then
  exit 0  # operator has explicitly disabled scope enforcement for this session
fi

# --- Extract allowed files block ----------------------------------------------

ALLOWED=$(awk '
  /^```files[[:space:]]*$/ { flag=1; next }
  /^```[[:space:]]*$/      { flag=0 }
  flag                     { print }
' "$SCOPE_FILE")

if [ -z "$ALLOWED" ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: SCOPE.md has no \`\`\`files block (or it is empty).

Add a block of the form:

  \`\`\`files
  path/to/file/you/intend/to/edit
  another/path
  \`\`\`

Or write your observation to memory-plan/OUT_OF_SCOPE.md.
EOF
  exit 2
fi

# --- Membership check (exact or shell-glob) -----------------------------------

IS_IN_SCOPE=0
MATCHED_LINE=""
while IFS= read -r line; do
  # Trim whitespace
  trimmed=$(echo "$line" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')
  # Skip empty and comment lines
  [ -z "$trimmed" ] && continue
  case "$trimmed" in
    \#*) continue ;;
  esac

  # Exact match
  if [ "$RELATIVE_PATH" = "$trimmed" ]; then
    IS_IN_SCOPE=1
    MATCHED_LINE="$trimmed"
    break
  fi
  # Shell-glob match (e.g. "lib/*.mjs")
  case "$RELATIVE_PATH" in
    $trimmed)
      IS_IN_SCOPE=1
      MATCHED_LINE="$trimmed"
      break
      ;;
  esac
done <<< "$ALLOWED"

if [ "$IS_IN_SCOPE" -eq 0 ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: '$RELATIVE_PATH' is not in today's scope.

Today's allowed files (memory-plan/SCOPE.md):
$(echo "$ALLOWED" | sed 's/^/  /')

To proceed: either (a) add '$RELATIVE_PATH' to the \`\`\`files block in SCOPE.md
(with operator approval — drift is a structural problem), or (b) capture the
observation in memory-plan/OUT_OF_SCOPE.md and continue with the original scope.

The hook permits writes to OUT_OF_SCOPE.md and SCOPE.md unconditionally.
EOF
  exit 2
fi

# All clear
exit 0
