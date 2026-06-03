#!/usr/bin/env bash
# plan-lint.sh — machine-grade a plan silo against PROTOCOL.md §10 (surface conformance)
# and §11 (the Goal/Needs/Feeds/Verify step contract).
#
# Usage: workspace-bin/plan-lint.sh <plan-id> [--summary]
#   --summary   one line only: "conformance: <id> <P>P/<W>W/<F>F → CONFORMANT|NONCONFORMANT"
#
# Exit codes: 0 = zero FAILs (conformant; WARNs allowed) · 1 = any FAIL · 2 = usage/missing plan
#
# Grading tiers (the grandfathering decided in protocol plan 2.1):
#   - open INVENTORY rows without the §11 contract → FAIL; closed rows without it → WARN
#   - audit-dir coverage is count-based WARN (dir-naming varies across plan eras)
#   - ROADMAP.md missing → WARN (historical silos carry their roadmap under another name)

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON="$REPO/memory-plan/canonical"

ID="${1:-}"
[ -n "$ID" ] || { echo "usage: plan-lint.sh <plan-id> [--summary]" >&2; exit 2; }
PLAN="$REPO/memory-plan/plans/$ID"
[ -d "$PLAN" ] || { echo "plan-lint: no such plan dir: $PLAN" >&2; exit 2; }

SUMMARY=0
[ "${2:-}" = "--summary" ] && SUMMARY=1

NPASS=0; NWARN=0; NFAIL=0
report() {
  local tier="$1" surface="$2" msg="$3"
  case "$tier" in
    PASS) NPASS=$((NPASS+1)) ;;
    WARN) NWARN=$((NWARN+1)) ;;
    FAIL) NFAIL=$((NFAIL+1)) ;;
  esac
  [ "$SUMMARY" -eq 1 ] || printf '  [%s] %-12s %s\n' "$tier" "$surface" "$msg"
}

[ "$SUMMARY" -eq 1 ] || echo "plan-lint: $ID  ($PLAN)"

# ── surface 1: master-plan ──────────────────────────────────────────────────
if [ -f "$PLAN/SCOPE.md" ]; then
  status=$(grep -iE '^\*\*Status:\*\*' "$PLAN/SCOPE.md" | head -1 | sed -E 's/^\*\*Status:\*\*[[:space:]]*//' || true)
  if [ -n "$status" ]; then report PASS master-plan "SCOPE.md parseable (Status: $status)"
  else report FAIL master-plan "SCOPE.md present but no **Status:** field"; fi
else report FAIL master-plan "SCOPE.md missing"; fi

if [ -f "$PLAN/COMPONENT_REGISTRY.md" ]; then
  rows=$(grep -cE '^\|[^-|]' "$PLAN/COMPONENT_REGISTRY.md" 2>/dev/null || true)
  if [ "${rows:-0}" -gt 1 ]; then report PASS master-plan "COMPONENT_REGISTRY.md has $((rows-1)) row(s)"
  else report WARN master-plan "COMPONENT_REGISTRY.md present but no data rows (probe + record)"; fi
else report FAIL master-plan "COMPONENT_REGISTRY.md missing"; fi

if [ -f "$PLAN/DECISIONS.md" ]; then
  if grep -qE '^## D[0-9]+' "$PLAN/DECISIONS.md"; then report PASS master-plan "DECISIONS.md has entries"
  else report WARN master-plan "DECISIONS.md present but no D-entries (log D1: why this plan exists)"; fi
else report FAIL master-plan "DECISIONS.md missing"; fi

if [ -f "$PLAN/OUT_OF_SCOPE.md" ]; then report PASS master-plan "OUT_OF_SCOPE.md present"
else report FAIL master-plan "OUT_OF_SCOPE.md missing"; fi

