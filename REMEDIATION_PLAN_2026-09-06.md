# OpenClaw-node — Remediation Plan

**Date:** 2026-09-06 · **Companion to:** `ADVERSARIAL_REVIEW_2026-09-06.md` · **Branch:** `claude/opencalw-node-adversarial-review-pedrcw`

This plan turns the review's confirmed findings into an ordered, verifiable fix sequence. It is a plan, not a code change — nothing here is applied. It is structured to run through the repo's own discipline: each phase is a scope batch, each item carries a smallest-fix and a done-contract (test + runtime evidence per MASTER_PLAN §5), and phases are ordered by risk × dependency.

Refuted candidates are excluded and listed at the end so they are not re-investigated.

---

## 1. Root-cause map

~50 findings collapse into six systemic causes. Fixing the cause fixes the cluster.

| Cause | One-line statement | Findings it explains |
|---|---|---|
| **A. Authorization = reachability** | Holding the shared NATS token, or opening a loopback socket, or getting text into a transcript, is treated as authority. | mesh RCE reachability, R4 forgeable approve, R5 completion forgery, plan mass-assignment, MC unauth GET, cookie disclosure, prompt injection |
| **B. Untrusted input → shell** | Task/agent/LLM strings flow into `bash -c`/`execSync` through hand-rolled, divergent filters. | R1 filename injection, R2 bare `&`, R3 shell-provider filter gap |
| **C. Gates certify presence, not function** | `command -v`, HTTP 200, `existsSync`, mtime, a self-written VERSION string, and a bypassable hook stand in for verified behavior. | CI red for weeks, tick "closed" check, honor-system done-contract, scope-check bypasses, unregistered hooks, missing `.codex/`, stall detector blind, inject probe green-on-empty |
| **D. Secrets exposed at rest / in transit** | Secret files are world-readable and tokens ride argv. | `openclaw.env` 0644, `.env.local`, bearer on curl argv, memory-file denylist gaps |
| **E. Lifecycle handoffs assume invariants the prior stage never guarantees** | Each stage trusts the last; none fails safe on death or re-run. | install deadlock, npm-prune of symlinks, `--dry-run` writes, merge-before-review, no task lease, KV no TTL, node-id divergence, mac plists loopback, deploy no rollback, unsigned join token |
| **F. Supply chain is unpinned and unsigned** | Code is fetched from moving/foreign sources with no verification. | `npx openclaw-mesh` (third party), `curl\|sh` installers, no nats checksum, mirror PAT exposure |
| **G. Data integrity / silent failure** | Counters inflate, decayed data resurrects, failures return empty instead of erroring. | mention_count inflation, archive resurrection, field-strip, false-idle consolidation |

**The single highest-leverage fix is A**, and within A the load-bearing piece is mesh event signing — but note the review's own caveat: `verifyEvent` fails open by default (`lib/node-identity.mjs:23`, its own comment) and the registry is trust-on-first-use (`:135`). So "sign everything" is a real project with two default-open footguns to close, not a one-liner.

---

## 2. Phases

Each item: **[id] file:line — smallest fix — done-contract.** One scope batch per phase; keep exactly one scope active at a time.

### Phase 0 — One-line hardening (hours; no behavior change; do first)

These remove the shortcuts that lower the bar for everything else, and unbreak CI so later phases have a working gate.

- **[P0-1] Secrets file perms.** `scripts/install/config.sh:8,37` (and `:153-165` for `mission-control/.env.local`). Add `umask 077` at the top of `install.sh`; `chmod 600` the env files after write (the same script already `chmod 600`s `nats.conf` at `:109`). Done: `stat` shows `600`; add an assertion to `test/install-modules.test.mjs`.
- **[P0-2] Remove the foreign npm package.** `scripts/install/integrations.sh:41` — delete the `npx openclaw-mesh` step (DECISIONS D4 already retired that layer). Done: `grep -r openclaw-mesh scripts/ install.sh` empty; pack-smoke still green.
- **[P0-3] Fix CI red.** Repair `test/install-modules.test.mjs:102` (assert against the current `system-deps.sh`), and correct the pack-count gate `.github/workflows/test.yml:39` from `9` to the actual module count (11) — or make it `grep -c` dynamic. Done: Actions run on the branch concludes success.
- **[P0-4] Contain the mirror workflow.** `.github/workflows/mirror.yml` — set `branches: [main]`, add `permissions: contents: read`, add `needs: [unit-tests]` (or a separate gated job), and replace the broad PAT with a fine-grained token/deploy key scoped to the one target repo. Done: a push to a non-main branch does not run the mirror; workflow references no broad PAT.

### Phase 1 — Close the three RCE sinks (small argv fixes)

