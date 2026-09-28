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

### Memory daemon
| | |
|---|---|
| **Status** | Memory listening on 7893; autonomous capture is not accepted and remains stale |
| **Verified** | 2026-09-27 22:59 EDT: PIDs and loopback listeners; runtime lib symlinks into live checkout |

### Plan viewer and watcher
| | |
|---|---|
| **Status** | LIVE b4bbac2 overlay on preserved e57f89b base; viewer PID 35823/runs 3 after intentional crash recovery; watcher PID 29201/runs 1; production browser acceptance pending |
| **Verified** | 2026-09-28 07:30 EDT: authenticated discovery matches nine live plans/versions, served assets match release, anonymous controls 401 and foreign authority/origin 403, sign-out/rotation close real streams without restart, pre-restart session rejected; watcher positive WORKING and missing-key negative BROKEN/401. Plan files/logs/schedules unchanged. 603.38s healthy stable PID/runs; subsequent intentional crash recovers in 0.447s with key inode/mtime preserved. |

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
| **Status** | Main 4112855 after merged gateway #140 and Mission Control #141; live checkout e57f89b preserved; viewer source b4bbac2 deployed from draft #142, documentation head 860c853 |
| **Verified** | 2026-09-28 07:21 EDT: #142 CI green on Node 20/22 and Mission Control; Claude independently approved source, passed 103 focused tests on Node 22.22.2/24.13.0 and caught six deliberate mutations. Runtime/browser acceptance remains distinct. |
