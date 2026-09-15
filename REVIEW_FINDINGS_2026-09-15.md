# OpenClaw-node — Complete Review Findings Register

**Date:** 2026-09-15 · **Repo:** `moltyguibros-design/openclaw-node` · **Branch:** `claude/opencalw-node-adversarial-review-pedrcw`
**Rounds:** 25-pass solo review (40 findings) + 50-pass review via 12 parallel agents (164 findings) = **204 findings**
**Remediation plan:** `REMEDIATION_PLAN_2026-09-15.md` · **Ledger entries:** `memory-plan/plans/protocol/OUT_OF_SCOPE.md` (2026-09-14/15)

Severity tally: **33 HIGH · 58 MED · 28 LOW · 25 INFO · 29 GOOD · 5 REFUTES** (plus dismissed/not-a-bug entries kept so they are not re-investigated).

Legend — **HIGH/MED/LOW**: defect. **INFO**: observation. **GOOD**: attacked and held. **REFUTES**: disproves an earlier conclusion. "PoC" = an exploit or repro actually executed.

---

## ⚠︎ Corrections — findings that overturn earlier conclusions

These five change what a previous review said. They matter more than their severity alone.

| # | What was believed | What is actually true |
|---|---|---|
| R1 | Task-daemon **owner authorization is sound** (rated GOOD in the 25-pass) | **It is bypassable.** `operator-auth.mjs:136-147` owner path is a plaintext `node_id === task.owner` fenced only by `lease_token`; `mesh-task-daemon.js` `handleGet:536`/`handleList:526` have **no authz** and return the raw task *including* `owner` + `lease_token`. Any bus peer reads the fence secret then force-completes/fails/releases any task. |
| R2 | **scope-check is solid** (rated GOOD) | Path-shape defenses *are* solid, but the gate is **self-serviceable**: `SCOPE.md` sits in the always-writable escape valve, so an agent writes a plan `SCOPE.md` with `Status: active` + `Override: true` (2 writes) and `scope-check.sh:223` `override) exit 0` disables enforcement. Nothing mechanically requires operator approval. |
| R3 | validate-push **"holds outside Claude Code too"** | **False for force-push.** `config/git-hooks/pre-push:9` feeds the hook a hardcoded `{"command":"git push"}` with no flags, so the force matcher never fires from a plain terminal. Only the Claude Code PreToolUse layer (which sees the real command) blocks it. Protected-branch is warn-only. |
| R4 | 13 MC fs routes lack safe-path → **traversal class still open** (my F-19) | **Overstated.** All 13 traced: fixed server paths, `basename`/`slugify` sanitization, or they *do* use safe-path now. No live traversal exists. Downgraded to INFO. |
| R5 | Packaging bloat **closed** (my F-34, on the strength of a `files[]` manifest existing) | **Refuted by measurement.** `npm pack` = 585.7 MB / 1.88 GB unpacked / **81,770 files** vs 1,112 tracked. Nested `mission-control/node_modules` (1.9 G) + `.next` (139 M) ship. *Worse* than the 375 MB previously recorded — it regressed. |

Two prior OUT_OF_SCOPE worries were **closed** by this review: strict-signed deploy is the runtime *default* (`deploy-trigger-auth.mjs:45-47`; the in-code "opt-in" comment is stale), and the scheduler no longer needs a browser tab (`bin/scheduler-heartbeat.mjs`). One hypothesis of mine was **refuted**: the inject-server retry loop does *not* outlive its caller — it is fully awaited before `close()` exists.

---

## 1. Root-cause map