- **[P1-1] Scope-revert exec.** `lib/mesh-harness.js:94` — replace `execSync(\`git checkout HEAD -- "${file}"\`)` with `execFileSync('git', ['checkout','HEAD','--',file])`. Done: test with a filename `$(touch pwned).md` shows no side effect.
- **[P1-2] Metric filter + sink.** `bin/mesh-agent.js:744` — `isAllowedMetric` delegates to `lib/exec-safety.validateExecCommand`; run the metric via `execFile` argv, not `spawn('bash',['-c',metric])`; and validate at `bin/mesh-task-daemon.js:104` (`handleSubmit`) so it is rejected server-side, fail-closed. Done: tests show `npm test & rm -rf ~`, `echo x>~/.ssh/...`, `node /tmp/x.js` all rejected; a submit with a bad metric is refused with a log line.
- **[P1-3] Shell-provider filter.** `lib/llm-providers.js:41` — `validateShellCommand` delegates to `validateExecCommand`; drop the `shell` provider from production resolution, or apply `isOpenClawWorkerProvider` on the solo path too (`bin/mesh-agent.js:661`). Done: `python -c`, `make SHELL=` rejected; solo `llm_provider:"shell"` refused.
- **[P1-4] One executor.** Collapse the three regexes into `lib/exec-safety.js`; block `&`, `>file`, `sh -c`, and add the missing git/python/make checks. Done: `test/exec-safety.test.js` gains cases for `&`, `>file`, `node file`, `python -c`, `git -c`, each asserted blocked.

### Phase 2 — Authorization ≠ reachability (the core project)

**2a — Mesh identity (fail-closed).**
- **[P2-1]** `lib/node-identity.mjs:23` — remove the 1-arg default-open `verifyEvent` form; require a signature and an expected node id; fail closed. `:135` — replace trust-on-first-use with a registry pre-seeded at install (lead pubkey pushed to workers; join token binds the member pubkey). Done: unit tests show missing-signature and unknown-signer both rejected by default.
- **[P2-2] Ownership checks.** `bin/mesh-task-daemon.js` — `handleComplete` (`:243`), `handleStart` (`:227`), `handleCancel` (`:511`), `handleTaskApprove`/`handleCirclingGateApprove` (`:535`), and `handlePlanSubtaskUpdate` (mass-assignment) verify `node_id === owner` and/or a signature, mirroring `handleFail` (`:370`). Done: a forged `complete{success:true}` / `approve` from a non-owner is rejected in tests.
- **[P2-3] MC signing identity.** `mission-control/src/app/api/cowork/intervene` and dispatch publish *signed* `mesh.tasks.*` — give MC a node identity so "sign everything" does not break MC. Done: an MC-published task verifies; an unsigned one from elsewhere does not.
- **[P2-4] Strict deploy default.** `lib/deploy-trigger-auth.mjs:95` — default `OPENCLAW_REQUIRE_SIGNED_DEPLOY` to strict; refuse to start the listener unless signing is configured. Done: an unsigned trigger is rejected with the flag unset.
- **[P2-5] Per-node NATS identity (larger).** Move from the single shared token to nkeys/creds with per-subject permissions, so `node_id` is not self-asserted and a token leak is not total authority. Done: a node can only publish its own subjects. *(Stage this last within Phase 2; it is the biggest single change.)* **Delivered as Phase 7 (2026-09-07, federation D17):** identity key = nkey, users list rendered from the registry, `OPENCLAW_NATS_AUTH` token/nkey/nkey-strict (token default), worker publish deny on `mesh.deploy.trigger` + stream delete, every client through the resolver, CI on an authenticated bus. **Not yet:** "a node can only publish its own subjects" — body `node_id` stays self-asserted until subjects embed node ids (D17 limit; follow-up).

**2b — Mission Control boundary.**
- **[P2-6] Auth on every method.** `mission-control/src/lib/server-auth.ts:63` — require the token on `GET/HEAD/OPTIONS` too; stop returning `allow-set-cookie` to unauthenticated GET (`:57`), bootstrap the token via a printed one-time URL. Pin `LOOPBACK_ORIGIN` to the exact `Host`. Consider a unix-socket transport. Done: `curl -sI localhost:3000/` yields no token; `GET /api/*` without token is 401.
- **[P2-7] File routes to allowlist.** `api/memory-file`, `api/workspace/read`, `api/memory/doc` — replace the basename denylist with a directory allowlist + `realpath` + size cap. Done: `?path=openclaw.json` and `?path=...env.local` denied; a large DB read is capped.
- **[P2-8] Sanitize ids.** `tasks/[id]/handoff`, `souls/[id]/propagate`, `souls/[id]/prompt`, `souls/[id]/evolution` — validate ids `^[A-Za-z0-9_.-]+$` and `path.basename` before join. Done: a `../` id is rejected.

