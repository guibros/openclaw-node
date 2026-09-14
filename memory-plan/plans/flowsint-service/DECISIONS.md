# DECISIONS — flowsint-service plan (append-only)

Architectural decisions for this plan. Newest at bottom. Supersede; never rewrite after execution
begins.

## D1 — Flowsint is a sibling service, not a Node component (2026-09-14)

**Decision.** Deploy Flowsint under `~/.openclaw/services/flowsint/` with its own source, config,
secrets, stores, containers, lifecycle, and upgrade cadence. OpenClaw may reach it only through
authenticated loopback HTTP.

**Why.** The operator asked for an autonomous service independent from the node. Package imports,
shared databases, or shared lifecycle would make either system's upgrade and failure domain depend
on the other.

**Consequences.** Flowsint can run and be tested before any Node edit. Its outage cannot fail core
OpenClaw paths. An HTTP adapter is allowed later; Python imports and direct database access are not.

## D2 — Pin release and runtime artifacts immutably (2026-09-14)

**Decision.** Start from upstream `v1.2.12`, resolved to commit
`12f1eb936768e95981054aa2896ad14613377d7f`. Record GHCR and sidecar image digests before first use;
never deploy `main` or an unresolved `latest`.

**Why.** `main` is already ahead of the latest release, the Compose default is `latest`, and the
sidecar wrapper pulls `:latest` on every launch. A version string alone does not make the runtime
reproducible.

**Consequences.** Upgrades are explicit plan steps with new source and image evidence. Local
hardening produces a derivative image with Apache-2.0 `LICENSE`/`NOTICE` retained.

## D3 — Container supervision stays outside OpenClaw (2026-09-14)

**Decision.** The selected macOS container engine starts at login; Compose `restart: always` owns
container recovery. `openclaw-stack`, `service-manifest.json`, launchd units, and systemd units do
not start or stop Flowsint.

**Why.** Two supervisors for one process tree create ambiguous truth and restart races. The current
Docker context is unreachable, so its provider must be made reliable before deployment.

**Consequences.** OpenClaw may observe Flowsint health but not control it. A reboot acceptance test
must prove the container engine and Compose policy actually restore the service.

## D4 — Loopback-only, single-operator bootstrap (2026-09-14)

**Decision.** Bind every published port to `127.0.0.1`. Create exactly one operator account, then
make `POST /api/auth/register` unavailable at the reverse-proxy boundary. LAN, mesh, and public
exposure are excluded.

**Why.** Upstream app port 5173 binds all interfaces by default, registration has no disable flag,
and the v1.2.12 enricher launch route lacks an explicit sketch authorization check.

**Consequences.** Remote collaboration is unavailable. Any later exposure or multi-user use needs
a separate threat model and scope; it is not an incremental config toggle.

## D5 — Harden execution before autonomous calls (2026-09-14)

**Decision.** Before the standalone acceptance run, add the launch ownership gate, make sidecar
image selection/pulls deterministic, and remove Docker socket access from the API container. Celery
retains socket access only because Docker-backed enrichers require it.

**Why.** A Docker socket is host-control authority even when mounted `:ro`. Mutable tool images and
a missing authorization check are incompatible with autonomous Node-triggered execution.

**Consequences.** The first deployment uses a locally built derivative of the pinned release rather
than untouched GHCR API/Celery images. The Celery worker is a trusted boundary and accepts only
operator-authorized targets through a bounded adapter.

## D6 — The adapter owns a complete HTTP lifecycle (2026-09-14)

**Decision.** The Node adapter authenticates with the same single operator account and implements
investigation creation, sketch creation, seed insertion, enricher launch, scan polling, graph fetch,
and optional SSE progress. It refreshes the 60-hour token before expiry or after a 401.

**Why.** The earlier four-call sketch omitted how an automated caller obtains investigation,
sketch, and node IDs. The Celery task ID already equals the scan ID, so no correlation store is
needed.

**Consequences.** Credentials live in runtime secrets, never in the repo. The adapter exposes a
bounded action rather than raw arbitrary API access, records target/enricher/scan IDs, and returns a
typed unavailable result when Flowsint is down.

## D7 — Observation does not imply lifecycle ownership (2026-09-14)

**Decision.** Add a loopback health/acceptance surface to node-watch and Mission Control only after
the standalone service passes. Do not add a fake native service entry that wraps Compose.

**Why.** Blind services rot, but `service-manifest.json` does not provide a Compose command contract
and the stack launcher discovers native units independently of that manifest.

**Consequences.** Operators can see Flowsint availability next to Node health. Start, stop, update,
backup, and restore remain Flowsint-owned operations.

## D8 — Lawful, operator-authorized use only (2026-09-14)

**Decision.** Preserve upstream `ETHICS.md`, require an explicit operator-authorized target for each
Node action, and initially allow only the benign enricher set named by the plan step.

**Why.** Flowsint includes reconnaissance, breach, social-profile, and network-enumeration tools.
Autonomous execution without a target/action boundary would expand the intended lawful OSINT use.

**Consequences.** No generic agent-selected enricher or bulk target mode ships in this plan. Any
expansion is a new decision and scope.