| Cause | Statement | Findings |
|---|---|---|
| **A** | Authorization ≠ reachability, **on the state plane** — control messages are signed; the KV + collab planes they guard are not | R1, A-1, A-2, A-3, F1, F2, F3, F4, F5, mc-mesh-massassign, F-22 |
| **B** | Allowlists are lists of **code-exec primitives** | F-22, F-23, F-24, tests-2 |
| **C** | Untrusted input → **shell / env-file** | F-15, F-05, F-11, pair-session-shell-injection, new-plan.sh sed |
| **D** | Secrets on **argv / in transit / at rest** | F-10, services.sh sed, R1 lease disclosure, tracer-secret-capture, TOCTOU, `.bak` |
| **E** | Gates certify **presence, not function** | F-04, tick close_gate, R2, R3, openclaw-stack, node-watch, CI pack gate |
| **F** | The green suite **certifies the vulns as safe** | tests-1, tests-2, tests-3, tests-4, tests-5, tests-6 |
| **G** | Lifecycle / packaging / supply chain | R5, F-01, F-06, components.sh, natsUrl, consolidate --dry-run, curl\|sh |

---

## 2. HIGH findings (33)

### Mesh authorization — the core cluster

| ID | Finding | Location |
|---|---|---|
| F1 / R1 | **Owner-authz bypass via lease-token disclosure.** `mesh.tasks.get`/`.list` have no authz and return `owner` + `lease_token`; the owner path accepts a plaintext `node_id` fenced only by that token. Chain: `get` → read fence → `complete{node_id:owner, lease_token}` → force-complete with fabricated result. Also bypasses fail/start/heartbeat/attempt/release. | `operator-auth.mjs:136-147`, `mesh-task-daemon.js:526,536`, `mesh-tasks.js:171-175,281` |
| F2 | **`mesh.collab.reflect` unauthenticated.** Reflections drive `evaluateRound` → `markCompleted`/`markFailed` of the **parent task**, with no owner/operator gate — an authz-free route around `handleComplete`. Membership comes from the equally unauthenticated `collab.join`. Forge `vote:"converged"` + artifacts → task completed with attacker content; `vote:"blocked"` → abort/fail. | `mesh-task-daemon.js:1078`, `mesh-collab.js:472-506` |
| F3 | **`mesh.collab.leave` unauthenticated.** `removeNode` filters out whatever `node_id` the message names, no caller check. Sessions enumerable via unauthenticated `collab.recruiting`/`status`. Remove members below `min_nodes` → `markAborted` + `markFailed(task_id)` = DoS on any in-flight collab task. | `mesh-task-daemon.js:968`, `mesh-collab.js:382-388` |
| A-1 | **Shared KV state store written unsigned.** `putMeshTask` does an unconditional `kv.put` (no CAS, no auth); `updateMeshTaskCAS`'s authority check gates on the writer's **own self-asserted** `NODE_ROLE`/`NODE_ID`, so anything running as role=lead overwrites any task. Bypasses `handleSubmit` entirely. | `mission-control/src/lib/sync/mesh-kv.ts:99,100-138` |
| A-2 | **nkey worker deny-set misses the KV plane.** `WORKER_PUBLISH_DENY = ['mesh.deploy.trigger','$JS.API.STREAM.DELETE.>']` — not `$KV.MESH_TASKS.>`, `MESH_PLANS`, `MESH_COLLAB`. So A-1 holds in **both** auth modes; per-node nkeys do not restrict per-key KV writes. | `bin/nats-auth-render.mjs:48` |
| mc-mesh-massassign | **MC PATCH = unbounded mass-assignment.** `const {revision, ...updates} = body; {...current, ...updates}` spreads every client key over the stored task, no whitelist. On a default-lead node the origin check is skipped → rewrite scope/metric/status/origin of any queued task, reset completed → runnable. | `api/mesh/tasks/[id]/route.ts:46-74` |
| F-22 | **`mesh.tasks.submit` requires no signed operator action** — only `validateMetricCommand`. Any bus participant submits a task whose `metric` runs via `spawn('bash',['-c',metric])`. | `mesh-task-daemon.js:144` |

### Code-execution allowlists

