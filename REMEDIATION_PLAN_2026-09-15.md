# OpenClaw-node — Remediation Plan

**Date:** 2026-09-15 · **Companion to:** `REMEDIATION_PLAN_2026-09-06.md` · **Branch:** `claude/opencalw-node-adversarial-review-pedrcw`

This plan turns the 2026-09-15 reviews (25-pass solo + 50-pass, 12 parallel agents; 204 findings) into an ordered, verifiable fix sequence. Source ledgers: the 2026-09-14/15 entries in `memory-plan/plans/protocol/OUT_OF_SCOPE.md`. It is a plan, not a code change — nothing here is applied. It runs through the repo's own discipline: each phase is a scope batch, each item carries a smallest-fix and a done-contract (negative test that fails on the vulnerable code + green suite, per MASTER_PLAN §5), and phases are ordered by risk × dependency. Refuted candidates and operator-decision items are listed at the end so they are not re-investigated as bugs.

Federation items stay behind the D16 BLOCKED gate. Live-host runtime evidence remains the operator's step.

---

## 1. Root-cause map

The actionable findings collapse into seven systemic causes. Fixing the cause fixes the cluster.

| Cause | One-line statement | Findings it explains |
|---|---|---|
| **A. Authorization ≠ reachability, on the STATE plane** | The 2026-09-06 work signed the control *messages*; the shared JetStream KV + collab planes they guard are still writable by any credentialed node. | owner-authz bypass via lease-token disclosure, unauthenticated collab reflect/join/leave, unsigned MC KV writes, MC PATCH mass-assignment, unsigned mesh.tasks.submit, worker deny-set misses `$KV.*` |
| **B. Allowlists are lists of code-exec primitives** | The chaining filter is solid, but the allowlisted verbs themselves run arbitrary code. | metric RCE (`npm run`/`pytest -p`/`make -f`/`sort --compress-program`/`node --inspect`), exec allowlist (`npm install`/`node x.js`/`go generate`/`find -fprintf`) |
| **C. Untrusted input → shell / env-file** | External strings flow into `bash -c`, `sed`, and env-file lines through hand-rolled interpolation. | join-token env-line injection, pair-session shell injection, config.sh xargs corruption, new-plan.sh sed injection |
| **D. Secrets exposed on argv / in transit / at rest** | Secrets ride the sed command line and the trace bus; a fence token is handed out by an unauth read. | macOS secret-on-argv (config.sh + services.sh), lease_token disclosed by handleGet, tracer arg capture broadcast on NATS |
| **E. Gates certify presence, not function** | A grep, an HTTP 200, a self-written trailer, a pid-less probe, and an Override file stand in for verified behavior. | tick trailer fabrication, CI packaging gate presence-only, scope-check self-service, force-push not blocked at git layer, Linux status false-DOWN/false-BROKEN |
| **F. The green suite certifies the vulns as safe** | Security tests assert the bypasses `allowed=true`; the whole distributed layer skips in CI. | exec-safety positive-only tests, updateEnvFile no negative test, peer privacy filter no positive test, ~38 mesh describes skipped |
| **G. Lifecycle / packaging / supply chain** | Fetches are unpinned; a nested tree ships; two CLIs are dead; dry-run mutates. | npm-pack ships node_modules+.next, sudo -g companion-bridge, curl\|sh installers, natsUrl crash, consolidate --dry-run mutates, silent consolidation 401 |

**Highest-leverage fix is A** — it is the same "authorization = reachability" root cause the 2026-09-06 plan named, but on the state plane the earlier work did not reach. Several individual HIGHs are instances of it, so Phase 1 fixes the class.

---

## 2. Sequencing

P0 first (fast, isolated, zero-design — stop active bleeding). P1 next (collapses the biggest vulnerability class). P2–P3 remaining security depth. P8-1 (CI mesh bus) is pulled early because it makes P1–P3 provable. P4–P7 correctness/operability/honesty by blast radius. One scope batch at a time, in order; each ends green with its new negative tests.

