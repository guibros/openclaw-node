---
name: git-essentials
description: "Reference guide for Git commands and workflows — branching, merging, rebasing, stashing, tagging, and collaboration patterns. Use when the agent needs a Git command reference or workflow template."
homepage: https://git-scm.com/
triggers:
  - "git commands reference"
  - "how to use git"
  - "git workflow guide"
  - "git branching help"
  - "git rebase tutorial"
negative_triggers:
  - "create a commit now"
  - "github issues"
  - "github pull request"
  - "push my code"
metadata: {"clawdbot":{"emoji":"🌳","requires":{"bins":["git"]}}}
---

# Git Essentials

Essential Git commands for version control and collaboration.

## Initial Setup

```bash
# Configure user
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# Initialize repository
git init

# Clone repository
git clone https://github.com/user/repo.git
git clone https://github.com/user/repo.git custom-name
```

## Basic Workflow

### Staging and committing
```bash
# Check status
git status

# Add files to staging
git add file.txt
git add .
git add -A  # All changes including deletions

# Commit changes
git commit -m "Commit message"

# Add and commit in one step
git commit -am "Message"

# Amend last commit
git commit --amend -m "New message"
git commit --amend --no-edit  # Keep message
```

### Viewing changes
```bash
# Show unstaged changes
git diff

# Show staged changes
git diff --staged

# Show changes in specific file
git diff file.txt

# Show changes between commits
git diff commit1 commit2
```

## Branching & Merging

### Branch management
```bash
# List branches
git branch
git branch -a  # Include remote branches

# Create branch
git branch feature-name

# Switch branch
git checkout feature-name
git switch feature-name  # Modern alternative

# Create and switch
git checkout -b feature-name
git switch -c feature-name

# Delete branch
git branch -d branch-name
git branch -D branch-name  # Force delete

# Rename branch
git branch -m old-name new-name
```

### Merging
```bash
# Merge branch into current
git merge feature-name

# Merge with no fast-forward
git merge --no-ff feature-name

# Abort merge
git merge --abort

# Show merge conflicts
git diff --name-only --diff-filter=U
```

## Remote Operations

### Managing remotes
```bash
# List remotes
git remote -v

# Add remote
git remote add origin https://github.com/user/repo.git

# Change remote URL
git remote set-url origin https://github.com/user/new-repo.git

# Remove remote
git remote remove origin
```

### Syncing with remote
```bash
# Fetch from remote
git fetch origin

# Pull changes (fetch + merge)
git pull

# Pull with rebase
git pull --rebase

# Push changes
git push

# Push new branch
git push -u origin branch-name

# Force push (careful!)
git push --force-with-lease
```

## History & Logs

### Viewing history
```bash
# Show commit history
git log

# One line per commit
git log --oneline

# With graph
git log --graph --oneline --all

# Last N commits
git log -5

# Commits by author
git log --author="Name"

# Commits in date range
git log --since="2 weeks ago"
git log --until="2024-01-01"

# File history
git log -- file.txt
```

### Searching history
```bash
# Search commit messages
git log --grep="bug fix"

# Search code changes
git log -S "function_name"

# Show who changed each line
git blame file.txt

# Find commit that introduced bug
git bisect start
git bisect bad
git bisect good commit-hash
```

## Undoing Changes

### Working directory
```bash
# Discard changes in file
git restore file.txt
git checkout -- file.txt  # Old way

# Discard all changes
git restore .
```

### Staging area
```bash
# Unstage file
git restore --staged file.txt
git reset HEAD file.txt  # Old way

# Unstage all
git reset
```

### Commits
```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Revert commit (create new commit)
git revert commit-hash

# Reset to specific commit
git reset --hard commit-hash
```

See [references/advanced.md](references/advanced.md) for advanced Git commands.

Covers: common workflows (feature branch, hotfix, fork sync), stashing, rebasing, tags, cherry-pick, submodules, clean, aliases, tips, common issues, and documentation links.