| ID | Finding | Location |
|---|---|---|
| F-22 (bypasses) | **The metric allowlist is a list of RCE primitives.** Fuzzed against the real validator — all ALLOW: `npm run build --prefix /tmp/attacker`, `npm run <any-script>`, `pytest -p evilplugin`, `make test -f /tmp/Makefile`, `npm test \| sort --compress-program=/bin/sh`, `node --inspect-brk=0.0.0.0:9229 t.js`. The `\|grep\|head\|tail\|wc\|sort` safe-pipe exception is itself a hole. | `lib/exec-safety.js` |
| F-23 | **Server-side exec allowlist, same class:** ALLOW `npm install evil-pkg` (postinstall RCE), `node /tmp/x.js`, `go generate ./...`, `find / -fprintf /tmp/x %p`, `cargo build` (build.rs). Bites only where a remote responder trusts it (the in-repo responder is absent). | `lib/exec-safety.js` |
| pair-session | **Shell injection** — `spawn('sh',['-c', \`cat "${promptFile}" \| ${claudePath} -p --model ${MODEL}\`])` interpolates `--model` and the `--artifact-dir`-derived path. **PoC RCE** via `--model 'sonnet; rm -rf ~ #'`. Operator-trusted today; RCE if args ever become task/mesh-derived. | `workspace-bin/pair-session.js:160` |

### Install & supply chain

| ID | Finding | Location |
|---|---|---|
| F-15 | **Join token → env-file line injection (PoC executed).** `parseJoinToken` only type-checks; `updateEnvFile`'s `setKey` writes `${key}=${value}` with no newline check. A `\n` in `lead_identity_pubkey`/`nats_auth`/`nats`/`provider` writes arbitrary lines into `~/.openclaw/openclaw.env`. PoC produced `LLM_BASE_URL=http://attacker.example` and `OPENCLAW_NATS=nats://attacker.example:4222`. The worker **cannot** verify the token HMAC by design. | `bin/openclaw-node-init.js:140-143` |
| F-10 | **Every secret on the sed command line** (world-readable via `ps`): ANTHROPIC/OPENAI/GOOGLE keys, DISCORD/TELEGRAM tokens, `OPENCLAW_NATS_TOKEN`. Not rare — `envsubst` is in no dependency list and absent from stock macOS, so this is the **normal macOS path**. The correct env-based pattern exists 40 lines below. | `scripts/install/config.sh` generate_config |
| components.sh | **`sudo npm install -g companion-bridge`** — unscoped, unpinned, **as root**. Exactly the class the team removed for `npx openclaw-mesh`. Registry-squat = root RCE on every fresh Linux node. | `scripts/install/components.sh:209,211` |
| config.sh:169 | **First `--cluster-peers` install aborts 100%.** Unguarded pipe-in-assignment under `set -euo pipefail`: grep exits 1 → pipefail → assignment fails → `set -e` kills the installer mid-config. Siblings at `:253`/`:289` wrap `{ grep \|\| true; }`. **PoC-confirmed.** | `scripts/install/config.sh:169` |
| F-01 | **nats-server installed by two implementations with different trust posture.** `bootstrap.sh` pins SHA256 and refuses on mismatch; `prereqs.sh` — the path `install.sh` actually uses — pipes the same tarball to `tar xz` with **no checksum** and `sudo install`s it. | `bootstrap.sh:229-244` vs `prereqs.sh:144` |
| R5 | **npm pack ships 1.9 GB of nested `node_modules` + 139 MB `.next`** — 585.7 MB packed / 1.88 GB unpacked / 81,770 files vs 1,112 tracked. Mechanism proven in a sandbox repro: npm's node_modules strip applies **only at package root**; a `files[]` directory entry includes the whole subtree, and `.next` is never default-ignored. | `package.json:27` (`files[]`) |

### Test integrity