Effort: S ≤ half-day · M ~1–2 days · L ~3+ days.

```
P0 → P1 → P2 → P3 → P8-1 → P5 → P4 → P6 → P7a/P7b        (P7c behind the federation gate)
```

---

## 3. Phases

### PHASE 0 — Fast isolated wins
Scope: `package.json`, `mission-control/package.json`, `.github/workflows/test.yml`, `scripts/install/components.sh`, `scripts/install/config.sh`, `bin/memory-subscriber.mjs`, `bin/memory-promoter.mjs`, `workspace-bin/memory-maintenance.mjs`, `mission-control/src/app/notifications/page.tsx`, `.claude/hooks/validate-push.sh`, `config/git-hooks/pre-push`, + tests.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P0-1 | Packaging: add `"!mission-control/node_modules"`, `"!mission-control/.next"` to `files[]` (root `.npmignore` does NOT work — PoC-verified); add CI negative-grep + entry-count ceiling (<5000). Done: `npm pack --dry-run` ≤ ~15 MB. | HIGH | S |
| P0-2 | `components.sh:209` — pin + de-root companion-bridge, or gate behind an opt-in flag. Done: no unpinned `sudo npm install -g`. | HIGH | S |
| P0-3 | `config.sh:169` — wrap the grep `{ grep … \|\| true; }` like siblings :253/:289. Done: first `--cluster-peers` install completes. | HIGH | S |
| P0-4 | `memory-subscriber.mjs:268` / `memory-promoter.mjs:352` — declare `natsUrl`; add a startup smoke test. Done: both CLIs start. | MED | S |
| P0-5 | `memory-maintenance.mjs:345/383/399` — add `mcAuthHeaders()`. Done: consolidate/graph POSTs authenticate. | MED | S |
| P0-6 | `notifications/page.tsx:161` — allowlist `e.url` scheme (http/https/mailto). Done: `javascript:` renders inert + test. | MED | S |
| P0-7 | `validate-push.sh` — match `--force`/`-f`/`+refspec` precisely (stop false-blocking " +"); forward the real command from the git-hook path. Done: legit push unblocked, force blocked from a plain shell. | MED | S |

### PHASE 1 — Close the unsigned-mutation authorization class (core)
Scope: `lib/operator-auth.mjs`, `bin/mesh-task-daemon.js`, `lib/mesh-tasks.js`, `lib/mesh-collab.js`, `bin/nats-auth-render.mjs`, `mission-control/src/lib/sync/mesh-kv.ts`, `mission-control/src/app/api/mesh/tasks/[id]/route.ts`, + tests.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P1-1 | Redact `lease_token`/bearer fields from `handleGet`/`handleList` responses. Done: get→complete-as-owner PoC fails. | HIGH | M |
| P1-2 | Bind the lease to the caller's authenticated identity, or sign owner mutations. Done: a leaked token isn't replayable by another node. | HIGH | M |
| P1-3 | Authenticate `mesh.collab.reflect/join/leave` (caller identity + membership); reflect gated like handleComplete. Done: non-member can't join/vote/remove. | HIGH | M |
| P1-4 | Guard the KV plane: extend nkey `WORKER_PUBLISH_DENY` to `$KV.MESH_TASKS/PLANS/COLLAB.>`; route MC writes through signed handlers OR sign KV values + verify on read. Done: a worker credential can't overwrite a task in nkey mode. | HIGH | L |
| P1-5 | `mesh/tasks/[id]/route.ts:46` — whitelist PATCH fields; reject scope/metric/origin/status rewrites of a running/completed task. | HIGH | S |
| P1-6 | `handleSubmit` requires a signed operator action (metric gate ≠ authz gate). Done: unsigned submit refused. | HIGH | M |

