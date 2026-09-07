#!/usr/bin/env bash
# scope-check.sh — Enforce per-plan SCOPE.md on Edit/Write/MultiEdit/NotebookEdit.
# Hook: PreToolUse (matcher: Edit|Write|MultiEdit|NotebookEdit)
#
# Model: each plan is siloed under memory-plan/plans/<id>/ and owns its own
# SCOPE.md. This hook scans every memory-plan/plans/*/SCOPE.md, keeps those whose
# Status is "active" AND not past Expires, and unions their ```files blocks into
# the allow-list. An edit is permitted if it matches any active plan's files block
# (exact, or a glob where `*`/`?` never cross a `/` and `**` may). A block whose
# fence ends with the word `closed` (```files <label> closed) is a shipped batch —
# excluded from the union, so finished work re-locks without deleting its record.
#
# Posture (2026-09-06 review, finding I4 — the hook was the only mechanically
# enforced gate in the repo and it was bypassable):
#   - FAIL CLOSED on empty or pathless input. The old "can't decide → allow" was
#     the wrong default for a write gate.
#   - REFUSE `..` segments outright, and resolve symlinks: a path that is lexically
#     inside the repo but physically outside (symlink escape) is blocked even when
#     the lexical path is listed.
#   - Glob `*` no longer matches `/` (a `test/*` line unlocked `test/../CLAUDE.md`
#     and, via case-pattern semantics, everything under test/ recursively).
#   - Paths outside the repo (a scratchpad in /tmp) are NOT this hook's business:
#     allowed. The scope contract governs repo files.
#
# Backward-compat: if no per-plan scopes exist yet, falls back to the legacy
# single gate at memory-plan/SCOPE.md with identical semantics.
#
# Always permits writes to (escape valves):
#   - memory-plan/plans/*/SCOPE.md, memory-plan/plans/*/OUT_OF_SCOPE.md
#   - memory-plan/SCOPE.md, memory-plan/OUT_OF_SCOPE.md   (legacy / shared root)
#
# Per-scope operator override: a SCOPE.md carrying `**Override:** true` disables
# enforcement (that scope contributes an unconditional allow).
#
# Input: JSON via stdin (Claude Code hook protocol)
# Output on block: human-readable reason to stderr
# Exit codes: 0 = allow, 2 = block

set -euo pipefail

# Physical path (symlinks resolved) so it compares consistently with canonicalized targets.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
PLANS_DIR="$REPO_ROOT/memory-plan/plans"
LEGACY_SCOPE="$REPO_ROOT/memory-plan/SCOPE.md"

block() { printf '%s\n' "$1" >&2; exit 2; }

# --- Parse tool input (fail closed) ------------------------------------------

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  block "BLOCKED by scope-check.sh: empty hook input — the target path cannot be determined, so the write is refused (fail closed)."
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
  block "BLOCKED by scope-check.sh: tool input carries no file_path/notebook_path — refused (fail closed)."
fi

# --- Canonicalize the target -------------------------------------------------