| ID | Finding | Location |
|---|---|---|
| tests-1 | **The peer-facing privacy filter has NO positive-path test.** All four cases hit fail-closed early returns; the actual drop-private logic never executes. A regression returning `results` unfiltered would leak private memory to peers and keep the suite green. | `test/broadcast-offerer.test.mjs:234-268` |
| tests-2 | **The security suite certifies the bypasses as safe.** `:290` asserts `npm run build` → allowed=true; never tests `pytest -p`, `node --inspect-brk`, `make -f`, `sort --compress-program`. Green certifies a validator that permits RCE. | `test/exec-safety.test.js:290-295,393-419` |
| tests-3 | **`updateEnvFile` newline injection has no negative test** — tested only on clean values. PoC: injecting `OPENCLAW_DEPLOY_TRUSTED_KEYS=EVILKEY` writes both lines. | `test/node-init-render.test.mjs:93-104` |
| tests-4 | **~38 live-bus/consensus/federation describe blocks SKIP in CI.** Skipped describes register **zero** tests, so "2213 passed / 5 skipped" hides that the entire distributed layer runs zero assertions in the green run. | 14 test files |

### Governance & operability

| ID | Finding | Location |
|---|---|---|
| R2 | **Governance forcing-function is self-serviceable** (see Corrections). | `.claude/hooks/scope-check.sh:125-131,223` |
| R3 | **Force-push not blocked at the git layer** (see Corrections). | `config/git-hooks/pre-push:9` |
| node-watch | **A healthy DEFAULT single-node install grades core BROKEN.** `fabric.services` hardcodes the R=3 labels (`nats-1/2/3`) as required core, but `service-manifest.json` makes single-node `openclaw-nats` the autostart default with nats-1/2/3 `autostart:false`. | `lib/node-watch.mjs:446-457` |
| openclaw-stack | **On Linux every non-port daemon is reported DOWN even when systemd has it active.** `statusTable` sets `pid = darwin ? … : null`, and `classify` returns DOWN without a pid. `up`/`status` exit 1 and fire a false "not running" popup on a fully live node. | `bin/openclaw-stack.mjs:110,95-101` |
| F-35 | **LLM-agnosticism breaks at memory ingest.** The agent is genuinely agnostic (9 providers, `resolveProvider` throws rather than defaulting). But `transcript-sources.json.template` points only at `~/.claude/projects/**` and `transcript-parser.mjs` ships only `claude-code` + `openclaw-gateway` adapters. A `--provider=openai/gemini/kimi` node runs that mind and ingests **nothing** from its sessions — invisibly. | `lib/transcript-parser.mjs:44-157`, `config/transcript-sources.json.template` |

---

## 3. MED findings (58, grouped)

### Crypto (defense-in-depth gaps in an otherwise sound core)
- **CRY-1 — No domain separation.** `verifyOperatorRequest` never checks `operator_action === true`; the marker is *signed but never read*. On a lead the operator allowlist **is** the node's own identity — the same key signing federation/broadcast events. PoC: a federation-shaped event signed by that key returns `{ok:true,"verified"}` from `verifyOperatorRequest`. Latent only because no current signed message carries `task_id`/`plan_id`. `operator-auth.mjs:103-111`, `node-identity.mjs:593-609`
- **CRY-2 — Replay cache skipped when `event_id` absent.** Guard is `if (opts.seenIds && event.event_id)`; no verifier *requires* `event_id`. PoC: a no-`event_id` request verifies twice, cache size 0. `node-identity.mjs:560`
- **CRY-3 — Seen-cache is an in-memory wall-clock Map.** Any daemon restart clears it, reopening the 5-min (operator) / 15-min (deploy) replay window. `operator-auth.mjs:54`, `deploy-trigger-auth.mjs:36`

