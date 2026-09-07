# OpenClaw-node — Deep Adversarial + Lifecycle Review

**Date:** 2026-09-06 · **Branch:** `claude/opencalw-node-adversarial-review-pedrcw` · **HEAD:** `8fc03f8`
**Method:** 7 surface reviews (mesh, memory, Mission Control, installers/shell, federation/knowledge/viewer, skills/souls, tests/CI/governance) + 5 end-to-end lifecycle traces (install→node, node join→removal, task, session/memory, governance→release). Every finding was verified by reading exact lines; a subset was reproduced by running the code in isolation. Read-only — the review changed no repo files.

Trust model behind most mesh findings, stated once: **NATS authorization is a single flat shared token**. Every worker's `~/.openclaw/openclaw.env` holds it; any holder can publish to any subject, and `node_id` is self-asserted in message bodies. "A peer with the token" equals "full authority over the mesh."

---

## 0. Verdict

Ambitious architecture with genuinely strong pieces (ed25519 federation signing, `readonly-sql.mjs`, `deploy-trigger-auth.mjs` in strict mode, KV task-claim CAS, atomic writes). But security rests on a flat shared secret, and the governance machinery is largely honor-system: the only mechanically enforced gate is a bypassable write-intent hook. CI has been red on `main` for three weeks while every status doc claims a green suite, and the one-command installer runs an unrelated third party's npm package. The worst concrete defects: RCE reachable from a task payload, unauthenticated secret disclosure from Mission Control, and a supply-chain hole in install.

---

## 1. Critical

**C-1 · RCE from a task payload through a bypassable shell filter.** `lib/exec-safety.js:19`, `bin/mesh-agent.js:745` (`isAllowedMetric`), `lib/llm-providers.js` (`validateShellCommand`) are three divergent copies of one regex. None blocks the single `&` background operator or redirect-without-space. A `metric` of `npm test & rm -rf ~` or `echo x>~/.ssh/authorized_keys` passes, then runs via `spawn('bash',['-c',metric],{env:process.env})` at `bin/mesh-agent.js:759` — RCE with the full env. Reproduced: shared validator returns allowed for `echo ok & bash /tmp/evil.sh` and `echo pwned>/tmp/x`; worker gate also allows `node /tmp/evil.js` by prefix. The `shell` provider (`lib/llm-providers.js:190`) runs `task.description` the same way on the solo path where the worker-provider guard (`:1200`) is not applied.

**C-2 · No daemon-side validation of the exec input.** `bin/mesh-task-daemon.js:104` (`handleSubmit`) stores `metric` unvalidated; `bin/mesh-bridge.js:203` copies it from `active-tasks.md`. The shared validator is wired only to the low-value `postCommitValidate` path, not this primary network path.

**C-3 · Work is git-merged to `main` before the review gate.** `commitAndMergeWorktree` (`bin/mesh-agent.js:1662`,`:1707`, `git merge --no-ff` into main) runs immediately before the `mesh.tasks.complete` call (`:1670`/`:1715`) that decides whether review is needed. `solo_mesh` with a metric → `needsReview=false` (`metric_auto_approved`), so attacker code passing its own metric (C-1) merges to main and auto-completes. Reject re-queues but never reverts the merge.

**C-4 · Unauthenticated secret disclosure from Mission Control.** `mission-control/src/lib/server-auth.ts:63`: every GET/HEAD/OPTIONS under `/api` is allowed once `Host` is loopback — no cookie, no token. `api/memory-file`'s basename denylist (`route.ts:36`) misses `openclaw.json` (gateway operator-admin token), `.env`, `auth-profiles.json`, `.env.local` (`GEMINI_API_KEY`), and `agents/main/sessions/*.jsonl`. `GET /api/memory-file?path=openclaw.json` returns the gateway token. Reachable by any local user, `ssh -L`, or Host-rewriting proxy. `api/workspace/read` and `api/memory/doc` (no size cap, no realpath) are the same class.