### PHASE 2 — Metric/exec allowlist hardening
Scope: `lib/exec-safety.js`, `bin/mesh-agent.js`, `test/exec-safety.test.js`.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P2-1 | Move to an argv-form runner (no `bash -c`) and/or forbid exec-bearing flags (`--prefix`, `-p`, `-f`, `--compress-program`, `--inspect*`); drop the `\|sort` safe-pipe exception. Done: each documented bypass refused. | HIGH | M |
| P2-2 | `DANGEROUS_FIND_FLAGS` += `-fprintf/-fprint/-fls/-fprint0`; `DANGEROUS_NODE_FLAGS` += `--inspect/--inspect-brk/--cpu-prof-dir`. | MED | S |
| P2-3 | Rewrite `exec-safety.test.js` to assert each attack input is REFUSED (it currently asserts them allowed). Done: suite fails on old validator, passes on hardened. | HIGH | S |

### PHASE 3 — Install-chain secrets + supply chain
Scope: `scripts/install/{config,services,helpers,env,prereqs}.sh`, `bin/openclaw-node-init.js`, `lib/join-token.js`, `mesh-install.sh`, `bootstrap.sh`, + tests.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P3-1 | No secrets on argv: render configs via the env-based pattern (cluster-renderer style) or require `envsubst`; fixes config.sh + services.sh sed fallbacks. Done: no secret in any process argv during install. | HIGH | M |
| P3-2 | `config.sh` env parser — stop running values through `xargs`. Done: a quoted credential survives intact. | HIGH | S |
| P3-3 | `updateEnvFile`/`parseJoinToken` — reject newline/control chars, validate field charset. Done: `\n`-bearing join-token field rejected. | HIGH | S |
| P3-4 | dry-run honesty: make `DRY_RUN_ERRORS` fail the run; fix loginctl/token/model/base_url writes on `--dry-run`. | MED | S |
| P3-5 | Unify `prereqs.sh` nats-server to the SHA-pinned download; pin/justify remaining `curl\|sh` installers. | MED | S |

### PHASE 8-1 — Honest CI (pulled early)
Scope: `.github/workflows/test.yml`, `test/helpers/*`.

Stand up the CI NATS service on an authenticated bus (the `ci-local` harness already exists) and set `OPENCLAW_REQUIRE_MESH=1` so the ~38 skipped mesh/consensus describes run. **Done:** the distributed suites execute in CI; the pass count reflects the mesh layer. This makes P1–P3 provable in CI.

### PHASE 5 — Services / lifecycle (Linux truth)
Scope: `bin/openclaw-stack.mjs`, `lib/node-watch.mjs`, `services/systemd/*.service`, `services/systemd/*.timer`, `scripts/install/services.sh`, `service-manifest.json`, + tests.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P5-1 | `openclaw-stack.mjs:110` resolve systemd MainPID (stop reporting every daemon DOWN); `node-watch.mjs:446` treat single-node `openclaw-nats` (manifest default) as core-OK, not the R=3 labels. | HIGH | M |
| P5-2 | systemd `ExecReload=/bin/kill -HUP $MAINPID` blanked by envsubst → escape it. Done: `--sync-nats` reload works on Linux. | MED | S |
| P5-3 | Add `After=`/`Wants=` nats to dependent units; add `StartLimitIntervalSec`/`Burst`; tighten log-rotate cadence. | MED | M |

### PHASE 4 — Crypto defense-in-depth
Scope: `lib/node-identity.mjs`, `lib/operator-auth.mjs`, `lib/deploy-trigger-auth.mjs`, + tests.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P4-1 | Verify `operator_action === true` (+ an action/audience field) — domain separation. | MED | M |
| P4-2 | Require `event_id` on signed requests (no-event_id currently skips the replay cache). | MED | S |
| P4-3 | Persist/anchor the seen-cache (in-memory Map is cleared on restart, reopening the replay window). | MED | M |

