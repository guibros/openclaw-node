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
STATUS_LC=""
if [ -f "$PLAN/SCOPE.md" ]; then
  status=$(grep -iE '^\*\*Status:\*\*' "$PLAN/SCOPE.md" | head -1 | sed -E 's/^\*\*Status:\*\*[[:space:]]*//' || true)
  STATUS_LC=$(printf '%s' "$status" | tr -d ' ' | tr 'A-Z' 'a-z')
  if [ -n "$status" ]; then report PASS master-plan "SCOPE.md parseable (Status: $status)"
  else report FAIL master-plan "SCOPE.md present but no **Status:** field"; fi
else report FAIL master-plan "SCOPE.md missing"; fi

# Scope hygiene — the drift that actually bites (2026-07-04 deep review): an
# active scope that grows unbounded or lives for weeks is the hook's designed
# failure mode performed openly. Only OPEN (non-`closed`) files blocks count.
if [ "$STATUS_LC" = "active" ] && [ -f "$PLAN/SCOPE.md" ]; then
  open_files=$(awk '
    /^```files([[:space:]]|$)/ { flag = ($0 ~ /[[:space:]]closed[[:space:]]*$/) ? 0 : 1; next }
    /^```[[:space:]]*$/ { flag=0 }
    flag && !/^[[:space:]]*(#|$)/ { n++ }
    END { print n+0 }
  ' "$PLAN/SCOPE.md")
  if [ "$open_files" -gt 80 ]; then report FAIL master-plan "scope hygiene: $open_files open allow-list entries (>80) — close shipped batches (\`\`\`files <label> closed)"
  elif [ "$open_files" -gt 40 ]; then report WARN master-plan "scope hygiene: $open_files open allow-list entries (>40) — prune closed batches"
  else report PASS master-plan "scope hygiene: $open_files open allow-list entries"; fi

  set_at=$(grep -E '^\*\*Set at:\*\*' "$PLAN/SCOPE.md" | tail -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)
  if [ -n "$set_at" ]; then
    set_epoch=$(date -j -f '%Y-%m-%d' "$set_at" '+%s' 2>/dev/null || date -d "$set_at" '+%s' 2>/dev/null || echo "")
    if [ -n "$set_epoch" ]; then
      age_days=$(( ( $(date '+%s') - set_epoch ) / 86400 ))
      if [ "$age_days" -gt 30 ]; then report FAIL master-plan "scope hygiene: active scope is ${age_days}d old (>30) — re-set or retire it"
      elif [ "$age_days" -gt 14 ]; then report WARN master-plan "scope hygiene: active scope is ${age_days}d old (>14)"
      else report PASS master-plan "scope hygiene: active scope age ${age_days}d"; fi
    fi
  else
    report WARN master-plan "scope hygiene: active scope has no dated **Set at:** line"
  fi
fi

if [ -f "$PLAN/COMPONENT_REGISTRY.md" ]; then
  fams=$(grep -cE '^## +Family [0-9]+:' "$PLAN/COMPONENT_REGISTRY.md" 2>/dev/null || true)
  sts=$(grep -cE '^\|\s*\*\*Status\*\*\s*\|' "$PLAN/COMPONENT_REGISTRY.md" 2>/dev/null || true)
  if [ "${fams:-0}" -gt 0 ] && [ "${sts:-0}" -gt 0 ]; then
    report PASS master-plan "COMPONENT_REGISTRY.md: $fams family(ies), $sts status row(s) (viewer-parseable)"
  elif grep -qE '^\|[^-|]' "$PLAN/COMPONENT_REGISTRY.md"; then
    report WARN master-plan "COMPONENT_REGISTRY.md has content but not the '## Family N:' + '| **Status** |' shape the viewer parses (renders empty)"
  else
    report WARN master-plan "COMPONENT_REGISTRY.md present but no data (probe + record)"
  fi
else report FAIL master-plan "COMPONENT_REGISTRY.md missing"; fi

if [ -f "$PLAN/DECISIONS.md" ]; then
  if grep -qE '^## D[0-9]+' "$PLAN/DECISIONS.md"; then report PASS master-plan "DECISIONS.md has entries"
  else report WARN master-plan "DECISIONS.md present but no D-entries (log D1: why this plan exists)"; fi
else report FAIL master-plan "DECISIONS.md missing"; fi

if [ -f "$PLAN/OUT_OF_SCOPE.md" ]; then report PASS master-plan "OUT_OF_SCOPE.md present"
else report FAIL master-plan "OUT_OF_SCOPE.md missing"; fi

# ── surface 2: steps ────────────────────────────────────────────────────────
INV="$PLAN/INVENTORY.md"
# Whitespace-tolerant, matching plan-tick and the viewer — one row format, one
# parse contract. Status vocabulary: [ ] open · [A] in progress · [x] closed ·
# [D] deferred (deliberately postponed; never a next step, no contract required).
ROW_RE='^\|[[:space:]]*[0-9]+[[:space:]]*\|[[:space:]]*[0-9]+\.[0-9]+[[:space:]]*\|[[:space:]]*v[0-9]+\.[0-9]+[[:space:]]*\|[[:space:]]*\[(x|A|D| )\]'
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
        "[x]"|"[D]") contract_warn=$((contract_warn+1)) ;;
        *)     contract_fail=$((contract_fail+1))
               [ "$SUMMARY" -eq 1 ] || printf '         %s\n' "open row $step lacks the Goal/Needs/Feeds/Verify contract" ;;
      esac
    fi
  done < <(grep -E "$ROW_RE" "$INV")

  if [ "$contract_fail" -gt 0 ]; then report FAIL steps "$contract_fail open row(s) without the §11 contract"
  else report PASS steps "all open rows carry the §11 contract"; fi
  [ "$contract_warn" -gt 0 ] && report WARN steps "$contract_warn closed row(s) predate the contract (grandfathered)"

  closed=$(grep -cE '^\|[[:space:]]*[0-9]+[[:space:]]*\|[[:space:]]*[0-9]+\.[0-9]+[[:space:]]*\|[[:space:]]*v[0-9]+\.[0-9]+[[:space:]]*\|[[:space:]]*\[x\]' "$INV" 2>/dev/null || true)
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
  if grep -q '<FILL:' "$PLAN/TICK_PROMPT.md"; then
    report WARN automation "TICK_PROMPT.md has unresolved <FILL: bindings (resolve before enabling the chain)"
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
  if [ "$ver" = "v0.0" ] || grep -qE "^\|[[:space:]]*[0-9]+[[:space:]]*\|[[:space:]]*[0-9]+\.[0-9]+[[:space:]]*\|[[:space:]]*${base}[[:space:]]*\|" "$INV" 2>/dev/null; then
    report PASS history "VERSION ($ver) coheres with INVENTORY"
  else
    report FAIL history "VERSION ($ver) points at no INVENTORY row"
  fi
