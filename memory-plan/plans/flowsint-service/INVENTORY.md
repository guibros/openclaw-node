# flowsint-service — Step Inventory

Run Flowsint as a pinned, loopback-only, independently supervised OSINT service with an HTTP-only
OpenClaw boundary. Planning is complete; execution remains operator-gated.

**Status:** `[ ]` queued · `[A]` in-flight · `[x]` closed · `[D]` deferred.
**Version:** `v<block>.<step>`; carrier starts at `v0.0`.
**Discipline:** one row = one independently observable outcome = one 9-phase cycle = one commit.

---

## Block 1 — Immutable local service bundle

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 1 | 1.1 | v1.1 | [ ] | Make the configured macOS container engine survive login and answer the Docker API |
| 1 | 1.2 | v1.2 | [ ] | Freeze the Flowsint source and every base service image into an immutable artifact manifest |
| 1 | 1.3 | v1.3 | [ ] | Materialize the self-contained Flowsint service bundle under `~/.openclaw/services/flowsint/` |
| 1 | 1.4 | v1.4 | [ ] | Replace every upstream default credential with a service-owned secret |
| 1 | 1.5 | v1.5 | [ ] | Lock every published Flowsint port to loopback in rendered Compose configuration |

> **1.1 — Goal:** The configured container engine is available automatically after operator login.
> **Needs:** Existing Docker CLI/context; operator authority to configure the selected macOS engine's login lifecycle.
> **Feeds:** Step 1.2 image resolution and every later container-backed runtime probe.
> **Verify:** `runtime:` after a logout/login, `docker info` exits 0 against the intended context without manual engine startup.

> **1.2 — Goal:** Produce one immutable manifest for the selected Flowsint source and base service images.
> **Needs:** Step 1.1; D2; network access to GitHub and GHCR; upstream tag `v1.2.12` still resolvable.
> **Feeds:** Step 1.3 bundle, derivative builds in Block 2, and all future upgrade comparisons.
> **Verify:** `runtime:` source resolves to `12f1eb936768e95981054aa2896ad14613377d7f` and `docker image inspect` reports a non-empty digest for each selected Postgres, Redis, Neo4j, API, and app image.

> **1.3 — Goal:** Install a Flowsint-owned deployment bundle that has no runtime dependency on this repository.
> **Needs:** Step 1.2 manifest; upstream Apache-2.0 `LICENSE`, `NOTICE`, Compose file, and nginx config.
> **Feeds:** Steps 1.4–1.5 and every Flowsint lifecycle command.
> **Verify:** `code:` the service directory contains source provenance, license/notice, Compose configuration, and lifecycle documentation; `docker compose config --quiet` succeeds when run from that directory.

> **1.4 — Goal:** Make the rendered stack free of upstream default credentials.
> **Needs:** Step 1.3; secure random generator; service-local `.env` excluded from version control.
> **Feeds:** Block 2 derivative images and Block 3 authentication.
> **Verify:** `runtime:` `.env` mode is `0600`; rendered config contains populated `AUTH_SECRET`, `MASTER_VAULT_KEY_V1`, Postgres password, and Neo4j password whose hashes do not equal the example values; command output must not reveal secret contents.

> **1.5 — Goal:** Make loopback the only host network boundary in the rendered stack.
> **Needs:** Step 1.4; D4; proposed host ports still free.
> **Feeds:** Every Block 2–5 security and runtime probe.
> **Verify:** `code:` parsed `docker compose config` shows host IP `127.0.0.1` for 5001, 5173, 5433, 6379, 7474, and 7687, with no wildcard or empty host IP.

## Block 2 — Pre-use hardening

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 2 | 2.1 | v2.1 | [ ] | Enforce sketch authorization before an enricher task can be queued |
| 2 | 2.2 | v2.2 | [ ] | Make Docker-backed enricher images immutable and eliminate unconditional registry pulls |
| 2 | 2.3 | v2.3 | [ ] | Remove Docker socket control from the API container while preserving Celery execution |

