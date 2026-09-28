# Node readiness — component registry

## Family 1: local services

### Gateway
| | |
|---|---|
| **Status** | LIVE startup: PID 2902 listens on loopback 18789; inference not yet accepted |
| **Verified** | 2026-09-27 23:08 EDT: validator accepts migrated config; two healthy probes 41.77s apart, no plugin errors; external channels remain disabled |

### Mission Control
| | |
|---|---|
| **Status** | DOWN: launchd exit 127; next: command not found |
| **Verified** | 2026-09-27 22:59 EDT: no listener on 3000; deployed project lacks working Next binary |

### Memory daemon and viewer
| | |
|---|---|
| **Status** | LISTENING on 7893 / 7892; functional acceptance pending |
| **Verified** | 2026-09-27 22:59 EDT: PIDs and loopback listeners; runtime lib symlinks into live checkout |

### Message bus
| | |
|---|---|
| **Status** | SPLIT: standalone 4222; cluster members 4223/4224; nats-1 fails |
| **Verified** | 2026-09-27 23:00 EDT: 8222 reports no cluster/routes; 8223/8224 report openclaw-cluster; distinct persisted histories, not migrated |

### Worker and task daemon
| | |
|---|---|
| **Status** | Processes present; execution, authorization and recovery not yet accepted |
| **Verified** | 2026-09-27 22:59 EDT: both launchd PIDs present, prior exit nonzero, source paths in live checkout |

## Family 2: delivery

### Source and review
| | |
|---|---|
| **Status** | Main cbae56be97aa0f6d4faf9fedd444dad119885d9a; live e57f89b; isolated codex/node-readiness branch |
| **Verified** | 2026-09-27 23:00 EDT: GitHub API and git; Claude acknowledged independent read-only review; 96 issues and 13 open PRs require reconciliation |