### Phase 3 — Make the gates mechanical (governance / CI)

- **[P3-1] Blocking CI + branch protection.** Make `test.yml` a required check on `main`; add `test:strict` and the audit as blocking (fix the `fast-uri` override and `next` advisory first, or the audit gate stays red). Done: a red PR cannot merge.
- **[P3-2] Register the hooks.** `.claude/settings.json` — register `validate-commit.sh`, `validate-push.sh`, `session-*`; add a `permissions`/`deny` block so force-push is actually blocked (today `validate-push.sh:20`'s claim is false). Fix `AGENTS.md:63` — either create `.codex/hooks.json` or remove the claim that Codex agents are gated. Done: a commit with a JS-injection filename is blocked; `.codex/` exists or the doc no longer claims it.
- **[P3-3] Mechanical done-contract.** `workspace-bin/plan-tick.sh:208` — before declaring a step "closed," run the suite and check the commit carries a real `Runtime-Evidence:` trailer; do not treat a self-written VERSION string as proof. `plan-lint`'s trailer check moves from WARN to FAIL and runs on the tick path. Done: a tick with failing tests refuses to close.
- **[P3-4] Harden scope-check.** `.claude/hooks/scope-check.sh:190` — canonicalize the path (`readlink -f`), reject any `..` segment and symlink escape, require the result under `$REPO_ROOT`, and do not let a glob line match `/`. Fail closed on empty stdin (`:36`). Done: `test/gate-mutation.test.mjs` gains a case that `test/../CLAUDE.md` is blocked under a `test/*` scope.
- **[P3-5] Reconcile governance state.** Flip `repair/SCOPE.md` to `idle` (it is active+expired, blocking all edits). Refresh `repair/COMPONENT_REGISTRY.md` (it is a byte-identical copy of redesign's, stamped 2026-06-01). Update `CLAUDE.md`/`AGENTS.md` to reflect D16 and the real dates. Done: `plan-lint` clean; the two docs agree.

### Phase 4 — Lifecycle handoffs

- **[P4-1] Install deadlock.** `bootstrap.sh` runs wave 1 `--skip-llm` but `verify.sh` requires the LLM axes. Make `verify.sh` honor a skip profile (LLM axes → N/A), or run wave 1 `--skip-verify` → wave 2 model pull → one `--update --enable-services` gate. Done: a fresh VM reaches a healthy node from the documented one-liner.
- **[P4-2] npm-prune of symlinked deps.** `scripts/install/components.sh:184` runs `npm install` inside the symlink-only `$WORKSPACE`, pruning the mesh deps (root cause of the vanished-links bug). Install at the repo root; do not `npm install` inside the workspace tree. Done: after install, workspace `node_modules` links survive; a re-run does not delete them.
- **[P4-3] `--dry-run` is not dry.** Wrap every writer (`config.sh:74-111`, `components.sh:153-165`, `services.sh`, `integrations.sh`) in the `run()`/`$DRY_RUN` guard. Done: a dry-run regression test asserts no file under `$HOME` changes.
- **[P4-4] Merge-before-review.** `bin/mesh-agent.js:1662,1707` — move `commitAndMergeWorktree` to *after* the review decision; never merge to `main` pre-review. Done: a task needing review leaves `main` untouched until approved.
- **[P4-5] Task lease + KV hygiene.** Add a lease (fencing token tied to `owner` + TTL) so a dead worker's CLAIMED task requeues; add TTL/prune to `MESH_TASKS`; cap reject→requeue. Done: a killed worker's task requeues within the lease; terminal tasks expire.
- **[P4-6] Node-id canonicalization.** One helper used by `env.sh`, `openclaw-node-init.js`, and the daemons; add `OPENCLAW_NODE_ID` to the linux `openclaw-memory-daemon.service`. Done: the same machine reports one id across MC, health KV, and the event stream.
- **[P4-7] Cluster bus URL.** Render `${OPENCLAW_NATS}` in every `services/launchd/*.plist` (not hardcoded loopback). Done: a mac cluster node's daemons connect.
- **[P4-8] Join token + node-init.** Verify the HMAC and `expires` in `mesh-install.sh` before `git clone`; have `openclaw-node-init.js` render the manifest templates (with strict signed-deploy) instead of its own second listener. Done: a forged/expired token is refused; only one deploy listener exists.
- **[P4-9] Deploy rollback.** `bin/mesh-deploy-listener.js` — capture the pre-deploy SHA; on failure roll back; the catch-up check must not treat merged-but-failed as done; write a version marker; one runtime tree, one deploy path. Done: a failed deploy self-reverts and re-attempts.
- **[P4-10] Supply-chain pinning.** `bootstrap.sh` — verify the nats-server SHA256, fetch a tag not `refs/heads/main`, drop `sudo npm -g` in favor of a user prefix, pin `npx`/pip versions. Done: a tampered download is rejected.

### Phase 5 — Data integrity / silent failure

- **[P5-1] mention_count.** `lib/pre-compression-flush.mjs:447` — stop keying the dedup index on the monotonic `turnIndex = messageCount-1`; reconcile the two writers (`extraction-store` recompute vs `consolidation` `+1`) to one semantics. Done: a test shows `mention_count` flat across successive flushes of a growing session.
- **[P5-2] Archive resurrection.** `lib/extraction-store.mjs` — consult `entities_archived` on ingest (merge, don't re-create); add a deletion/prune path for `decisions`/`themes`/`entities_archived`. Done: a re-mentioned archived entity does not return at full salience.
- **[P5-3] Consolidation idle gate.** The flush worker posts its `ollama-queue` state to the parent (or runs LLM calls through the parent); export the snapshot on a timer independent of the tick. Done: consolidation does not start while worker extraction is running.
- **[P5-4] Liveness measures work, not shape.** Replace the shared 20-slot window for stall detection with a dedicated liveness signal; make the inject probe fail on empty rather than green. Done: the stall detector fires within one interval of a real stall; the probe is red on an empty store.
- **[P5-5] Field-strip.** Carry unknown task fields through MC as an opaque `extra` map; MC takes the kanban lock or does surgical updates only. Done: `llm_provider`/`collab_result` survive an MC write-back round-trip.
- **[P5-6] Memory-injection escaping.** Escape `[end memory]` and newlines on the local formatter path (the peer path already does); cap field lengths; wrap the transcript with a data boundary in the extractor prompt; never inject unbounded memory into a `bypassPermissions` worker. Sanitize Obsidian note bodies (a live sibling of the same class). Done: a transcript containing `[end memory]` cannot break the injected frame.
- **[P5-7] Federation / knowledge edges.** `web-fetch.mjs` SSRF guard (scheme + RFC1918/link-local block + size cap); `mcp-knowledge` HTTP Origin check + body cap + gate `reindex`; `lib/event-schemas.mjs` fail fast at startup if `dist` is missing rather than a per-message NAK loop. Done: a `file://`/metadata-IP fetch is refused; a missing dist fails startup loudly.
- **[P5-8] Skills.** Make the scanner/`install-hook.sh` fail-closed and validate the slug; default `prompt-guard` telemetry off; quarantine `memorylayer`/`moltbook-registry`; fix `identity/AGENTS.md` referencing mandatory skills that do not exist. Done: a base64/rot13 payload is flagged; no default outbound telemetry.

---

## 3. Attack chains these phases sever

- **Text → persistent RCE:** pasted doc / forged reflection → stored verbatim in MEMORY.md → injected every session → agent writes a `$(…)` filename → scope-revert exec. Cut by P5-6 (escaping) and P1-1 (argv).
- **Local process → operator control:** read the token from world-readable `openclaw.env` (or the cookie via GET) → replay as Bearer → `POST /api/cowork/dispatch` → mesh RCE. Cut by P0-1, P2-6, P1/P2-2.
- **Blind while it burns:** stall detector dark + inject probe green-on-empty + unbounded unauthenticated reject → no ceiling, no alarm. Cut by P5-4, P4-5, P2-2.

---

## 4. Execution order and governance

1. Do **Phase 0** immediately — four small changes, one scope batch, they unbreak CI and remove the local-process shortcut that lowers the bar for everything else.
2. **Phase 1** next — three argv fixes, reachable-today RCE, cheap and high-value.
3. **Phase 2** is the real project (identity); stage 2a before 2b, and P2-5 (nkeys) last within it.
4. **Phase 3** before Phases 4–5 land, so the remaining work goes through gates that actually gate — otherwise the fixes ship on the same honor system the review flagged.
5. **Phases 4 and 5** are parallelizable across contributors once 3 is in.

Each item becomes an `INVENTORY.md` `[ ]` step (suggested numbering 4.6 → 4.x) with a one-item scope and the done-contract above (focused test + runtime evidence). Keep one scope active at a time. Do not mark a step done on tests alone — the review's central lesson is that presence is not function.

---

## 5. Refuted — do not re-investigate

- **`ALTER TABLE` identifier injection** — every `#ensureColumn` caller passes a string literal; no attacker path.
- **Re-run splits the mesh** — token generation is idempotent-guarded (`config.sh:33` `[ -z ]`, `env.sh` sources existing env, `generate_config` skips existing configs). The live issue is the *world-readable* token (P0-1), not regeneration.
- The exec surface *outside* the three named sinks is argv-based, and SQL is parameterized — the twin-divergence theme holds for auth/sanitizers but not for shell exec or SQL, which bounds where to keep looking.
