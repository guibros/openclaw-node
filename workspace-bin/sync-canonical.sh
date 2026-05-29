#!/usr/bin/env bash
# sync-canonical.sh — propagate canonical docs into every siloed plan.
#
# Each plan under memory-plan/plans/<id>/ is self-contained: the viewer renders
# every tab from the plan's own dir and never reaches outside it. Canonical docs
# (the cross-plan north star) are authored once in memory-plan/canonical/ and
# copied into each plan silo by this script, so every plan carries its own
# working copy. Re-run after editing anything in canonical/.
#
# Usage: workspace-bin/sync-canonical.sh [--check]
#   --check  exit 1 if any plan copy is stale/missing (no writes); for CI/hooks.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANON="$REPO/memory-plan/canonical"
PLANS="$REPO/memory-plan/plans"

check_only=0
[[ "${1:-}" == "--check" ]] && check_only=1

[[ -d "$CANON" ]] || { echo "no canonical dir: $CANON" >&2; exit 1; }
[[ -d "$PLANS" ]] || { echo "no plans dir: $PLANS" >&2; exit 1; }

stale=0
for doc in "$CANON"/*; do
  [[ -f "$doc" ]] || continue
  name="$(basename "$doc")"
  for plan in "$PLANS"/*/; do
    [[ -d "$plan" ]] || continue
    dest="$plan$name"
    if [[ ! -f "$dest" ]] || ! cmp -s "$doc" "$dest"; then
      if [[ $check_only -eq 1 ]]; then
        echo "STALE  ${plan#$REPO/}$name"
        stale=1
      else
        cp "$doc" "$dest"
        echo "synced ${plan#$REPO/}$name"
      fi
    fi
  done
done

if [[ $check_only -eq 1 ]]; then
  [[ $stale -eq 0 ]] && echo "all plan copies up to date"
  exit $stale
fi
echo "done."