else report FAIL history "VERSION missing"; fi

# Activity-vs-machinery drift (2026-07-04 deep review): work flowing through the
# repo while the plan's step machinery sits idle is the bypass signature. Only
# graded for the plan holding an active scope — repo-wide signals would nag
# dormant silos forever.
if [ "$STATUS_LC" = "active" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  evid=$(git -C "$REPO" log -15 --format='%B' 2>/dev/null | grep -c 'Runtime-Evidence:' || true)
  if [ "${evid:-0}" -eq 0 ]; then
    report WARN history "no Runtime-Evidence: trailer in the last 15 commits (done-contract §5 evidence not riding commits)"
  else
    report PASS history "Runtime-Evidence: trailer present in $evid of the last 15 commits"
  fi
  vh=$(git -C "$REPO" log -1 --format='%H' -- "$PLAN/VERSION" 2>/dev/null || true)
  if [ -n "$vh" ]; then
    since=$(git -C "$REPO" rev-list --count "$vh"..HEAD 2>/dev/null || echo 0)
    if [ "${since:-0}" -gt 20 ]; then
      report WARN history "step machinery idle: $since commits since VERSION last moved — work is flowing past the step ledger"
    else
      report PASS history "VERSION moved within the last ${since} commit(s)"
    fi
  fi
fi

# ── summary ─────────────────────────────────────────────────────────────────
verdict="CONFORMANT"; rc=0
[ "$NFAIL" -gt 0 ] && { verdict="NONCONFORMANT"; rc=1; }
if [ "$SUMMARY" -eq 1 ]; then
  echo "conformance: $ID ${NPASS}P/${NWARN}W/${NFAIL}F → $verdict"
else
  echo "summary: $NPASS PASS · $NWARN WARN · $NFAIL FAIL → $verdict"
fi
exit $rc
