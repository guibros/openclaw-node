# Node state recovery — registry

## Family 1: persisted application state

### SQLite application stores
| | |
|---|---|
| **Status** | Twelve per-store snapshots restore correctly; independent source review pending; coordinated recovery remains 1.3 |
| **Verified** | 2026-09-28 08:31 EDT: 852,017,152 snapshot bytes, 116 physical tables, matching typed content/rowids/header/FK fingerprints, core integrity; six native FTS checks and eight vector probes pass. Owner-private files; running service PIDs/runs unchanged. Node 24 daemon/knowledge SQLite 3.49.2; Node 22 MC SQLite 3.53.2; gateway node:sqlite 3.50.4/vec 0.1.9. Agent stores have compatibility probes, not owner-engine claims. Header inventory refuses unknown stores/links; explicit browser/historical/source exclusions. |

### JetStream histories
| | |
|---|---|
| **Status** | SPLIT: standalone 4222, cluster 4223/4224, member 1 fails on contested 4222; offline R=1 data |
| **Verified** | 2026-09-28 01:06 EDT inventory, config paths reverified 07:20 EDT. Four stores retained; no union, migration or service stop. Restore acceptance open. |
