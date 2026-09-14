# COMPONENT_REGISTRY — flowsint-service plan

Current state of every component this plan touches. Claims older than 14 days must be re-probed
before execution (MASTER_PLAN §4.9).

## Family 1: Flowsint service

### Pinned upstream release — `reconurge/flowsint@v1.2.12`

| | |
|---|---|
| **Status** | VERIFIED SOURCE / NOT DEPLOYED |
| **Verified** | 2026-09-14 — `git ls-remote --tags` resolved `v1.2.12^{}` to `12f1eb936768e95981054aa2896ad14613377d7f`; shallow `main` was `182056979b12f86d495dd962b627ac6e065b4f02` and was not selected. |

### Local service bundle — `~/.openclaw/services/flowsint/`

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-14 — `lsof -nP -iTCP:5001 -iTCP:5173 -iTCP:5433 -iTCP:6379 -iTCP:7474 -iTCP:7687 -sTCP:LISTEN` returned no listeners. |

### Container engine — current Docker CLI context

| | |
|---|---|
| **Status** | DEAD / PREREQUISITE UNSATISFIED |
| **Verified** | 2026-09-14 — `docker version --format '{{.Server.Version}}'` could not connect to `tcp://192.168.64.1:2375`; the engine provider and login supervision remain to be established in step 1.1. |

### Flowsint data stores — Postgres, Redis, Neo4j

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-14 — no listeners on the upstream host ports 5433, 6379, 7474, or 7687. |

## Family 2: OpenClaw boundary

### Flowsint HTTP client/action — repository and deployed runtime

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-14 — case-insensitive repository search found no `flowsint` references; no client, action, health probe, or service-manifest entry exists. |

### Lifecycle ownership — OpenClaw stack launcher

| | |
|---|---|
| **Status** | INDEPENDENT BY ABSENCE |
| **Verified** | 2026-09-14 — `bin/openclaw-stack.mjs` discovers native `ai.openclaw.*`/`openclaw-*` units and has no Compose/Flowsint control path. This remains an invariant, not a gap. |

## Family 3: Network allocation

### Loopback ports — 5001, 5173, 5433, 6379, 7474, 7687

| | |
|---|---|
| **Status** | AVAILABLE |
| **Verified** | 2026-09-14 — `lsof` returned no listeners on all six proposed host ports; repository port survey found no OpenClaw allocation overlap. Re-probe immediately before step 3.1. |
