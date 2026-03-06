#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/moltymac/.openclaw/workspace/skills"
DIST="$ROOT/dist"

echo "== Golden Skills v3 Check =="

echo "[1/4] Check packaged .skill files"
for f in \
  "$DIST/arcane-dev-ops.skill" \
  "$DIST/discord-telegram-triage.skill" \
  "$DIST/founder-brief-summarizer.skill"; do
  [[ -f "$f" ]] || { echo "Missing: $f"; exit 1; }
  echo "OK: $f"
done

echo "[2/4] Run arcane prepush_check script"
"$ROOT/arcane-dev-ops/scripts/prepush_check.sh" "/Users/moltymac/.openclaw/workspace/projects/arcane" "npx hardhat test" >/tmp/arcane_prepush_check.out
head -n 8 /tmp/arcane_prepush_check.out

echo "[3/4] Run channel triage snapshot script (quick)"
"$ROOT/discord-telegram-triage/scripts/triage_snapshot.sh" >/tmp/channel_triage_snapshot.out
head -n 12 /tmp/channel_triage_snapshot.out

echo "[4/4] Run founder brief template script"
"$ROOT/founder-brief-summarizer/scripts/brief_template.sh" "golden-test-topic" >/tmp/founder_brief_template.out
head -n 12 /tmp/founder_brief_template.out

echo "All golden checks passed."