**C-5 · The installer runs an unrelated third party's npm package.** `scripts/install/integrations.sh:41` runs `npx openclaw-mesh` when Tailscale is connected and no `mesh` binary exists — the repo ships `bin/mesh.js`, never `mesh`, so the guard is always false. Registry confirmed: `openclaw-mesh` is one 0.0.1 version by maintainer `yoyooyoooyoooo` (2026-01-30), an unrelated workspace skeleton. This is the state after the documented `install.sh --update --enable-services`. Whoever owns that name gets code execution on every node.

**C-6 · CI red on `main` for three weeks while docs claim green.** Actions runs #158–#165 (2026-08-02→08-25) all `failure`; docs claim "suite 1550/0". Real run: 1892 tests, 1884 pass, 1 fail (`test/install-modules.test.mjs:102`, broken by `a533083` which touched no test), 52 skipped describe blocks (~148 tests) shown as "skipped 7". Both `npm audit --audit-level=high` gates fail (root `fast-uri` override `^3.1.4` inside the vulnerable range; MC `next@16.2.10` with middleware-bypass GHSA-6gpp-xcg3-4w24). The done-contract gate is non-functional; commits shipped on a red pipeline; the mirror republishes each broken push (H-9).

---

## 2. High

**H-1 · complete/start/cancel/approve/reject have no ownership check.** `bin/mesh-task-daemon.js:243/227/511/535/555` never compare `node_id` to `existingTask.owner`; only `handleFail` (`:370`) does. Any token holder completes another node's task with a fabricated result, self-approves a `pending_review` task, or force-requeues one.

**H-2 · Prompt injection through stored memory into `bypassPermissions` workers.** Transcript enters the extractor with no data boundary (`lib/extraction-prompt.mjs:251`), stored unbounded (no `max()` in `lib/extraction-schema.mjs`), the `[memory:]` frame breakable via embedded `[end memory]` (`lib/memory-formatter.mjs`), injected into the system message and into mesh workers running `claude -p … --permission-mode bypassPermissions` (`lib/llm-providers.js:91`). 200 KB block reproduced.

**H-3 · Unsigned deploy triggers accepted by default.** `lib/deploy-trigger-auth.mjs:95`: `OPENCLAW_REQUIRE_SIGNED_DEPLOY` unset → `unsigned-allowed`; any token holder forces fleet `git reset --hard` + redeploy. Service units set the strict flag; the join path does not — inconsistent fleet trust.

**H-4 · Kanban field injection via un-escaped newlines.** `lib/kanban-io.js:278` and `mission-control/src/lib/parsers/task-markdown.ts:387` write `  key: value` with no newline sanitization. A peer-controlled `result.summary` with embedded `\n  metric: …` becomes real fields. Reproduced.

**H-5 · Workplan viewer: unauthenticated exec + path traversal.** `workspace-bin/workplan-viewer.mjs` loopback, zero auth. `PUT /automation/config` sets `tick_command`/`working_dir`; `POST /automation/run-once` spawns them (`:2990`); `/automation/load` persists as launchd. `GET /api/plans/<id>/stream?log=../../../../etc/passwd` reads arbitrary files (missing the `safeJoin` its `/doc` sibling uses).

**H-6 · Mesh has no pre-execution approval gate.** `bin/mesh-bridge.js:174` dispatches on `execution==='mesh' && status==='queued'` with no approval check; the MC scheduler that honors approval excludes mesh (`scheduler.ts:324`). Any `queued`+`mesh` card runs.

**H-7 · Inject-server bearer token on the curl command line.** `bin/mesh-agent.js:202` `execFileSync('curl',[…'authorization: Bearer '+token…])`; argv is `ps`-visible, defeating the 0600 token file. Any local process dumps the operator's memory.

**H-8 · Join token integrity never verified on consume.** `bin/mesh-join-token.js:117` computes an HMAC; `mesh-install.sh:144` greps only `repo` and `bin/openclaw-node-init.js` never reads the token (0 refs). Forged/expired token with attacker `repo` → clone + execute. Reproduced.