# ── surface 2: steps ────────────────────────────────────────────────────────
INV="$PLAN/INVENTORY.md"
ROW_RE='^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[(x|A| )\]'
if [ -f "$INV" ] && grep -qE "$ROW_RE" "$INV"; then
  total=$(grep -cE "$ROW_RE" "$INV")
  report PASS steps "INVENTORY.md: $total row(s) in the load-bearing format"

  contract_fail=0; contract_warn=0
  while IFS='|' read -r _ _ step _ st _; do
    step=$(echo "$step" | tr -d ' '); st=$(echo "$st" | tr -d ' ')
    # contract chunk = from this step's Goal line to the next Goal line or end of blockquote
    chunk=$(awk -v anchor="> **$step — Goal:**" '
      found { if ($0 !~ /^>/ || $0 ~ /— Goal:\*\*/) exit; print }
      index($0, anchor) == 1 { found=1; print }
    ' "$INV" 2>/dev/null || true)
    has_contract=1
    [ -n "$chunk" ] || has_contract=0
    if [ "$has_contract" -eq 1 ]; then
      for fieldname in 'Needs' 'Feeds' 'Verify'; do
        printf '%s\n' "$chunk" | grep -q "\*\*$fieldname:\*\*" || has_contract=0
      done
    fi
    if [ "$has_contract" -eq 0 ]; then
      case "$st" in
        "[x]") contract_warn=$((contract_warn+1)) ;;
        *)     contract_fail=$((contract_fail+1))
               [ "$SUMMARY" -eq 1 ] || printf '         %s\n' "open row $step lacks the Goal/Needs/Feeds/Verify contract" ;;
      esac
    fi
  done < <(grep -E "$ROW_RE" "$INV")

  if [ "$contract_fail" -gt 0 ]; then report FAIL steps "$contract_fail open row(s) without the §11 contract"
  else report PASS steps "all open rows carry the §11 contract"; fi
  [ "$contract_warn" -gt 0 ] && report WARN steps "$contract_warn closed row(s) predate the contract (grandfathered)"

  closed=$(grep -cE '^\| [0-9]+ \| [0-9]+\.[0-9]+ \| v[0-9]+\.[0-9]+ \| \[x\]' "$INV" 2>/dev/null || true)
  pres=$(find "$PLAN/audits" -name 'AUDIT_PRE.md' 2>/dev/null | wc -l | tr -d ' ')
  posts=$(find "$PLAN/audits" -name 'AUDIT_POST.md' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${closed:-0}" -gt 0 ] && [ "${posts:-0}" -lt "${closed}" ]; then
    report WARN steps "audit coverage: $posts AUDIT_POST for $closed closed step(s)"
  else
    report PASS steps "audit coverage: $pres PRE / $posts POST for $closed closed step(s)"
  fi
else
  report FAIL steps "INVENTORY.md missing or no rows in the load-bearing 5-column format"
fi

# ── surface 3: automation ───────────────────────────────────────────────────
AUTO="$PLAN/automation.json"
if [ -f "$AUTO" ]; then
  if tick_cmd=$(node -e "const c=require('$AUTO');if(!c.plist_label||!c.tick_command)process.exit(1);console.log(c.tick_command)" 2>/dev/null); then
    report PASS automation "automation.json valid (label + tick_command)"
    if [ -x "$tick_cmd" ]; then report PASS automation "tick_command exists + executable: ${tick_cmd#$REPO/}"
    else report FAIL automation "tick_command missing or not executable: $tick_cmd"; fi
  else
    report FAIL automation "automation.json invalid JSON or missing plist_label/tick_command"
  fi
else report FAIL automation "automation.json missing"; fi

if [ -f "$PLAN/TICK_PROMPT.md" ]; then
  if grep -q '<FILL' "$PLAN/TICK_PROMPT.md"; then
    report WARN automation "TICK_PROMPT.md has unresolved <FILL bindings (resolve before enabling the chain)"
  else
    report PASS automation "TICK_PROMPT.md present, bindings resolved"
  fi
else report FAIL automation "TICK_PROMPT.md missing"; fi

# ── surface 4: block ────────────────────────────────────────────────────────
if [ -f "$PLAN/BLOCKED.md" ]; then
  if grep -q '^\*\*Trigger\*\*:' "$PLAN/BLOCKED.md"; then
    report PASS block "BLOCKED.md present and template-shaped (plan is blocked, chain short-circuits)"
  else
    report FAIL block "BLOCKED.md present but missing **Trigger**: (not template-shaped)"
  fi
  grep -q '^\*\*External action:\*\*' "$PLAN/BLOCKED.md" || \
    report WARN block "BLOCKED.md has no **External action:** line (operator can't see the single move)"
else
  report PASS block "no BLOCKED.md — chain runnable"
fi

# ── surface 5: documents ────────────────────────────────────────────────────
docs_ok=1
for doc in MASTER_PLAN.md PROTOCOL.md FRAMEWORK_CANONICAL.md COWORK_MODEL.md BLOCK_TEMPLATE.md; do
  if [ ! -f "$PLAN/$doc" ]; then report FAIL documents "synced canonical doc missing: $doc"; docs_ok=0
  elif ! cmp -s "$CANON/$doc" "$PLAN/$doc"; then report FAIL documents "stale canonical copy: $doc (run sync-canonical.sh)"; docs_ok=0
  fi
done
[ "$docs_ok" -eq 1 ] && report PASS documents "5 canonical docs present + in sync"
if [ -f "$PLAN/ROADMAP.md" ]; then report PASS documents "ROADMAP.md present"
else report WARN documents "ROADMAP.md missing (required for new plans; historical silos may carry another name)"; fi

# ── surface 6: history ──────────────────────────────────────────────────────
if [ -d "$PLAN/tick-logs" ]; then report PASS history "tick-logs/ present"
else report FAIL history "tick-logs/ missing (ticks have nowhere to write; Live/History tabs dead)"; fi

if [ -f "$PLAN/VERSION" ]; then
  ver=$(tr -d '[:space:]' < "$PLAN/VERSION")
  base="${ver%-pre}"; base="${base%-mid}"
  if [ "$ver" = "v0.0" ] || grep -qE "^\| [0-9]+ \| [0-9]+\.[0-9]+ \| ${base} \|" "$INV" 2>/dev/null; then
    report PASS history "VERSION ($ver) coheres with INVENTORY"
  else
    report FAIL history "VERSION ($ver) points at no INVENTORY row"
  fi
else report FAIL history "VERSION missing"; fi

# ── summary ─────────────────────────────────────────────────────────────────
verdict="CONFORMANT"; rc=0
[ "$NFAIL" -gt 0 ] && { verdict="NONCONFORMANT"; rc=1; }
if [ "$SUMMARY" -eq 1 ]; then
  echo "conformance: $ID ${NPASS}P/${NWARN}W/${NFAIL}F → $verdict"
else
  echo "summary: $NPASS PASS · $NWARN WARN · $NFAIL FAIL → $verdict"
fi
exit $rc
