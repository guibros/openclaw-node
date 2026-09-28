# Node readiness — component registry

## Family 1: local services

### Gateway
| | |
|---|---|
| **Status** | LIVE startup: PID 2902 listens on loopback 18789; inference not yet accepted |
| **Verified** | 2026-09-27 23:23 EDT: validator accepts config; PID/run count stable over 703 seconds, healthy checks, no plugin errors; anonymous completions 401 |

### Mission Control
| | |
|---|---|
| **Status** | LIVE: fa54a0d build JoDmTRHsYJYZLQg5CKnKW; supervised production service with authenticated API and maintenance |
| **Verified** | 2026-09-28 00:25 EDT: 605.21s healthy stable PID/run count, recovery 2.41s, loopback 3000, 537 original tasks unchanged; anonymous 401 and foreign Host/Origin 403; seven real maintenance requests 200 |

### Memory daemon and viewer
| | |
|---|---|
| **Status** | Memory listening on 7893; viewer 7892 stopped and persistently disabled pending authentication repair |
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
| **Status** | Main 07a9c7e after merged gateway PR #140; live checkout e57f89b preserved; MC fa54a0d staged in PR #141 |
| **Verified** | 2026-09-28 00:25 EDT: CI green and Claude independently approved #141 source/runtime acceptance; historical issue/PR reconciliation continues |
