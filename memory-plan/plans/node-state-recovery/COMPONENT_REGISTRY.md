# Node state recovery — registry

## Family 1: persisted application state

### SQLite application stores
| | |
|---|---|
| **Status** | ACCEPTED: twelve per-store snapshots restore correctly; independent review accepted e750e3e; coordinated recovery remains 1.3 |
| **Verified** | 2026-09-28 08:31 EDT: 852,017,152 snapshot bytes, 116 physical tables, matching typed content/rowids/header/FK fingerprints, core integrity; six native FTS checks and eight vector probes pass. Owner-private files; running service PIDs/runs unchanged. Node 24 daemon/knowledge SQLite 3.49.2; Node 22 MC SQLite 3.53.2; gateway node:sqlite 3.50.4/vec 0.1.9. Agent stores have compatibility probes, not owner-engine claims. Header inventory refuses unknown stores/links; explicit browser/historical/source exclusions. |

### JetStream histories
| | |
|---|---|
| **Status** | SPLIT, preservation in flight: standalone 4222 and cluster 4223/4224 serve; failed member 1 persistently held; three healthy cold masters pending |
| **Verified** | 2026-09-28 21:33 EDT: member-1 protected master and its isolated R1 restoration accepted; eleven individual online archives restored with 80,156 non-expiring messages. After the VM crash, nine reachable non-expiring stream states/configs and durable positions match the older archive points; no immediate pre-crash acknowledgement guarantee. Worker explicitly restored under a 65-second idle guard. All three serving bus identities/routes remain unchanged through revised owned recovery tests; member 2 is metadata leader. Sixteen preservation checks, a real account-group election regression, twelve durable-journal fault tests and complete owned recovery fixtures pass. Journal is a primitive; managed orchestration remains pending. New managed-window acceptance, three healthy cold copies and coordinated recovery remain open. |
