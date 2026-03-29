---
id: test-standards
version: 1.0.0
tier: universal
paths: ["test/**", "tests/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**"]
priority: 80
tags: ["testing", "quality"]
---

# Test Standards

- Use Arrange/Act/Assert structure in every test.
- Name tests descriptively: `test_[system]_[scenario]_[expected_result]` or `describe/it` equivalent.
- Tests must be deterministic — no dependencies on network, wall clock, or external state.
- Every bug fix must include a regression test that fails without the fix and passes with it.
- Integration tests must clean up after themselves (database records, temp files, external state).
- Mock external dependencies (APIs, databases, filesystems) in unit tests. Integration tests hit real services.
- Performance tests must specify acceptable thresholds, not just "faster than before."
- Never use `sleep()` or fixed delays in tests. Use polling with timeouts or event-driven waits.