**H-9 · Mirror workflow leaks a PAT and republishes every branch, gated by nothing.** `.github/workflows/mirror.yml` on `branches:['**']` `git push --mirror`s to `guibros/openclaw-node` with `secrets.GUIBROS_PAT`, no `permissions:`, no `needs: tests`. `--mirror` propagates deletions/rewrites. Mirror succeeds on the same SHAs whose tests fail.

**H-10 · Self-approval primitive: hardcoded "human".** `bin/hyperagent.mjs:372` `approveProposal(id,'human')` applies the strategy in-transaction stamped `reviewed_by='human'`; `lib/mesh-tasks.js:315` same for tasks. Any agent/cron running the CLI is recorded as human.

**H-11 · Self-evolution engine ingests raw transcripts, can exec an env command, unattended.** `skills/capability-evolver`: `SKILL.md:34` Mad Dog Mode executes immediately; `src/evolve.js:239` `execSync(process.env.INTEGRATION_STATUS_CMD)`; prompt embeds 100 KB raw transcript + MEMORY/USER and directs the agent to edit code, `git push`, publish. Enabled for orchestrator soul.

**H-12 · macOS plists hardcode `nats://127.0.0.1:4222`.** All `services/launchd/*.plist` (bar two using `${OPENCLAW_NATS}`) bake loopback; env wins in `lib/nats-resolve.js:34`. A cluster install rewrites the bus off loopback → every core daemon fails connect forever on a Mac cluster node.

**H-13 · Failed-after-merge deploy never retried.** `bin/mesh-deploy-listener.js` `git merge --ff-only` before the deploy script; on failure the SHA is not re-read but HEAD advanced, so `checkAndCatchUp` (`:260`) sees "up to date" forever. Broken services, no self-heal.

**H-14 · MC full-file rewrite ignores the kanban lock and drops mesh fields.** `mission-control/src/lib/sync/tasks.ts:280` writes with no lock vs kanban-io's mkdir lock (lost-update race); `serializeTasksMarkdown` has no field for `llm_provider`/`llm_model`/`collab_result`/`circling_*`, silently dropped on every DB→md rewrite; the bridge's field-strip alarm watches `execution`, which is preserved, so it never fires.

---

## 3. Medium (grouped)

**Mesh/task lifecycle.** Self-asserted collab membership → Sybil convergence/authorship (`bin/mesh-task-daemon.js:770`, relevant to D15). `bin/mesh-node-remove.js` evicts any node/releases its tasks with only the shared token, hardcodes `nats://100.91.131.61:4222`. Reject→requeue has no cap and re-executes (re-merges) forever; unauthenticated reject = infinite re-execution. `MESH_TASKS` KV has no TTL, tasks never deleted → `store.list()` O(n) degradation over the deployment lifetime. No task lease: a throw right after claim orphans a CLAIMED task and self-blocks the node for `STALL_MINUTES`.

**Mission Control.** Arbitrary-path file write via attacker task/soul ids (`tasks/[id]/handoff`, `souls/[id]/propagate`, `souls/[id]/prompt`). CSRF boundary accepts any `localhost:<port>` origin (viewer/inject-server/gateway UI can drive `/api/system/restart`). `souls/[id]/evolution` approve follows a `proposedChange.target` path from a soul file. Mass-assignment into `openclaw.json`, souls registry, MESH_TASKS KV.

**Memory pipeline.** `mention_count` defeated at the root: dedup index keyed on `turn_index = messageCount-1` (`lib/pre-compression-flush.mjs:447`), which grows every flush → a new mention row per flush; two writers (extraction recompute vs consolidation `+1`) give the column non-deterministic semantics feeding the promotion threshold. Decay archival not terminal: `entities_archived` written by consolidation, never consulted on ingest → decayed entities resurrect at full salience. Decisions/themes/archive have no deletion path; a high-confidence planted decision is a permanent promotion candidate. Consolidation idle gate reads a main-thread snapshot but extraction runs in a worker thread with its own `ollama-queue` singleton → consolidation runs concurrently with extraction on the same DB (false-idle wedge). Four raw `nats.connect()` callers bypass the token resolver and now fail auth. `node_id` from raw `os.hostname()` breaks the envelope regex on odd hostnames.