### PHASE 6 — Governance integrity
Scope: `.claude/hooks/scope-check.sh`, `workspace-bin/plan-tick.sh`, `workspace-bin/workplan-viewer.mjs`, `workspace-bin/new-plan.sh`, `.claude/settings.json`.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P6-1 | tick close-gate: bind the Runtime-Evidence trailer to a real suite-result artifact hash; fire on any INVENTORY checkbox close, not only a VERSION bump. | MED | M |
| P6-2 | workplan-viewer: apply MC's session-token posture to its state-changing loopback endpoints (`/block`, `/automation/tick`, config PUT). | MED | M |
| P6-3 | `new-plan.sh`: pass GOAL via env/stdin, not interpolated into a sed program (GNU sed `e` = RCE). | MED | S |

### PHASE 7 — Memory / agnosticism / federation
Scope 7a: `lib/retrieval-pipeline.mjs`, `lib/broadcast-offerer.mjs`, `bin/consolidate.mjs`, `lib/memory-inject-server.mjs`, `lib/tracer.js`, + tests.
Scope 7b: `lib/transcript-parser.mjs`, `config/transcript-sources.json.template`, `scripts/install/env.sh`.
Scope 7c (BLOCKED — D16, when-unblocked): `lib/mesh-collab.js`, `bin/fed-benchmark.mjs`, `bin/fed-chaos.mjs`, `benchmark/*`.

| ID | Fix | Sev | Eff |
|---|---|---|---|
| P7a-1 | Privacy filter fail-closed on the federation-offerer path (entity-only JOIN misses entity-less + private-decision-only sessions); add the missing POSITIVE-path test. | MED (HIGH if federation ships) | M |
| P7a-2 | `consolidate --dry-run` — gate decay/prune/reinforce/fingerprint writes on `opts.dryRun`. | MED | S |
| P7a-3 | inject-server `close()` releases the 2 SQLite DBs + graphCache; add a leak assertion. | MED | S |
| P7a-4 | `tracer.js summarizeArgs` — redact secret-shaped string args; never trace secret-bearing fns. | MED | S |
| P7b-1 | LLM-agnostic ingest: ship transcript adapters for the non-Claude providers the installer offers; make `transcript-sources.json.template` provider-aware. Done: a non-Claude session ingests end-to-end. | HIGH (for the agnosticism goal) | L |
| P7c | (BLOCKED) premature-convergence `min_quorum`←recruited_count; benchmark cost accounting reconciled; `fed-chaos` targets the named nodeId. Pre-staged; do not execute until the federation gate reopens. | MED | M |

---

## 4. Cross-cutting rule
Every P1–P4 fix ships with a **negative test that fails on the vulnerable code and passes on the fix** (Cause F). The reviews found the suite currently certifies several known vulns as safe — that is the standing bar for this whole plan, not a one-off.

## 5. Excluded (decisions, not bugs — do not re-investigate as defects)
- **scope-check self-service** (Override/SCOPE.md) — arguably by design; the operator owns the repo. Decide the posture (an out-of-band approval marker) before changing code.
- **Force-push git-layer gap** — governance-posture call.
- **`openclaw.<node>.exec` responder** — lives outside this repo (OUT_OF_SCOPE C2); allowlist/signing belongs in that remote tree.
- **MC dev-only advisories** (esbuild/vitest/drizzle-kit) — 6 moderate, all devDependencies, below the `--audit-level=high` gate; not shipped in the Next runtime.

## 6. Refuted this session (confirmed NOT defects)
Signing math + canonicalization; MC middleware auth; safe-path realpath jail (the "13 traversable routes" was overstated — none are); collab CAS single-winner claims; registry strict mode; join-token HMAC; parameterized SQL; no committed secrets in skills/souls; both lockfiles clean; root audit 0 vulns. Strict-signed deploy is the runtime default (stale comment misled). Scheduler no longer needs a browser tab. Benchmark A/B blinding is fair (though its cost figures are not — P7c).
