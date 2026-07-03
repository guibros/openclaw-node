# Deep Review — openclaw-nodedev, full project + branch audit

**Date:** 2026-07-03, ~17:30 (Montreal)
**Branch under review:** `feat/node-test-watch-system` (21 commits over main, +4,371/−308; 1 commit unpushed at review time)
**Other branches:** `claude/sad-gauss`, `claude/sad-knuth`, and the three remote `claude/*` branches carry **zero commits** beyond main — all live work is on the one feature branch.
**Method:** six parallel review agents (node test+watch, memory pipeline, retrieval/knowledge, mesh/security, Mission Control, test-suite/ops-infra) with file:line verification of every claimed fix, plus direct runtime probing of the live machine (launchctl, live DBs, live snapshots, full test-suite run). Everything marked OBSERVED was executed during this review, not inferred.

---

## 1. Executive verdict

**The code work of 2026-07-03 is largely real, competent, and test-backed — but the project has partially reproduced the exact failure mode it was built to kill.** The May 2026 post-mortem ("done = committed, code-on-disk and runtime drifted 4+ days") is happening again in a subtler form:

- The suite is green (**OBSERVED this review: 1641 pass / 0 fail / 1 skipped**, matching the ledger's shape) and most fixes verify at the code level.
- But **the runtime is running pre-fix code almost everywhere it matters**: the live Mission Control is a drifted, partially hand-synced copy still carrying the mutating GET handlers; the live memory daemon booted at 13:46 with pre-D5 code against an un-migrated v1 `state.db`; the "continuous" node-watch monitor and the scheduler heartbeat exist as units on disk that are **not installed and cannot be installed** (unrenderable `${VAR}` templates, wrong exec paths in install.sh).
- Two of today's ledger claims are factually wrong: the **D7 embedding fix is a no-op** (the fixed parameter is silently ignored by the library; the original bug never existed; the "runtime probe OBSERVED" in SCOPE.md was a post-only measurement presented as causal), and the **C2 signed-deploy control has a full bypass** on its catch-up path.
- One **P0 security exposure is live right now**: the deployed Mission Control binds `*:3000` with zero auth and serves `~/.openclaw` secrets (including `discord.token`) and desktop screenshots to anyone on the LAN.

Scorecard of the day's claimed fixes: **10 VERIFIED · 7 PARTIAL · 3 NOT-DONE** (detail in §3).

---

## 2. The four cross-cutting failures

### F-A. The deploy gap is back (systemic, P0-class)

Every subsystem review independently converged on this:

| Component | Repo state | Runtime state (OBSERVED) |
|---|---|---|
| Mission Control | read-only GETs, `/node-watch` page, `/api/scheduler/status`, MOCK badge | live instance at `~/.openclaw/workspace/projects/mission-control` is a **partial hand-copy**: MOCK badge present, route fixes **absent**, no `/node-watch`, no `/api/scheduler/status` — and it is not a git checkout, so no mechanical sync exists |
| Memory daemon | D3/D4 flush serialization in `bin/openclaw-memory-daemon.mjs` | that daemon **runs nowhere**; the live daemon is `workspace-bin/memory-daemon.mjs` (via symlink), which has **none** of the serialization, and loaded pre-D5 lib code at 13:46 (fixes committed 14:43+) |
| state.db | v3 schema (dedup indexes, decisions_fts) | live DB still `user_version=1`; **962 of 1,087 entities** carry inflated mention_counts; 18 duplicate mention groups; migration only ever ran "on a copy" |
| node-watch | continuous monitor + launchd/systemd units, `autostart: true` in manifest | **not installed, not loaded, no process**; only evidence is one manual one-shot (`meta.mode: "once"`, snapshot 3h stale) |
| Scheduler heartbeat | plist + systemd timer, "tasks fire without a browser tab" | **not installed**; tasks still fire only while a browser tab polls |
| Branch itself | oldest commit 2026-06-16 | 21 commits unmerged to main for ~2.5 weeks; 1 unpushed |

The watcher's own live BROKEN finding (`ops.calendar` 404) is a **correct detection of this drift** — and the ironic proof: the fix exists in the repo and isn't deployed either.

**Deploy hazard requiring care, not just speed:** the moment any new-code process opens the live `state.db` it migrates to v2/v3 and creates unique indexes — the still-running old daemon's plain `INSERT INTO mentions` then throws SQLITE_CONSTRAINT inside `storeExtractionResult`, which is caught and silently downgrades extraction to the regex path until restart. **Restart the daemon first, then migrate, in one supervised step.**

### F-B. Live security exposure (P0)

- **P0 — Mission Control: unauthenticated, LAN-open, secret-serving.** The deployed MC listens on `*:3000` (OBSERVED via lsof), has no auth middleware anywhere, and exposes: `GET /api/memory-file?path=discord.token` (the path jail is `~/.openclaw` — which *contains* the secrets), `POST /api/screenshot` (desktop capture + retrieval), `POST /api/system/restart` (DoS), `POST /api/tasks` (task dispatch + gateway notifications), `POST /api/scheduler/tick`. **Today-fix:** bind loopback (`-H 127.0.0.1` in the launchd plist); token middleware if LAN access is ever wanted.
- **P1 — C2 signed-deploy has a complete bypass.** The ed25519 sign/verify core is correct and fail-closed, but `checkAndCatchUp` (`bin/mesh-deploy-listener.js:216-232`) reads the **unsigned** `latest` KV marker (written unsigned at `bin/fleet-deploy.js:218`, `bin/mesh.js:702`) and calls `executeDeploy` **without ever calling `verifyDeployTrigger`** — on every startup and NATS reconnect. Even with `OPENCLAW_REQUIRE_SIGNED_DEPLOY=1`, anyone who can write that KV key gets fleet `git reset --hard` to an arbitrary SHA. Additionally: no replay cache (a captured signed trigger replays for the 24h freshness window), and the opt-in default-off means the posture is unchanged on every node until keys are provisioned — with nothing tracking that follow-up.
- **P1 — mesh task daemon: unauthenticated NATS → autonomous agent.** ~30 handlers (`mesh.tasks.submit`, `mesh.collab.*`, …) accept unsigned messages; `mesh-agent.js` then drives an LLM CLI against a worktree and can run an (allowlist-regex-guarded) metric command via `bash -c`. NATS auth is one optional shared token (`lib/nats-resolve.js:92` returns null-auth when unset). Pre-existing and known-deferred — but it bounds any mesh revival.
- Positive: no committed secrets, no SQL injection (prepared statements throughout), no eval, `lib/memory-inject-server.mjs` and the new `lib/readonly-sql.mjs` are genuinely well-hardened (see §4).

### F-C. Ledger honesty failures (process, P1 by this project's own rules)

The operator's core rule is "no unverified status claims." Two ledger entries violate it:

1. **D7 is a no-op and its evidence is post-only.** `embed()` passes `max_length: EMBED_MAX_TOKENS` to transformers.js 3.8.1, whose pipeline destructures only `{pooling, normalize, quantize, precision}` and hardcodes `truncation: true` at the tokenizer's `model_max_length` = **8192**. OBSERVED: embedding the same 1400-char text with `max_length: 4` vs `2048` → cosine **1.000000** (bit-identical). The old 256 cap was equally ignored — the "~45% of every chunk invisible to vector search" premise was **false**; full chunks were always embedded. The SCOPE.md "Runtime probe OBSERVED: the tail beyond the old cap is embedded" would have passed identically *before* the change. The re-index CAVEAT is also wrong: OBSERVED against live `.knowledge.db`, stored vector for a 24k-char chunk vs fresh full-text embed → cosine 1.000000. **Ledger entries for D7 (SCOPE.md addendum 2026-07-03c, commit 1804c2e) should be corrected: no re-index is pending, and the "fix" changed zero runtime behavior.**
2. **"First observed live run"'s 2 UNKNOWN are watcher defects, not honest unknowns.** `lib/node-watch.mjs:386` clamps every reused probe to 30s, discarding the probes' own declared 120s budgets (`LLM-L2-EXTRACT`/`EMBED`). OBSERVED in the live snapshot: `llm.extraction_task UNKNOWN "probe error: timeout 30000ms"`. The watcher structurally cannot observe slow-but-working LLM operations on this hardware.

Related: CLAUDE.md presents the "continuous monitor + launchd/systemd units" as delivered; by the project's own standard the watch system's runtime status is **UNKNOWN, not live**.

### F-D. Parallel implementations persist (the May failure mode, P2)

- **health-watch vs node-watch:** two monitors, both 60s loops, both with launchd units; node-watch's 31 targets fully superset health-watch's 6 components — and `ops.diagnostics` *probes health-watch's output* instead of replacing it. health-watch is the one actually running; node-watch is the one claimed. No DECISIONS.md entry states the relationship or retirement plan. MASTER_PLAN forbids exactly this.
- **Two memory daemons:** `bin/openclaw-memory-daemon.mjs` (280 lines, systemd-referenced, never runs) vs `workspace-bin/memory-daemon.mjs` (1,657 lines, the live one). Fixes keep landing in the wrong one (D3/D4).
- Byte-identical `bin/lane-watchdog.js` ≡ `workspace-bin/lane-watchdog.js`; **divergent** `bin/session-search.mjs` ≠ `workspace-bin/session-search.mjs` (different backends).

---

## 3. Verification of the day's claimed fixes

| # | Claim (ledger/commit) | Verdict | Evidence |
|---|---|---|---|
| C1 | One extraction DB; `{db}` throws | **VERIFIED** (code) | `lib/extraction-store.mjs:36-44`; all writers/readers align on state.db. Sibling bug open: `bin/openclaw-memory-daemon.mjs:98` defaults knowledge DB to nonexistent `~/.openclaw/knowledge.db` (real: `workspace/.knowledge.db`) — a C1-class split waiting to happen (P1) |
| C7a | deploy-drift via OPENCLAw_REPO_DIR; self-compare ⇒ UNKNOWN | **VERIFIED** | `lib/node-watch.mjs:287-291`; no test covers it; drift scope is lib-only so MC drift is invisible to it |
| C7b | plist node id templated | **PARTIAL** | placeholder exists but **nothing renders `${VAR}` in plists** — launchd doesn't expand them, mesh-deploy copies units verbatim, and install.sh's rsync never places `node-watch.mjs` at the unit's exec path. The unit cannot start from any install path |
| C7c | unknown `--axis` ⇒ exit 3 | **VERIFIED for node-watch; NOT-DONE for node-acceptance** | OBSERVED: `runAcceptance({axis:'TYPO'})` ⇒ **ACCEPTED, exit 0, 0 results** (`lib/node-acceptance.mjs:143,197,145-148`). The deploy gate still false-ACCEPTs |
| C7d | axis runs skip default snapshot | **VERIFIED (node-watch)** | `bin/node-watch.mjs:53,60`; `bin/node-acceptance.mjs:53` still always clobbers `.node-acceptance.md` on axis runs |
| C7e | atomic writes + overlap guard | **VERIFIED** | correct; untested; acceptance report still plain `writeFile`; tmp leak on failure |
| C7f | healthPct(0 observed)=null | **VERIFIED** | `lib/node-watch.mjs:412-417`; MC page duplicates the formula client-side (drift risk); no unit test |
| D3/D4 | flush serialization + idle re-arm | **VERIFIED in the wrong daemon** | correct in `bin/openclaw-memory-daemon.mjs:207-240` (never runs); live `workspace-bin/memory-daemon.mjs:1431-1466` fires NATS-triggered `runFlush` un-awaited, outside the guard — concurrent flushes remain live (P1) |
| D5 | dedup + derived mention_count + idempotent migration | **VERIFIED in code / NOT DEPLOYED / PARTIAL in design** | migration correct & idempotent; live DB un-migrated (F-A); **themes still per-flush inflate** (`extraction-store.mjs:288`); growing-session tails still add one mention per flush (turnIndex-keyed); `reinforceCoOccurrence` (+1) vs `recomputeMentionCount` are mutually clobbering |
| D7 | EMBED_MAX_TOKENS 2048 | **NOT-DONE (silent no-op)** | see F-C1. Parameter is dropped by the pipeline; bug never existed; ledger evidence post-only |
| D8 | session-relevance chunk ranking | **VERIFIED, premise holds for 2 of 4 callers** | `retrieval-pipeline.mjs:143-181` correct; channels 3+6 pass genuinely ranked sessions; **channels 4+5 pass unordered `SELECT DISTINCT` sets** — activation ranking is computed then discarded (`:425-430`), so the new score launders arbitrary row order as relevance |
| dfts | decisions_fts v3 + channel | **VERIFIED** | textbook external-content FTS5 migration: triggers cover insert/delete/conflict-update, version-gated rebuild, injection-safe query builder, tested. One hole: channel 4 privacy (below) |
| ctx-A | read-only SQL surface | **VERIFIED** | genuinely defense-in-depth (readonly fd + `query_only` + single-statement + keyword allowlist + `stmt.readonly` + row/byte caps). OBSERVED bypass probes all blocked: `load_extension`, `EXPLAIN DELETE`, multi-statement, CTE-write. DB access allowlist-keyed, no caller paths |
| C2 | signed deploy trigger | **PARTIAL** | core correct (ed25519, canonicalized full payload, fail-closed allowlist); **catch-up path bypasses it entirely** (F-B); no replay cache; default-off protects nobody until keys provisioned |
| P1-6 | mesh-skip census; strict fails hard | **PARTIAL** | OBSERVED both modes work. But census greps for `meshSkipReason` only — the three **federation suites skip via their own `SKIP` const** (`{skip:'nats-server not found'}`) and vanish with `skipped 0` on hosts without nats-server; `regression-bugs.test.js:416-441` still contains in-test silent returns; **nothing anywhere runs `test:strict`** |
| P1-8 | MC read-only GETs + MOCK badge | **PARTIAL (repo) / NOT LIVE** | GET tick is read-only, `__LIVE_SESSION__` synthesized; but GET /api/tasks still writes via markdown-sync-on-read + a one-time cleanup delete ("no longer writes *per poll*" is the accurate claim); deployed instance runs the old code |
| heartbeat | scheduler fires without browser | **VERIFIED (repo) / NOT LIVE** | units correct, manifest-wired, installable by install.sh — but not installed; also `curl -s` without `-f` means a 404ing tick (which is what the live MC serves) would heartbeat "successfully" forever |
| P1-7 | dead mesh-bridge deleted | **PARTIAL** | workspace-bin copy deleted; local plist `.disabled`; **repo manifest still `autostart: true`** for `ai.openclaw.mesh-bridge.plist` — a reinstall resurrects the bridge |

---

## 4. What is genuinely good

Credit where due — several of today's deliverables are the strongest work in the repo:

- **`lib/readonly-sql.mjs` + mcp-knowledge server**: six independent enforcement layers, correct on every bypass probe thrown at it, resource-capped, allowlist-keyed. This is how the security-first principle should look everywhere.
- **decisions_fts migration** (`extraction-store.mjs:237-259`): external-content FTS5 with complete trigger coverage including the conflict-update path, version-gated rebuild, correct ordering vs the v2 dedup. Textbook.
- **Identity primitives** (`lib/node-identity.mjs`, `openclaw-trust-peer.mjs`): proper strict/TOFU nodeId→pubkey registry, atomic 0600 persistence, rotation audit trail. The gap is adoption (deploy path uses a flat env allowlist; task daemon uses nothing), not the primitive.
- **The honesty verdict machinery in node-watch**: default-UNKNOWN mapping, probe-error ⇒ UNKNOWN not BROKEN, null health. The philosophy is right; the defects are at the edges (timeout clamp, weak-signal freshness).
- **LLM extraction robustness**: brace-matching JSON recovery, tolerant enum coercion with drop-not-fail, Zod after coercion, regex fallback. (Wants one retry before falling back, and it prompts for `relationships`/`friction_signals`/`actions` that are then **discarded unstored** — paid tokens for dropped output.)
- **Suite integrity overall**: 1,642 tests, no `.skip`/`.only`, real assertions in the big files. The census mechanism itself is sound — it just needs wider coverage.

---

## 5. Consolidated findings by severity

### P0 — act today
1. **MC unauthenticated on `*:3000` serving secrets + screenshots** → bind loopback in the launchd plist now; auth middleware later. (§F-B)
2. **Deploy the branch** — merge to main, push, and close the runtime gap deliberately: restart memory daemon **then** migrate state.db (v3) in one supervised step; replace the hand-copied MC with a real checkout/build; install-or-explicitly-defer the node-watch + heartbeat units. Until then, every "fixed" label on MC/memory/watch is code-only. (§F-A)

### P1
3. **C2 catch-up bypass**: sign the `latest` KV marker; verify in `checkAndCatchUp` before `executeDeploy`; add replay cache + shrink the 24h window; track the default-flip. (`bin/mesh-deploy-listener.js:216-232`)
4. **node-acceptance `--axis` false-ACCEPT**: the deploy gate exits 0 on a typo'd axis / empty result set. Mirror node-watch's validation. (`lib/node-acceptance.mjs:143-148,197`)
5. **Watch-mode timeout clamp**: `reuse()` must inherit probe `timeoutMs` (120s LLM budgets currently clamped to 30s ⇒ the live 2 UNKNOWN). (`lib/node-watch.mjs:54-58,386`)
6. **Live daemon concurrent flushes**: port the coalescing guard to `workspace-bin/memory-daemon.mjs` — the daemon that actually runs. (`:1431-1466`)
7. **Knowledge-DB default** in `bin/openclaw-memory-daemon.mjs:98` points at a nonexistent path — the next C1.
8. **Federation-suite invisible skip**: route `{skip:'nats-server…'}` suites through the census (or a second census keyed on `{ skip:`); wire `test:strict` into some gate — today **nothing runs it**, and **CI is red on all recent runs** (lockfile drift `next@16.2.1` vs `16.1.6`; broadcast libs mis-reporting a missing gitignored `dist/` import as `bad_schema` and silently dropping every broadcast — also a production failure mode: `lib/broadcast-offerer.mjs:339-346` et al.).
9. **MC `mesh-kv-sync.test.ts` is green-by-construction**: ~30 tests importing zero production code, testing a mock Map and a `mergeTasks` defined inside the test file. Rewrite against production or delete.
10. **Service units unrenderable/uninstallable**: `${OPENCLAW_NODE_ID}`/`${NODE_BIN}` placeholders nothing fills; install.sh never places `node-watch.mjs` at the unit exec path; `NODE_PATH=~/openclaw/...` (retired tree) in the systemd unit and the **live memory-daemon plist**. Decide: real installer rendering, or stop claiming the units.
11. **Correct the D7 ledger entries** (SCOPE.md 2026-07-03c, commit 1804c2e): no-op change, false premise, post-only probe, no re-index pending. Per the no-unverified-claims rule this correction is itself P1.

### P2 (selected — full lists in the per-agent reports)
- **Channel-4 privacy leak**: `themeEntitySearch` joins decisions with no `private` filter — a public theme matching a private decision leaks that session's chunks (`retrieval-pipeline.mjs:263-269`). One-line fix + mirror the channel-6 test.
- **Channels 4/5 feed unordered session sets to D8** (activation ranking computed then discarded); channels 3+4 double-count the entity signal in RRF.
- **Cron double-fire** in MC scheduler: a task completing within 20min of trigger re-fires for the same occurrence; the "matches heartbeat interval" comment is stale (60s now). (`scheduler.ts:198-296`)
- **`consolidate.mjs --dry-run` is parsed and never read** — a "dry run" mutates the live DB. Honesty bug in operator tooling. (`bin/consolidate.mjs:200,209`)
- **Watch tick violates its own read-only invariant**: `workspace_writable` writes+unlinks a file every 60s; `NET-L2-PUBSUB` publishes per light tick; `mem.ingest`/`runtime.gateway` report WORKING on arbitrarily old artifacts (unbounded-freshness false green).
- **formatHtml's embedded JSON is dead in a browser** (htmlEsc'd quotes inside a `<script>` ⇒ `JSON.parse` throws; the test asserts the bug's substring). No detail panel has ever worked.
- **MC node-watch page has no staleness alarm** — currently rendering "75%" off a 3-hour-old snapshot with 10px microcopy.
- **Production MC runs `next dev`** under KeepAlive; `next build` cannot pass (25 tsc errors). The dev-mode service is a symptom.
- **Concurrency-guard force-clear race** (`lib/concurrency-guard.mjs:56-61`): orphaned run's `finally` releases the replacement's lock — needs identity check. Consumers: memory-daemon, consolidation-scheduler, graph-cache.
- **Seven mesh/aux launchd units crash-looping** (exit 1 + KeepAlive) on the live machine — neither OFF nor WORKING; unload/.disable until mesh revival. Manifest also still autostarts mesh-bridge on reinstall.
- **scope-check.sh glob traversal**: `case` globs let `*` match `/`, so `lib/*` also matches `lib/../.claude/settings.json`; plus MCP file-write tools are ungated (undocumented hole beyond the documented Bash one).
- **plan-tick.sh reads the wrong PIPESTATUS index** — `CLAUDE_RC` is `cat`'s exit code; a crashing claude CLI logs rc=0.
- **Shared `user_version` counter** on state.db across three modules (extraction-store owns 1–3; a future session-store migration gated `<2` silently never runs).
- **Fresh-install chicken-and-egg**: daemon only opens state.db if it already exists — clean nodes never get extraction at all. Similarly, `deploy-drift` probes lib/ only, so MC drift (the thing that actually happened) is structurally invisible to it.
- **Heartbeat curl lacks `-f`**: HTTP 404/500 heartbeats report success forever.
- Workplan-viewer `PUT .../automation/config` builds launchd plists from user strings (loopback-only, but a local persistence vector).

### P3 (themes)
Unbounded growth tables (cooccurrence_state, entities_archived); `integrity_check` on every DB open (use `quick_check`); repeated full-table entity/theme scans per retrieve (memoize per call); FTS write-amplification on salience bumps (add a `WHEN` clause); MAX_CHUNK_CHARS violated by the mid-loop chunker flush (24k-char chunk live); case-sensitive entity uniqueness ("OpenClaw"/"openclaw" split — known); seconds-only staleness formatting; sequential 29-probe ticks (~15min worst case — parallelize per family); dead bin/ scripts (`discord-read.js`, `mesh-node-remove.js`, `vault-check.mjs`, `openclaw-status.mjs`, `mesh-join-token.js` unreferenced); `.codex/` untracked in the repo root (a second agent harness whose hooks are **not** governed by the scope-check forcing function); uninstall.sh kills whatever owns :3000; `Expires` compared in UTC vs Montreal convention (scopes die 4–5h early).

---

## 6. Post-migration behavior change to anticipate

D5's recompute will drop mention_counts sharply (the observed 77→0 entity is the extreme). Everything keyed on `log1p(mention_count)` — injection frequency scores, `mentionThreshold: 10` promotion gating — will see its candidate population shrink after the live migration. Not a bug; a calibration event. Re-baseline promotion thresholds after migrating.

---

## 7. Recommended sequence

1. **Now:** MC loopback bind (one line in the plist) + unload the seven crash-looping mesh units.
2. **Deploy day (supervised):** merge branch → main, push; stop live daemon → migrate state.db → restart on new code → verify `user_version=3`, zero dup groups; replace hand-copied MC with a built checkout (fix the 25 tsc errors or set a tracked waiver); install node-watch + heartbeat units only after fixing exec paths/templating — otherwise mark them undelivered in CLAUDE.md.
3. **Next scope (P1 batch):** C2 catch-up signing + replay cache; acceptance-axis validation; reuse() timeout inheritance; live-daemon flush guard; knowledge-DB default; federation-skip census; broadcast dist-import fail-loud; CI green (lockfile + build); D7 ledger correction; mesh-kv-sync test rewrite.
4. **Then:** channel-4 privacy clause + channel-4/5 ordering; cron double-fire; dry-run honesty; watch read-only invariant (probe freshness bounds); formatHtml fix + MC staleness banner; concurrency-guard identity check; decide health-watch vs node-watch and record it in DECISIONS.md.
5. **Before any mesh revival:** task-daemon message signing via the existing identity registry; per-node NATS auth; MC auth middleware. The primitives exist (`node-identity.mjs`); it's adoption work.

---

## 8. Process critique (the meta-review)

The protocol machinery (scopes, ledgers, OBSERVED-discipline, census tests) is genuinely working — most of today's claims were accurate and precisely worded, and the honest ones ("first live **one-shot** run") were careful. Three process gaps let the failures through:

1. **"OBSERVED" needs a differential requirement.** D7's probe was real but post-only. A claim of "fix X changed behavior Y" needs before/after, or a probe that fails on the old code. Suggested rule for PROTOCOL.md: *a fix-verification probe must be shown to fail (or measure differently) against the pre-fix code.*
2. **"Delivered" needs a runtime carrier.** Everything in F-A was "done per commit, undeployed per machine." The done-contract already says runtime verification — what's missing is a *standing* check: node-watch's `fabric.deploy_drift` should compare more than `lib/` (MC tree, workspace-bin, installed units vs manifest), which would have turned this entire review's headline into a red row on the dashboard automatically.
3. **Fixes must land in the code that runs.** Twice today (D3/D4 in the dead daemon; heartbeat units uninstalled) the work targeted the repo artifact rather than the runtime artifact. The two-daemon / two-monitor duplication makes this a recurring trap; retiring the duplicates removes the trap.

**Bottom line:** strong code day, wrong deployment story. The single highest-leverage action is not another fix — it's merging, deploying, and letting the watcher's drift probe cover everything that just drifted.