**Federation/knowledge.** `web-fetch.mjs` no SSRF/scheme/size controls. `mcp-knowledge` HTTP transport no Origin check, no body cap, exposes state-changing `reindex`. Trusted-peer offers inject `[peer-memory]` text. Missing `event-schemas/dist` → infinite NAK loop rather than fast startup fail. `notify.mjs` osascript escaping misses backslash.

**Install/governance.** `openclaw.env` and `mission-control/.env.local` written without `chmod 600` (world-readable token + API keys). `--update` re-renders secret configs and rsyncs over the souls registry MC rewrites. Unpinned `curl|sh`/`sudo npm -g`, unchecksummed nats-server, bootstrap fetches `refs/heads/main`. `validate-commit.sh:59` JS-injection via staged filename. CI pack-count gate asserts 9 install modules; tree ships 11. `cli.js` exit 0 on ENOENT/signal. Bootstrap forces `--skip-llm` but the acceptance gate marks LLM axes required → one-command macOS install aborts before model download. Two install paths create duplicate deploy-listener units on different repo dirs racing `git reset --hard`.

**Skills.** Skill "gate" (`openclaw-skill-scanner`) advisory, fail-open, bypassable (rot13/concat/base64 scored clean; scan failure → auto-install); `install-hook.sh` slug command-injection + `rm -rf` traversal. `prompt-guard/detect.py` reports to a personal `workers.dev` endpoint by default. `memorylayer`/`moltbook-registry` exfil/mainnet by design.

---

## 4. Governance: claimed vs enforced

- Only `scope-check.sh` is mechanically enforced, and only for write-intent on 4 tool names — not tests, evidence, or what reaches main. Bypassable: glob lines match `/`, no canonicalization (`test/../CLAUDE.md` passes), fail-open on empty stdin, agents own their SCOPE.md, `Override:true` self-disables. (It also blocks the Write tool for paths outside the repo entirely when no scope is active — observed this session.)
- Tick "closed" detection (`workspace-bin/plan-tick.sh:208`) checks only that VERSION changed to a non-`-pre/-mid` string. No test run, no INVENTORY parse, no trailer check. The autonomous tick is judge of its own done-ness.
- Runtime-Evidence trailer (MASTER_PLAN §5) enforced nowhere; one WARN counting 15 commits, never run in the tick path.
- `config/git-hooks/*` not installed in the dev repo; only `scope-check.sh` registered in `settings.json`. `AGENTS.md` grounds Codex enforcement in `.codex/hooks.json`; `.codex/` does not exist → Codex agents ungated. `settings.json` has no permissions/deny block, so `validate-push.sh`'s "blocked by settings.json deny" is false; the tick runs `acceptEdits`+`Bash(git:*)`.
- Recent `main` is non-step conventional commits pushed directly; the drift detector is dormant. `repair/SCOPE.md` is active+expired (2026-08-26) so the hook currently blocks all edits; `CLAUDE.md`'s "no active scope" is true only by accident. `repair/COMPONENT_REGISTRY.md` is byte-identical to redesign's, newest stamp 2026-06-01; registries cite zero audit artifacts.

Net: an agent can go edit → commit → self-declare done → public mirror with no gate a machine refuses, and the ledger records it as human-reviewed and runtime-evidenced.

---

## 5. Chained narratives

**N-1 (unreviewed RCE on main).** C-4 → POST a card `execution:mesh,status:queued` with a crafted metric (or H-4 to smuggle these into a `needs_approval:true` card) → H-6 (dispatch, no approval) → C-2 (no daemon validation) → C-1 (`&` bypass → bash -c) → C-3 (merged pre-review) → auto-complete.

**N-2 (autonomous close-the-loop).** H-11 evolver (fed attacker text via H-2) → agent with `acceptEdits`+`Bash(git:*)` edits via Bash (hook blind) → tick "closed" on version string alone → main → CI red but non-blocking (C-6) → mirror republishes publicly, PAT exposed (H-9) → recorded human-reviewed (H-10).