> **2.1 — Goal:** An authenticated user without sketch permission cannot launch an enricher against that sketch.
> **Needs:** Block 1; D4–D5; pinned v1.2.12 source; two test users and a sketch fixture.
> **Feeds:** Single-operator acceptance in Block 3 and any future multi-user threat model.
> **Verify:** `runtime:` the owner launch queues a task while the second account receives 403 for the same sketch/node IDs; `code:` focused authorization regression passes in the derivative image source.

> **2.2 — Goal:** Repeated Docker-backed enrichments use declared image digests without contacting a registry on the second launch.
> **Needs:** Step 2.1; inventory of all six current ProjectDiscovery DockerTool subclasses; digest manifest from 1.2.
> **Feeds:** Deterministic acceptance in step 3.4 and safe Node automation in Block 4.
> **Verify:** `runtime:` two identical test launches report the same sidecar image ID and the second launch log has no pull attempt; `code:` regression proves installed pinned images bypass `pull()`.

> **2.3 — Goal:** The API container runs without Docker API authority.
> **Needs:** Step 2.2; D5; proof that built-in enrichers execute in Celery rather than the API process.
> **Feeds:** Block 3 production Compose and the retained Celery trust-boundary record.
> **Verify:** `runtime:` `/var/run/docker.sock` is absent in `docker inspect flowsint-api-prod`; it remains present only in Celery; an API-launched Docker-backed enricher reaches a terminal scan state.

## Block 3 — Standalone service acceptance

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 3 | 3.1 | v3.1 | [ ] | Start the hardened six-container stack with every healthcheck green |
| 3 | 3.2 | v3.2 | [ ] | Create the sole production operator account through the loopback API |
| 3 | 3.3 | v3.3 | [ ] | Close the public registration endpoint after bootstrap |
| 3 | 3.4 | v3.4 | [ ] | Complete a benign `domain_to_ip` graph enrichment from the Flowsint UI |
| 3 | 3.5 | v3.5 | [ ] | Recover the complete Flowsint stack after a container-engine restart |

> **3.1 — Goal:** All six hardened Flowsint containers reach healthy/running state together.
> **Needs:** Block 2 closed; ports re-probed free; service secrets present; container engine live.
> **Feeds:** Account bootstrap and all later live API probes.
> **Verify:** `runtime:` `docker compose ps --format json` reports Postgres, Redis, Neo4j, API, Celery, and app running, with every defined healthcheck healthy; `curl http://127.0.0.1:5001/health` returns 200.

> **3.2 — Goal:** Exactly one production operator profile exists.
> **Needs:** Step 3.1; operator-selected email and password supplied outside git.
> **Feeds:** Step 3.3 closure, step 3.4 smoke test, and Block 4 adapter credentials.
> **Verify:** `runtime:` login returns a bearer token for the operator and a Postgres count query returns exactly one profile without printing credential material.

> **3.3 — Goal:** New account registration is unavailable after operator bootstrap.
> **Needs:** Step 3.2; D4; service-owned nginx configuration.
> **Feeds:** Single-operator invariant for Blocks 3–5.
> **Verify:** `runtime:` unauthenticated `POST /api/auth/register` through port 5173 returns the configured denial while the existing operator can still authenticate.

> **3.4 — Goal:** A benign domain enrichment produces the expected graph expansion.
> **Needs:** Step 3.3; operator login; `example.com` seed node; pinned `domain_to_ip` sidecar/runtime dependencies.
> **Feeds:** Standalone acceptance, Block 4 contract fixture, and adapter expected-result shape.
> **Verify:** `visual:` the graph shows at least one IP node connected by `RESOLVES_TO`; `runtime:` the returned launch UUID resolves through `/api/scans/{id}` to `COMPLETED` and the graph endpoint contains the new node and edge.

> **3.5 — Goal:** Compose restart policy restores the accepted stack after its container engine restarts.
> **Needs:** Step 3.4; step 1.1 login supervision; no OpenClaw lifecycle hook.
> **Feeds:** Block 4 availability assumptions and final reboot acceptance.
> **Verify:** `runtime:` after stopping and restarting the selected container engine, all six prior container services return healthy and the existing investigation remains readable without invoking `openclaw-stack`.

