---
id: git-hygiene
version: 1.0.0
tier: universal
paths: ["**/*"]
priority: 40
tags: ["git", "workflow"]
---

# Git Hygiene

- Use conventional commit format: `type(scope): description` (feat, fix, refactor, test, docs, chore).
- Never force-push to main/master. Use feature branches and pull requests.
- Commits should be atomic — one logical change per commit, not a dump of accumulated work.
- Write commit messages that explain WHY, not just WHAT. The diff shows what changed.
- Never commit generated files, build artifacts, or dependency directories (node_modules, dist, build).
- Resolve merge conflicts by understanding both sides, not by accepting one blindly.
- Tag releases with semantic versioning. Breaking changes get a major bump.