if [[ "$FILE_PATH" != /* ]]; then
  FILE_PATH="$REPO_ROOT/$FILE_PATH"
fi

# `..` segments are refused outright: the only reason to spell a repo path with
# `..` is to leave the directory a scope line named.
if [[ "/$FILE_PATH/" == *"/../"* ]]; then
  block "BLOCKED by scope-check.sh: path traversal ('..' segment) refused: $FILE_PATH"
fi

# Follow a symlinked FINAL component (bounded chain), then resolve the deepest
# existing ancestor physically (cd + pwd -P follows directory symlinks) and
# re-attach the not-yet-existing tail. Portable: no readlink -f / realpath needed.
resolve_link_chain() {
  local p="$1" i=0 t
  while [ -L "$p" ] && [ "$i" -lt 8 ]; do
    t="$(readlink "$p")"
    case "$t" in /*) p="$t" ;; *) p="$(dirname "$p")/$t" ;; esac
    i=$((i + 1))
  done
  printf '%s' "$p"
}
canon() {
  local p="$1" rest=""
  while [ ! -d "$p" ]; do
    rest="/$(basename "$p")$rest"
    p="$(dirname "$p")"
    [ "$p" = "/" ] && break
  done
  local dir
  dir="$(cd "$p" 2>/dev/null && pwd -P || printf '%s' "$p")"
  [ "$dir" = "/" ] && dir=""
  printf '%s%s' "$dir" "$rest"
}

TARGET="$(resolve_link_chain "$FILE_PATH")"
if [[ "/$TARGET/" == *"/../"* ]]; then
  block "BLOCKED by scope-check.sh: symlink target uses '..' — refused: $FILE_PATH -> $TARGET"
fi
CANON="$(canon "$TARGET")"

LEXICAL_INSIDE=0; [[ "$FILE_PATH" == "$REPO_ROOT"/* ]] && LEXICAL_INSIDE=1
CANON_INSIDE=0;   [[ "$CANON" == "$REPO_ROOT"/* ]] && CANON_INSIDE=1

if [ "$LEXICAL_INSIDE" -eq 0 ] && [ "$CANON_INSIDE" -eq 0 ]; then
  exit 0   # not a repo file (scratchpad, /tmp, $HOME): the scope contract does not govern it
fi
if [ "$LEXICAL_INSIDE" -eq 1 ] && [ "$CANON_INSIDE" -eq 0 ]; then
  block "BLOCKED by scope-check.sh: symlink escape — $FILE_PATH resolves outside the repo ($CANON)."
fi

RELATIVE_PATH="${CANON#$REPO_ROOT/}"

# --- Always-allowed paths (escape valves) -------------------------------------

case "$RELATIVE_PATH" in
  memory-plan/SCOPE.md|memory-plan/OUT_OF_SCOPE.md)
    exit 0 ;;
  memory-plan/plans/*/SCOPE.md|memory-plan/plans/*/OUT_OF_SCOPE.md)
    # (a shell `case` here is fine: the two literal segments pin the shape)
    exit 0 ;;
esac

# --- Helpers ------------------------------------------------------------------

# Read a **Field:** value from a SCOPE.md (lowercased, whitespace-stripped).
scope_field() {
  local file="$1" field="$2"
  grep -iE "^\*\*${field}:\*\*" "$file" 2>/dev/null | head -1 \
    | sed -E "s/^\*\*${field}:\*\*[[:space:]]*//" \
    | tr -d ' ' | tr 'A-Z' 'a-z' || true
}

# Extract the ```files block(s) from a SCOPE.md. A fence may carry a label and
# a lifecycle word: ```files <label> [closed]``` — blocks marked `closed` are
# batches whose work shipped; their files are pruned from the allow-list.
scope_files() {
  awk '
    /^```files([[:space:]]|$)/ {
      flag = ($0 ~ /[[:space:]]closed[[:space:]]*$/) ? 0 : 1; next
    }
    /^```[[:space:]]*$/ { flag=0 }
    flag                { print }
  ' "$1"
}

# Is this scope file active and unexpired? echo "active" / "override" / "" .
# Expires must be `no-expiry` or an ISO-8601 UTC instant; anything else is
# treated as expired (fail closed) rather than as "never".
scope_active_state() {
  local file="$1"
  [ -f "$file" ] || { echo ""; return; }
  local status expires override now
  status=$(scope_field "$file" "Status")
  [ "$status" = "active" ] || { echo ""; return; }
  expires=$(scope_field "$file" "Expires")
  if [ -n "$expires" ] && [ "$expires" != "no-expiry" ]; then
    if ! [[ "$expires" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}t[0-9]{2}:[0-9]{2}(:[0-9]{2})?z$ ]]; then echo ""; return; fi
    now=$(date -u +%Y-%m-%dt%H:%M:%Sz)   # lowercased to match scope_field output
    if [[ "$now" > "$expires" ]]; then echo ""; return; fi
  fi
  override=$(scope_field "$file" "Override")
  if [ "$override" = "true" ]; then echo "override"; return; fi
  echo "active"
}

