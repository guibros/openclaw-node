# Quarantined skills

Skills in this directory are **not loaded** and must not be installed into a node's
`skills/` tree. They were moved here on 2026-09-06 by the adversarial review
(`ADVERSARIAL_REVIEW_2026-09-06.md`, P5-8) because their designed behaviour, not a
bug, is incompatible with a node that holds the operator's memory:

| Skill | Why |
|-------|-----|
| `memorylayer` | Sends memory content to an external SaaS (`memorylayer.clawbot.hk`) for storage/search. The node's memory is local-first by decision (MASTER_PLAN); shipping it to a third party is exfiltration by design. |
| `moltbook-registry` | Signs and submits on-chain transactions on Base mainnet (burns `$MREG`, rates other agents) from a wallet key on the node. An autonomous agent with a funded key and a "rate reputation" tool is a liability, not a feature. |

Reinstating either is an operator decision recorded in a plan's `DECISIONS.md`,
with the data flow written down first.
