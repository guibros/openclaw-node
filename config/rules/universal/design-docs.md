---
id: design-docs
version: 1.0.0
tier: universal
paths: ["docs/**", "design/**", "notes/**", "**/*.md"]
priority: 60
tags: ["documentation", "design"]
---

# Design Documentation Standards

- Every design document must include: Overview, Requirements, Approach, Edge Cases, Acceptance Criteria.
- Acceptance criteria must be testable — "should feel good" or "works correctly" are not valid criteria.
- Formulas and algorithms must include variable definitions, valid ranges, and example calculations.
- Edge cases must explicitly state WHAT happens, not just acknowledge they exist.
- Dependencies between systems must be bidirectional — if A depends on B, both A and B docs say so.
- Update documentation when changing the code it describes. Stale docs are worse than no docs.
- Architecture Decision Records (ADRs) for any non-obvious technical choice: context, decision, consequences.
