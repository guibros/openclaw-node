---
id: solidity
version: 1.0.0
tier: framework
paths: ["contracts/**", "**/*.sol"]
detect: ["hardhat.config.js", "hardhat.config.ts", "foundry.toml"]
priority: 80
tags: ["solidity", "blockchain", "smart-contracts"]
---

# Solidity Standards

- Never hardcode contract addresses. Resolve through a registry or deployment config.
- All external/public functions that modify state must have reentrancy guards.
- Every state change must emit an event. Events are the indexing layer.
- Use checks-effects-interactions pattern: validate → update state → external calls.
- All arithmetic on token amounts must use SafeMath or Solidity 0.8+ built-in overflow protection.
- Document gas costs for expensive operations. Set gas budgets for user-facing transactions.
- Upgradeable contracts must use the proxy pattern with storage layout compatibility checks.
- Never use `selfdestruct` or `delegatecall` to untrusted targets.
- All deployed contracts must have a verified source on block explorer.
- Test coverage must include: happy path, edge cases, access control, reentrancy, gas limits.
