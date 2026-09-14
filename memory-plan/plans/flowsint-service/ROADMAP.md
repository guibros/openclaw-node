# flowsint-service — Roadmap

**Goal.** Run Flowsint as a pinned, loopback-only, independently supervised OSINT service with an HTTP-only OpenClaw boundary.
**Created:** 2026-09-14
**Execution status:** planned, not started; no implementation scope is active.

## Posture

Flowsint is a sibling service, not an OpenClaw dependency. Its source, images, databases,
secrets, container network, lifecycle, and upgrade cadence live under
`~/.openclaw/services/flowsint/`. OpenClaw does not import Flowsint Python, share its stores,
or start and stop its containers. The only supported coupling is authenticated HTTP over
loopback; an unavailable Flowsint degrades only the Flowsint action.

The service is single-operator and loopback-only until the launch authorization gate is proven.
No public or mesh exposure is part of this plan. OSINT targets remain operator-authorized and
lawful under upstream `ETHICS.md`.

## Verified upstream baseline

Re-verified 2026-09-14 from `reconurge/flowsint`:

- Latest release tag is `v1.2.12`; its annotated tag resolves to commit
  `12f1eb936768e95981054aa2896ad14613377d7f`. `main` is newer and is not the deployment input.
- The production Compose file runs six containers: Postgres, Redis, Neo4j, API, Celery, and app.
  It publishes 5433, 6379, 7474, 7687, and 5001 on loopback, but publishes app port 5173 on all
  interfaces unless overridden.
- Both API and Celery receive `/var/run/docker.sock`; the socket's read-only filesystem mount
  does not make Docker API control read-only.
- `POST /api/enrichers/{name}/launch` authenticates the caller but contains no explicit sketch
  ownership/role check before reading nodes and queuing work. The scan and event read routes do
  perform permission checks.
- `DockerTool.launch()` calls `install()` every time, and `install()` pulls a `:latest` image.
  Pre-pulling alone therefore does not remove the network round-trip or tool drift.
- Access tokens expire after 3,600 minutes (60 hours). Registration has no disable setting.
- The Celery task UUID is stored directly as the `Scan.id`, so launch and polling share one ID.

Upstream references: [repository](https://github.com/reconurge/flowsint),
[production Compose](https://github.com/reconurge/flowsint/blob/v1.2.12/docker-compose.prod.yml),
[license](https://github.com/reconurge/flowsint/blob/v1.2.12/LICENSE), and
[ethics](https://github.com/reconurge/flowsint/blob/v1.2.12/ETHICS.md).

## Block 1 — Immutable local service bundle

- **Intent:** establish a reproducible, secret-safe deployment bundle owned by Flowsint rather
  than the OpenClaw runtime.
- **Exit criterion (runtime-observable):** the configured container engine survives a login;
  the service bundle resolves only pinned source and image identities; its rendered Compose
  configuration contains non-default secrets and loopback-only host bindings.
- **Unblocks:** Block 2.

## Block 2 — Pre-use hardening

- **Intent:** close the three verified hazards that conflict with autonomous invocation:
  missing launch authorization, mutable sidecar tools, and unnecessary API socket control.
- **Exit criterion (runtime-observable):** a foreign-account launch is denied; two identical
  sidecar runs use the same image digests without a registry pull; the API container has no
  Docker socket while Celery still completes an enricher.
- **Unblocks:** Block 3.

## Block 3 — Standalone service acceptance

- **Intent:** prove Flowsint works by itself before OpenClaw is allowed to call it.
- **Exit criterion (runtime-observable):** all six containers are healthy, exactly one operator
  account exists, further registration is rejected, a benign domain enrichment creates the
  expected graph result, and the stack recovers after its container engine is restarted.
- **Unblocks:** Block 4.

## Block 4 — HTTP-only OpenClaw boundary

- **Intent:** add one bounded OpenClaw action that drives a complete Flowsint investigation over
  the public HTTP API without importing code or sharing databases.
- **Exit criterion (runtime-observable):** an OpenClaw call authenticates, creates an investigation
  and sketch, inserts a seed node, launches an allowed enricher, follows the returned scan ID,
  and returns the resulting graph; stopping Flowsint leaves the rest of the node healthy.
- **Unblocks:** Block 5.

The minimum complete API lifecycle is larger than the four-call sketch in the original notes:

1. `POST /api/auth/token`
2. `POST /api/investigations/create`
3. `POST /api/sketches/create`
4. `POST /api/sketches/{sketch_id}/nodes/add`
5. `POST /api/enrichers/{enricher_name}/launch`
6. `GET /api/scans/{scan_id}` until terminal
7. `GET /api/sketches/{sketch_id}/graph`
8. Optional live progress: `GET /api/events/sketch/{sketch_id}/stream`

## Block 5 — Observe without owning

- **Intent:** surface availability in OpenClaw operations while preserving Flowsint's independent
  supervision and failure domain.
- **Exit criterion (runtime-observable):** node-watch/Mission Control reports Flowsint health but
  does not start or stop it, and a full Mac reboot restores both systems without manual recovery.
- **Unblocks:** terminal.

## Explicit non-goals

- No LAN, Tailscale, public, or reverse-proxy exposure.
- No shared Neo4j/Postgres/Redis, shared Python packages, or direct database reads from OpenClaw.
- No generic arbitrary-enricher endpoint exposed to an agent.
- No automatic tracking of upstream `latest`.
- No lifecycle entry that makes `openclaw-stack` the Flowsint supervisor.
