#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="${1:-.}"
FULL_TEST_CMD="${2:-npm test}"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git not found"
  exit 1
fi

cd "$REPO_PATH"

if [[ ! -d .git ]]; then
  echo "ERROR: $REPO_PATH is not a git repository"
  exit 1
fi

echo "== Arcane pre-push check =="
echo "Repo: $(pwd)"

echo "\n[1/6] Branch"
git rev-parse --abbrev-ref HEAD

echo "\n[2/6] Remotes"
git remote -v || true

echo "\n[3/6] Working tree summary"
git status --short

echo "\n[4/6] Staged files"
git diff --cached --name-only || true

echo "\n[5/6] Last commit"
git log -1 --oneline || true

echo "\n[6/6] Full test command (manual confirmation required)"
echo "$FULL_TEST_CMD"
echo "Run it yourself now if not already green."

echo "\nDone."