### Memory
- **`natsUrl` ReferenceError kills both federation CLIs on startup.** Both reference an undeclared `natsUrl` one line after connecting; `main().catch` then `exit(1)`. Tests use the exported factories, so the suite is green while both CLIs are dead on first run. **Reproduced.** `memory-subscriber.mjs:268`, `memory-promoter.mjs:352`
- **Privacy filter not truly fail-closed on the federation-offerer path.** `privateSessions` is built entity-only from `mentions JOIN entities WHERE private=1`. Leaks: (a) sessions with zero extracted entities (the norm under `--skip-llm`), (b) sessions whose only private content is a private *decision*. Channels 1/2 apply no SQL-level privacy and rely solely on this filter. `retrieval-pipeline.mjs:507-563,603-626`
- **`consolidate --dry-run` mutates the DB.** Only the vault block is gated; `decayWeights` (archives + DELETEs), `pruneStale` (DELETEs), `reinforceCoOccurrence` and the promotion fingerprint write all run unconditionally. A "preview" irreversibly decays memory. `bin/consolidate.mjs:96-163`
- **Inject-server `close()` leaks SQLite handles** — releases only the HTTP server; `knowledgeDb`, `extractionDb` (+ possible graphCache) stay open with WAL/shm. `memory-inject-server.mjs:403-408`
- **`memory-maintenance` omits `mcAuthHeaders()`** on 3 of 5 MC calls → consolidate/graph POSTs silently 401 and the catch swallows it → consolidation + graph seeding **never run**. Explains the CLAUDE.md "consolidation false-busy" note as a **code defect**. `workspace-bin/memory-maintenance.mjs:345,383,399`
- **`tracer.js` captures string args verbatim** (first ~40 chars) into `args_summary`, persisted to shared SQLite **and republished on NATS `openclaw.trace.*`**, unredacted. Object args expose only key names, so a live leak needs a traced fn with a secret *string* positional arg — latent. `lib/tracer.js:128-149`, `lib/obs-db.js`