**N-3 (memory poison amplifiers).** Planted entity/decision (H-2); every retrieval boosts salience and resets the decay anchor (never decays while recalled); turn-index inflation + reinforce `+1` push mention_count past the bar; a high-confidence decision is permanent. Honest caveat: the fully-autonomous cross-session loop does NOT close by default (ephemeral publisher wrappers; mesh-worker temp JSONL not in the polled source list), but closes with one config toggle, and the amplifiers inflate promotion signals with no loop required.

---

## 6. What is actually solid

- KV task-claim CAS (no double-claim window).
- ed25519 federation: verify-before-parse, registry binds id↔pubkey, strict default, freshness + replay LRU, cross-field checks; peer content never persisted.
- `readonly-sql.mjs`: fixed DB enum, query_only, keyword allowlist, readonly check, caps — held against ATTACH/PRAGMA/CTE/`;`.
- `deploy-trigger-auth.mjs` strict (tamper/replay/stale/untrusted signer); both service managers set the flag; branch sanitized; sha never reaches git.
- MC `decide()` core: `localhost.evil.com`/`[::1]`/`Origin:null`/missing-Origin deny; timingSafeEqual; 0600 token; matcher covers `/api`; past CVE-2025-29927. SQL parameterized; no exec with request data.
- Atomic writes (tmp+fsync+rename), WAL+busy_timeout, privacy filter fails closed, join secret 0600, no committed secrets.
- Five canonical docs byte-identical across all six silos; `sync-canonical.sh --check` real; MC vitest 102/102 + eslint green.

---

## 7. Highest-value fixes, in order

1. One argv-based executor (execFile, no bash -c) + fail-closed allowlist applied at handleSubmit server-side. Closes C-1/C-2/H-1 class.
2. Move the review gate before commitAndMergeWorktree; never merge to main pre-review (C-3).
3. Require the session token on every `/api/*` method; switch memory-file/workspace-read to a directory allowlist (C-4).
4. Remove `npx openclaw-mesh` from install (C-5); DECISIONS D4 already retired that layer.
5. Per-node NATS identity (nkeys/creds); add ownership checks to complete/start/cancel/approve/reject (H-1).
6. Fix CI red, correct the pack-count gate, add branch protection; scope the mirror to `main` with a read-only token + `needs: tests` (C-6/H-9).
7. Make the done-contract mechanical: tick runs the suite and checks the Runtime-Evidence trailer before "closed" (§4).

---

## 8. Install re-run / dry-run (reproduced)

- **`--dry-run` is not dry.** Several writers bypass the `run()` guard (`config.sh:74-111`, `components.sh:153-165`, `services.sh:233-246`, `integrations.sh`). On a virgin HOME, `install.sh --dry-run` exits 1 at `config.sh:90` (missing dir); on an existing install, `--dry-run --update` rewrites `daemon.json`, `nats*.conf`, `openclaw.json`, MC `.env.local`, and appends a fresh `OPENCLAW_NATS_TOKEN`. Reproduced in a scratch HOME.
- **Re-run destroys the running tree.** Units exec from `${OPENCLAW_REPO_DIR}` and workspace/`~/openclaw` `node_modules` are symlinks into `$REPO_DIR/node_modules` (including the 2 GB embedder cache). Under bootstrap that dir is `~/.openclaw-src/openclaw-node`, which `bootstrap.sh:279` `rm -rf`s on every re-run while daemons are live — crash-loop, dangling symlinks, embedder re-download. No version/SHA marker is written anywhere.
- **`--update` leaves stale code running.** Linux `systemctl --user start` is a no-op on active units; MC rebuilds only when `.next` is absent, so `--update` serves the first-install build forever.
- **Cluster install disconnects daemons from the bus.** `--cluster-peers` renders NATS to listen on the tailnet IP only, but the macOS plists hardcode `nats://127.0.0.1:4222` and env wins in the resolver — every core daemon gets permanent ECONNREFUSED (extends H-12).