# Glob → ERE: `*` and `?` stay within one path segment; `**` spans segments.
glob_to_regex() {
  local g="$1" out="" i c
  for ((i = 0; i < ${#g}; i++)); do
    c="${g:i:1}"
    case "$c" in
      '*')
        if [ "${g:i+1:1}" = '*' ]; then out+='.*'; i=$((i + 1)); else out+='[^/]*'; fi ;;
      '?') out+='[^/]' ;;
      '.'|'+'|'('|')'|'['|']'|'{'|'}'|'^'|'$'|'|'|'\') out+="\\$c" ;;
      *) out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}

# --- Collect active scopes ----------------------------------------------------

SCOPE_FILES=()
if [ -d "$PLANS_DIR" ]; then
  for s in "$PLANS_DIR"/*/SCOPE.md; do
    [ -f "$s" ] && SCOPE_FILES+=("$s")
  done
fi
# Legacy fallback only when no per-plan scopes exist at all.
if [ "${#SCOPE_FILES[@]}" -eq 0 ] && [ -f "$LEGACY_SCOPE" ]; then
  SCOPE_FILES+=("$LEGACY_SCOPE")
fi

if [ "${#SCOPE_FILES[@]}" -eq 0 ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: no SCOPE.md found.

Expected an active scope at memory-plan/plans/<id>/SCOPE.md (or legacy
memory-plan/SCOPE.md). Create one with **Status:** active and a \`\`\`files block,
or capture the observation in an OUT_OF_SCOPE.md (always writeable).
EOF
  exit 2
fi

# --- Evaluate scopes: gather allow-list from every active scope ---------------

ALLOWED=""
ACTIVE_COUNT=0
for s in "${SCOPE_FILES[@]}"; do
  st=$(scope_active_state "$s")
  case "$st" in
    override) exit 0 ;;   # operator escape on this scope disables enforcement
    active)
      ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
      blk=$(scope_files "$s")
      [ -n "$blk" ] && ALLOWED+="$blk"$'\n'
      ;;
  esac
done

if [ "$ACTIVE_COUNT" -eq 0 ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: no active scope.

Scanned:
$(printf '  %s\n' "${SCOPE_FILES[@]#$REPO_ROOT/}")

Set **Status:** active (and a future **Expires:**) on the relevant plan's SCOPE.md,
or write your observation to that plan's OUT_OF_SCOPE.md.
EOF
  exit 2
fi

if [ -z "$ALLOWED" ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: active scope has no \`\`\`files block (or it is empty).

Add a block of the form:

  \`\`\`files
  path/to/file/you/intend/to/edit
  \`\`\`

Or write your observation to the plan's OUT_OF_SCOPE.md.
EOF
  exit 2
fi

# --- Membership check (exact, or segment-aware glob) -------------------------

IS_IN_SCOPE=0
while IFS= read -r line; do
  trimmed=$(echo "$line" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')
  [ -z "$trimmed" ] && continue
  case "$trimmed" in
    \#*) continue ;;
  esac
  if [ "$RELATIVE_PATH" = "$trimmed" ]; then IS_IN_SCOPE=1; break; fi
  case "$trimmed" in
    *'*'*|*'?'*)
      re="^$(glob_to_regex "$trimmed")\$"
      if [[ "$RELATIVE_PATH" =~ $re ]]; then IS_IN_SCOPE=1; break; fi ;;
  esac
done <<< "$ALLOWED"

if [ "$IS_IN_SCOPE" -eq 0 ]; then
  cat >&2 <<EOF
BLOCKED by scope-check.sh: '$RELATIVE_PATH' is not in any active scope.

Allowed files (union of active plan scopes):
$(echo "$ALLOWED" | grep -vE '^[[:space:]]*$' | sed 's/^/  /')

To proceed: either (a) add '$RELATIVE_PATH' to the \`\`\`files block of the relevant
plan's SCOPE.md (with operator approval), or (b) capture the observation in that
plan's OUT_OF_SCOPE.md and continue with the original scope.
EOF
  exit 2
fi

exit 0