### Install / dry-run honesty
- **`--dry-run` cannot fail** — `DRY_RUN_ERRORS` is incremented and **never read**, despite the documented "exit 1 if any source path is missing". `helpers.sh`
- **`loginctl enable-linger` runs for real on `--dry-run`** (the timer branch's `continue` skips the render, not the `INSTALLED_COUNT++`, so the gate opens). `services.sh:194`
- **Three env-file writes fire on `--dry-run`** — `OPENCLAW_NATS_TOKEN` (generates + writes a real token), `LLM_MODEL`, `LLM_BASE_URL`; siblings at `:43`/`:293` *are* guarded. `config.sh:54,68,71`
- **`--update` clobbers operator-edited `notify.json`** — the `! $UPDATE_ONLY` guard inverts, so every update rewrites the shipped default. `services.sh:230-247`
- **A malformed existing `settings.json` aborts the install mid-run** (jq non-zero under `set -e`, leaving a partial install). **PoC-confirmed.** `integrations.sh:195-220`
- **NATS token on argv in the unit renderer too** — `services.sh:76/125/165` sed fallback, both platforms. Same class as F-10.
- **`xargs` corrupts env values.** Values run through `xargs` get shell quote processing: `K=abc'def` → **empty** (proven). Chain: empty token → `[ -z ]` true → a *second* `OPENCLAW_NATS_TOKEN=` line appended → `nats-resolve.js` reads the **first** match → bus-wide auth split-brain from one quote. `config.sh`
- **`set_env_key` unescaped sed replacement** — a value with `\|`, `&` or newline corrupts/injects; on sed failure a `.bak` copy of the secrets file is left behind. `helpers.sh:50`
- **ollama is contradictory** — code calls it optional ("degrades to regex", warn) but both gates make it fatal unless `OPENCLAW_SKIP_LLM=1`.
- **`prereqs.sh` claims to be "the single implementation"** while `bootstrap.sh` carries a third full copy; divergence already happened (F-01).

### Services / lifecycle
- **No systemd unit orders after the bus** — all 20 declare only `After=network.target`; none `After=`/`Wants=` any nats unit.
- **`Restart=always` + `RestartSec=5` with NO `StartLimit` anywhere** = perpetual 5 s crash loop (12 daemons), against weekly-only log rotation → unbounded `.err` growth.
- **`ExecReload=/bin/kill -HUP $MAINPID` blanked by envsubst** at install → `systemctl reload openclaw-nats` fails silently on Linux → `openclaw-trust-peer --sync-nats` reload broken. **PoC-verified.** `services/systemd/openclaw-nats*.service:9`
- **`${CLAUDE_PROJECT_*}` never exported** → envsubst renders `~/.claude/projects//` (empty segment). `config/transcript-sources.json.template:5,11,17`
- **Gateway grades WORKING on a session JSONL up to 24 h old** — a wedged gateway reads healthy. `node-watch.mjs:373-380`
- **Every node-watch service/process probe is darwin-only** → Linux nodes get **zero** running-state truth. `node-watch.mjs:347,375,448,485`
- **`openclaw-stack up` force-starts the manual-only mesh-agent** despite `autostart:false` and an explicit "load manually" comment. `openclaw-stack.mjs:138-162`

### Governance
- **Runtime-Evidence trailer is spoofable** — a presence-only grep on a commit message the tick's own agent writes, and the tick holds `Bash(git:*)`. `plan-tick.sh:243-270`
- **close_gate keyed on VERSION change only** — closing a row by flipping the checkbox without bumping VERSION bypasses the gate entirely. `plan-tick.sh:272`
- **workplan-viewer exposes unauthenticated state-changing endpoints** on loopback (`/block` writes attacker-controlled BLOCKED.md, `/automation/tick` spawns ticks, config PUT sets arbitrary `tick_command`) — no session token, no Origin/CSRF, in contrast to MC which the same remediation hardened. `workplan-viewer.mjs:2756-3007`
- **`new-plan.sh` sed-delimiter injection via the GOAL argv** — GNU sed `e` = RCE; PoC wrote an arbitrary file. `new-plan.sh:29`

### Federation (BLOCKED — pre-staged)
- **Premature-convergence guard does not do what its comment claims** — `min_quorum` defaults to `min_nodes` (2), not `recruited_count`, so 5 recruited / 3 dead / 2 survivors both voting converged passes UNANIMOUS. **PoC.** On the D3 reliability-failure path. `mesh-collab.js:133,612-617`
- **Benchmark cost figures internally inconsistent** — pair5 records solo `output_tokens: 75` for a 5,014-char artifact (physically impossible); solo counts one message's cost while grappe sums a best-effort accumulator. The "~11× cost" headline is not trustworthy. *(Blinding itself REFUTED as fair — a real per-pair `crypto.randomInt` coin flip.)*
- **`fed-chaos killOneAgent(nodeId)` ignores `nodeId`** and `pgrep`s an unanchored `mesh-agent` → kills an arbitrary PID. `fed-chaos.mjs:66-67`

### Mission Control
- **Notifications `<a href={e.url}>` has no scheme check** — the ledger is daemon-written (cross-node), and `notify.mjs` doesn't validate on write either, so a `javascript:` URL fires in the authenticated operator session that holds the token. `notifications/page.tsx:161`
- **`collab.create`/`collab.join` unauthenticated** — slot occupation → voting control (with F2). `mesh-task-daemon.js:905,941`
- **6 moderate MC advisories** (esbuild dev-server SSRF via `@esbuild-kit` → drizzle-kit, `@vitest/mocker`) — **all devDependencies**, not reachable in the shipped Next runtime, below the `--audit-level=high` gate.

---

## 4. LOW / INFO (53, condensed)

**Install:** secret-file TOCTOU (written at umask then chmod 600) · `.bak` secret leftover on sed failure · git hooks never refreshed on `--update` · `cd`-then-npm race in `workspace.sh:96` · unpinned `curl|sh` for ollama/tailscale/NodeSource (root for the last) · `npx --yes typescript@5` at install, unpinned, runs even under `--sandbox` · empty NODE_ID on a non-ASCII hostname · provider tie-break silently seats claude first · `generate_config` chmod 600 skipped on the "already exists" path.

**MC:** `cowork/intervene` sends an **unsigned** leave/stall with an unvalidated `nodeId` interpolated into a NATS subject, unlike its signed siblings · client `task_id`/`id` used verbatim as KV key / PK with no `isSafeId` → unconditional `kv.put` can overwrite an existing task · `system/restart` string-form `rm -rf ${cwd}/.next/cache` (not injectable; dev-only) · `force_done` bypasses the done-gate (not a boundary against the token holder) · SWR fetcher has no `r.ok` check.

**Mesh:** `handleClaim` `node_id` spoofable → targeted starvation · `mesh-deploy-listener:182` shell-interpolates `OPENCLAW_REPO_URL` on the bootstrap path · `lane-watchdog` `fs.unwatchFile` on `fs.watch` handles is a no-op cleanup; log-injection can force `SIGUSR1 resetAllLanes` · `mesh-health-publisher:216` shells `peerIp` from tailscale JSON.

**Crypto:** owner path carries no signature (security reduces to `lease_token` confidentiality) · JS/TS twin diverge on `OPENCLAW_HOME` → possible MC bus lockout in nkey mode (nkey *math* verified byte-identical) · `createIdentityRegistry` JSDoc says `tofu`, code defaults to secure `strict`.

**Federation:** grappe `join`/`issue-token` read-modify-write with no CAS (concurrent joins lose members) · `peerToRoute` misparses bare IPv6 and cred-bearing peers · D11 guard is a denylist so a custom `mesh-providers.json` local provider bypasses it · `dogfood` `signature_failure` metric can essentially never fire · non-constant-time join-token hash compare · `hyperagent logTelemetry` dedup keeps a stale `execution_class`.

**Misc:** `kanban-store:161` `LIMIT ${limit}` string-interpolated · `notify.mjs` `esc()` doesn't escape backslash · `capability-evolver` skill `execSync(process.env.INTEGRATION_STATUS_CMD)` · kanban projection persists federation event fields with no authenticity check at that layer · `nats-resolve` builds a RegExp from an unescaped key · header says "4-step chain", doc says "3-step" · `npm prepare` points `core.hooksPath` at a tracked, PR-modifiable directory · `sync-canonical.sh` silently clobbers silo-local edits · `fed-chaos` hardcodes a machine-specific REPO path · light node-watch tick overwrites the deep snapshot · `nats-1/2/3.conf` cluster block has no authorization unlike `nats-cluster-node.conf` · CI packaging gate is **presence-only** (no assertion that node_modules/.next are absent, no size ceiling) — the 1.9 GB bloat sails through green.

---

## 5. GOOD — attacked and held (29)

Agents were explicitly tasked to **refute** these. They could not.

- **Signing core.** ed25519; canonicalization covers every key except `signature`/`signer_pubkey`; no security-relevant field is addable post-sign (tamper test); recursive deterministic key sort; sign/verify bytes identical; strict-by-default across both call shapes; fail-closed on missing sig. Base64 malleability does **not** bypass the allowlist (exact string compare neutralizes it — PoC built a colliding variant). `bad-pubkey-length` rejects non-32-byte keys; empty allowlist fails closed. Registry strict mode truly refuses key overwrite. Join-token HMAC is constant-time and correctly lead-only.
- **MC auth.** Middleware runs on all paths; session token required on **every** `/api` method including GET; non-loopback Host denied; `Origin == Host`; timing-safe compare; one-time `?token` bootstrap stripped via 303.
- **safe-path.** realpath jail after symlink resolve, structural secret-shape refusal, size caps. The 13 "unguarded" routes are not traversable.
- **No SQLi, no SSRF** anywhere in MC: all SQL parameterized or constant; the only server-side outbound fetch is a hardcoded Gemini endpoint.
- **The one `dangerouslySetInnerHTML`** strips all attributes from `<mark>` and escapes everything else — PoC with `img/onerror`, `script`, `onmouseover` all neutralized.
- **Collab CAS.** `claimRecruitClose` / `claimRoundEvaluation` are correct single-winner claims; `_updateWithCAS` retries correctly on 10071.
- **Consolidation math.** Decay anchors on `max(last_decayed_at, last_recalled)` so cycles compose instead of re-applying; both paths clamp to [0,1]; reinforcement credited once per cycle; archive resurrection returns at 0.15 not full salience; `mention_count` derived, `reinforcement_count` separate — neither inflates per flush.
- **Embedder degrades, does not hang** — throws a clear "model not cached" error, caught by the channel wrapper; retrieval falls back to the other channels.
- **scope-check path defenses.** `..` refused, symlink chain bounded + physical canonicalization + escape block, fail-closed on empty input. *(The hole is self-auth, not path evasion — see R2.)*
- **workplan-viewer launchctl control** uses `execFile`/`spawn` array argv + plist XML escaping — no shell or plist injection from plan ids.
- **D11 grappe guard** is mechanically enforced and declines locally rather than failing mesh-wide.
- **Benchmark tally** enforces the 5-dimension rubric and the D3 bar, and refuses a verdict on partial scoring.
- **No committed secrets** in the 537 skill/soul files (all `*_API_KEY` hits are env-var *names*); no `curl|sh` in shipped skill scripts.
- **Both lockfiles clean** — 100% registry-resolved, all integrity hashes present. Root audit: **0 vulnerabilities**. Overrides (`sharp ^0.35.4`, `fast-uri ^3.1.4`) are correct floors masking no transitive vuln.
- **CI gates hard-block** — no `continue-on-error` anywhere; audit, lint, build and tests all fail the merge.
- **No secret leakage into logs** — the only token `console.log` sites print the join token, which is public-data-only by design; the nkey seed is never logged.
- **node-watch honesty core** — freshness-based graders, `healthPct` null-on-nothing rather than 100.
- **Resource hygiene** — heartbeat/circling timers cleared, deploy concurrency flag safe under the single-threaded loop, NATS drained on SIGTERM.

---

## 6. Dismissed — verified NOT defects (do not re-investigate)

- `mesh-deploy-listener` **branch injection is closed**: `trigger.branch` is charset-filtered *and* equality-checked, so any stripped char throws; `=` is outside the allowlist, which also blocks the `--upload-pack=` argument-smuggling variant. `trigger.components` is filtered through an allowlist Set.
- `git clone "${repoUrl}"` — `repoUrl` is a `--repo` CLI flag with a constant default, **not** a join-token field.
- `mesh.js cmdHealth` `localArgs` is literally `'--json'` or `''`.
- `mesh/nodes` `execSync` runs only **constant** commands — not injectable from a request.
- The 4 template vars missing from the sed fallback live only in `nats-cluster-node.conf`, which `generate_config` never renders.
- A direct KV write of a hostile `metric` does **not** gain RCE — `mesh-agent.js:844` re-runs `isAllowedMetric` before spawn. A-1's impact is state tampering, not new code-exec. *(Recorded to prevent over-claiming.)*
- Benchmark A/B assignment is **not** a fixed-position confound — a real per-pair coin flip; sealed key/meta sit outside the scorer path.

---

## 7. Empirical ground truth

| Check | Result |
|---|---|
| Root suite, authenticated nkey bus, Node 22.22.2 | **2213 tests / 2208 pass / 0 fail / 5 skipped** |
| Root `npm audit --audit-level=high` | **0 vulnerabilities** |
| Mission Control audit | 6 moderate, **all devDependencies**, 0 high |
| MC lint / vitest / production build | green |
| `npm pack --dry-run` | **585.7 MB packed / 1.88 GB unpacked / 81,770 files** ⚠︎ |
| Inject-server teardown race | did not fire this run; **still latent** |

The 2213-pass number is real **but partial** — see tests-4: the distributed tier contributes zero assertions in CI.
