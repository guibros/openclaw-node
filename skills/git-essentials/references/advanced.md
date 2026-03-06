# Advanced Git Commands

Extracted from SKILL.md for reference. See the main SKILL.md for basic workflow, branching, remotes, history, and undoing changes.

## Common Workflows

**Feature branch workflow:**
```bash
git checkout -b feature/new-feature
# Make changes
git add .
git commit -m "Add new feature"
git push -u origin feature/new-feature
# Create PR, then after merge:
git checkout main
git pull
git branch -d feature/new-feature
```

**Hotfix workflow:**
```bash
git checkout main
git pull
git checkout -b hotfix/critical-bug
# Fix bug
git commit -am "Fix critical bug"
git push -u origin hotfix/critical-bug
# After merge:
git checkout main && git pull
```

**Syncing fork:**
```bash
git remote add upstream https://github.com/original/repo.git
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

## Stashing

```bash
# Stash changes
git stash

# Stash with message
git stash save "Work in progress"

# List stashes
git stash list

# Apply latest stash
git stash apply

# Apply and remove stash
git stash pop

# Apply specific stash
git stash apply stash@{2}

# Delete stash
git stash drop stash@{0}

# Clear all stashes
git stash clear
```

## Rebasing

```bash
# Rebase current branch
git rebase main

# Interactive rebase (last 3 commits)
git rebase -i HEAD~3

# Continue after resolving conflicts
git rebase --continue

# Skip current commit
git rebase --skip

# Abort rebase
git rebase --abort
```

## Tags

```bash
# List tags
git tag

# Create lightweight tag
git tag v1.0.0

# Create annotated tag
git tag -a v1.0.0 -m "Version 1.0.0"

# Tag specific commit
git tag v1.0.0 commit-hash

# Push tag
git push origin v1.0.0

# Push all tags
git push --tags

# Delete tag
git tag -d v1.0.0
git push origin --delete v1.0.0
```

## Cherry-pick

```bash
# Apply specific commit
git cherry-pick commit-hash

# Cherry-pick without committing
git cherry-pick -n commit-hash
```

## Submodules

```bash
# Add submodule
git submodule add https://github.com/user/repo.git path/

# Initialize submodules
git submodule init

# Update submodules
git submodule update

# Clone with submodules
git clone --recursive https://github.com/user/repo.git
```

## Clean

```bash
# Preview files to be deleted
git clean -n

# Delete untracked files
git clean -f

# Delete untracked files and directories
git clean -fd

# Include ignored files
git clean -fdx
```

## Useful Aliases

Add to `~/.gitconfig`:
```ini
[alias]
    st = status
    co = checkout
    br = branch
    ci = commit
    unstage = reset HEAD --
    last = log -1 HEAD
    visual = log --graph --oneline --all
    amend = commit --amend --no-edit
```

## Tips

- Commit often, perfect later (interactive rebase)
- Write meaningful commit messages
- Use `.gitignore` for files to exclude
- Never force push to shared branches
- Pull before starting work
- Use feature branches, not main
- Rebase feature branches before merging
- Use `--force-with-lease` instead of `--force`

## Common Issues

**Undo accidental commit:**
```bash
git reset --soft HEAD~1
```

**Recover deleted branch:**
```bash
git reflog
git checkout -b branch-name <commit-hash>
```

**Fix wrong commit message:**
```bash
git commit --amend -m "Correct message"
```

**Resolve merge conflicts:**
```bash
# Edit files to resolve conflicts
git add resolved-files
git commit  # Or git merge --continue
```

## Documentation

Official docs: https://git-scm.com/doc
Pro Git book: https://git-scm.com/book
Visual Git guide: https://marklodato.github.io/visual-git-guide/