## Block 4 — HTTP-only OpenClaw boundary

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 4 | 4.1 | v4.1 | [ ] | Capture the complete authenticated investigation lifecycle as an executable API contract fixture |
| 4 | 4.2 | v4.2 | [ ] | Implement an OpenClaw HTTP client against the accepted fixture |
| 4 | 4.3 | v4.3 | [ ] | Expose one bounded, audited Flowsint enrichment action to OpenClaw |
| 4 | 4.4 | v4.4 | [ ] | Prove a Flowsint outage cannot degrade core OpenClaw services |

> **4.1 — Goal:** One executable fixture proves every HTTP call required from seed to terminal graph.
> **Needs:** Block 3; D6; a dedicated benign test investigation; stable request/response schemas captured from v1.2.12.
> **Feeds:** Step 4.2 client implementation and upgrade compatibility tests.
> **Verify:** `runtime:` the fixture authenticates, creates investigation/sketch/node, launches `domain_to_ip`, polls its returned ID to `COMPLETED`, and fetches a graph containing the enrichment; rerun cleans up its own test records.

> **4.2 — Goal:** The Node client reproduces the accepted fixture using HTTP only.
> **Needs:** Step 4.1; runtime secret path for operator credentials; OpenClaw HTTP conventions.
> **Feeds:** Step 4.3 action and step 4.4 failure handling.
> **Verify:** `code:` focused tests cover token refresh, lifecycle calls, terminal polling, and graph parsing; `runtime:` the deployed client completes the same benign fixture with no Flowsint package import or database connection.

> **4.3 — Goal:** OpenClaw exposes exactly one operator-authorized Flowsint enrichment action with durable audit identity.
> **Needs:** Step 4.2; D8 allowed target/enricher policy; an existing OpenClaw tool/action registration surface.
> **Feeds:** Step 4.4 isolation test and Block 5 end-to-end acceptance.
> **Verify:** `runtime:` an authorized `example.com` request returns investigation, sketch, and scan IDs plus graph results; a disallowed enricher/target is rejected before any Flowsint launch; logs record actor, target, enricher, and scan ID without credentials.

> **4.4 — Goal:** Flowsint unavailability remains confined to the Flowsint action.
> **Needs:** Step 4.3; healthy OpenClaw baseline; controlled permission to stop/start only the Flowsint Compose project.
> **Feeds:** D1 independence proof and Block 5 observability semantics.
> **Verify:** `runtime:` with Flowsint stopped, the action returns typed `unavailable` within its timeout while node-watch core families and memory injection retain their pre-test grades; restarting Flowsint restores the action.

## Block 5 — Observe without owning

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 5 | 5.1 | v5.1 | [ ] | Surface Flowsint health in node-watch and Mission Control without lifecycle controls |
| 5 | 5.2 | v5.2 | [ ] | Complete one operator-authorized enrichment through the deployed OpenClaw action |
| 5 | 5.3 | v5.3 | [ ] | Prove both systems recover independently after a full Mac reboot |

> **5.1 — Goal:** Operations surfaces report Flowsint availability without acquiring start/stop authority.
> **Needs:** Block 4; D3 and D7; stable loopback health contract.
> **Feeds:** Operator diagnostics and final reboot observation.
> **Verify:** `runtime:` healthy/unavailable transitions appear correctly in node-watch and Mission Control as Flowsint starts/stops; `code:` no Flowsint Compose command, native unit, or autostart manifest entry exists in OpenClaw.

> **5.2 — Goal:** A real OpenClaw request completes the bounded Flowsint workflow end to end.
> **Needs:** Step 5.1; operator-authorized benign target; all production services healthy.
> **Feeds:** Final plan acceptance and a durable example for later consumers.
> **Verify:** `runtime:` the OpenClaw action returns a `COMPLETED` scan ID and graph result that match Flowsint's API and UI; the audit entry contains the same identifiers.

> **5.3 — Goal:** A cold boot restores OpenClaw and Flowsint as separate healthy failure domains.
> **Needs:** Step 5.2; operator approval for a full Mac reboot; both supervision systems configured.
> **Feeds:** Terminal done-contract for the flowsint-service plan.
> **Verify:** `visual:` operator performs the reboot; `runtime:` Flowsint's six containers and OpenClaw's required core services return healthy without manual starts, the Flowsint action succeeds, and stopping Flowsint afterward does not change the core OpenClaw grades.
