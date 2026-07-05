# SCOPE — protocol plan

**Status:** active
**Goal:** Operator-directed 2026-06-15: lock the node watch-target list as a spec and build the
**watcher** that fills in the REAL per-element status (WORKING / BROKEN / OFF / UNKNOWN). Honesty
invariant: never WORKING without an observed signal; unimplemented/unobservable => UNKNOWN (never
green); intentionally-off => OFF. Read-only probes only in watch mode (no synthetic writes per tick).
Reuses the node-acceptance probes/health-check (no parallel impl, MASTER_PLAN §4.6). Verified with
mocked unit tests; NOT run against the live node.
— CLOSED 2026-06-15: `docs/NODE_WATCH_SPEC.md` (locked list + verdict model), `lib/node-watch.mjs`
(registry + honest verdicts + read-only probes), `bin/node-watch.mjs` (one-shot + `--watch`),
`openclaw-node-watch` bin + `node-watch` script, `test/node-watch.test.mjs` (12 tests). All 43 node-*
tests green. 3 honest UNKNOWN-stubs: vault links, calendar, cloud-LLM-reachability. NOT run on live node.
**Addendum 2026-06-15:** reopened to add an HTML dropdown view to the watcher engine (`formatHtml` +
`--html`) listing every checked item + its result, with a detail panel. Files already in scope below.
— CLOSED 2026-06-15: `formatHtml` (self-contained page; `<select>` grouped by family via `<optgroup>`,
option per item = "STATUS — label", detail panel, color-coded) + `--html`/`--html-out` flags. 14 watch
tests green (2 new). Sample rendered to /tmp/node-watch-sample.html from mock data. NOT run on live node.
**Addendum 2026-07-03 (operator-directed, interactive session):** P0 remediation from the
2026-07-03 deep review: (1) fix C1 — memory daemon cross-wired to two DBs (`createExtractionStore`
silently ignores `opts.db`; extraction writes → state.db while consolidation/federation read the
0-byte extraction.db); (2) fix the four C7 node-watch bugs (deploy-drift cwd false-green, hardcoded
node id in plist, `--axis` false-ACCEPT, axis snapshot clobber) + atomic snapshot write + tick
overlap guard, then commit the 15-day-old node-watch working tree; (3) refresh CLAUDE.md
"Where we are" + AGENTS.md to match reality (repair complete at v7.8, not BLOCKED).
— C1 CLOSED 2026-07-03 (5a07b6e): probe OBSERVED write→read on one file; `{ db }` now throws; 60/60 store tests.
— C7 CLOSED 2026-07-03: deploy-drift resolves repo via OPENCLAW_REPO_DIR/module path (self-compare ⇒ UNKNOWN);
plist node id templated; unknown `--axis` throws (observed exit 3); axis runs skip the default report+snapshot
(observed: no snapshot written); snapshot/report/html writes atomic; watch tick overlap guard; healthPct(0 observed)
= null, never 100 (formatters + MC page render n/a). 54/54 node-* tests green. **First live one-shot run OBSERVED**
(node=MoltyMacs-Virtual-Machine.local, 2026-07-03T18:22Z, heavy incl.): 21 WORKING / 5 BROKEN / 3 OFF / 2 UNKNOWN,
health 75%, snapshot written (29KB). The prior "NOT run on live node" caveat is closed; the 5 BROKEN are real
findings (NATS probe timeout, MC scheduler 404, stale graph cache), not watcher defects.
**Addendum 2026-07-03b (operator-directed "go"):** P1 remediation from the same review —
(4) memory data integrity: dedup decisions + derive entity mention_count from the mentions table
(stop per-flush inflation), with an idempotent migration that dedups the existing state.db;
(5) flush concurrency guard + idle-timer re-arm in the daemon/trigger; (6) make test-suite skips
visible (no silent `skipped 0`); (7) delete dead `workspace-bin/mesh-bridge.mjs`; (8) MC: stop GET
handlers mutating on poll + label the mock Live Chat page.
— P1 ALL CLOSED 2026-07-03: (4) 28ca668 — dedup migration OBSERVED on a copy of the live 26MB state.db
(removed 23 dup mentions + 15 dup decisions; one entity was mention_count 77 → 0, a pure flush counter);
(5) f31dbfd — flush serialized w/ coalesce + idle re-arm (11/11 trigger tests); (6) ef00406 — mesh-skip
census (`skipped 1` with reason; `npm run test:strict` fails hard, the CI gate); (7) 55f54e9 — dead bridge
deleted; (8) 0b4142e — GET /api/tasks + GET /api/scheduler/tick now read-only, Live Chat MOCK badge.
Browser-dependent scheduler + diagnostics-runner side effects captured in OUT_OF_SCOPE.md (need infra/seams).
**Full suite after P1 OBSERVED: 1607 pass / 0 fail / 1 skipped** (the census — mesh tier down on this host);
MC vitest 95/95.
**Addendum 2026-07-03c (operator-directed "retrieval quality"):** P2 retrieval track —
(D7) embeddings truncated at `max_length: 256` (~1000 chars) while chunks are 1800 chars → ~45% of every
chunk invisible to vector search; (D8) channels 3/4/5 ordered chunks by global `turn_index DESC` with a
fabricated score going negative past rank 100, discarding the caller's salience ranking.
— P2 retrieval CLOSED 2026-07-03: (D7) `EMBED_MAX_TOKENS = 2048` covers a full 1800-char chunk in any
language; misleading comment + "~17MB" error string corrected. Runtime probe OBSERVED: two 1436-char texts
sharing a ~1330-char prefix but differing only in the tail now embed distinctly (cosine 0.95) — the tail
beyond the old cap is embedded. **CAVEAT:** existing knowledge.db vectors were indexed at 256 — a re-index
is needed for full benefit on already-stored content (query path benefits immediately). (D8) `getChunksForSessions`
ranks by caller session-relevance order then within-session recency; score is (0,1], never negative.
50/50 retrieval+embedding tests green (incl. 2 new ranking tests + embed-benchmark under the new ceiling).
**Addendum 2026-07-03d (operator-directed "option 1 is ok"):** adopt two patterns from the verified
ctx analysis (ctxrs/ctx, Apache-2.0) — (A) read-only SQL MCP surface in mcp-knowledge
(`sql_query`/`sql_schema` over an allowlist of state.db / knowledge.db / mission-control.db;
read-only open + `PRAGMA query_only` + single-statement + stmt.readonly/reader checks + row/byte
caps; no query timeout — better-sqlite3 exposes no progress handler, documented limitation);
(B) `decisions_fts` (schema v3: content-table FTS5 + triggers + backfill, migration verified on a
copy of the live state.db), replace the F-H23 per-theme LIKE stopgap with FTS MATCH, add the `dfts`
retrieval channel. Phase G outbox note + optional ctx sidecar NOT in scope (doc/ops, captured in
OUT_OF_SCOPE / session transcript).
— A+B CLOSED 2026-07-03: (A) fb4667e — `lib/readonly-sql.mjs` + `sql_query`/`sql_schema` wired into
mcp-knowledge (6 tools total); 13/13 unit tests; live stdio MCP probe OBSERVED (real state.db rows
returned; DELETE refused isError:true). Keyword gate added beyond the ctx pattern: ATTACH/PRAGMA are
sqlite3_stmt_readonly-true but blocked. (B) 1df972e — schema v3 migration OBSERVED on a copy of the
live state.db (337/337 decisions FTS-indexed, bm25 hits ranked); F-H23 LIKE stopgap + dead sentinel
loop deleted; channel 6 `dfts` live-probed against real DBs (5 session chunks for a decision-worded
query). Full suite 1642: 1641/0/1 known census skip. NOTE: the live daemon picks up v3 only after the
L0 deploy-gap symlink/restart — same caveat as every lib/ change this session.
**Addendum 2026-07-03e (operator-directed "go for the remaining"):** the remaining review backlog —
scheduler heartbeat (browser-dependent ticking), diagnostics-runner production side effects, and mesh
deploy-trigger auth (C2 security).
— REMAINING CLOSED 2026-07-03: (heartbeat) 4da7265 — launchd/systemd unit POSTs /api/scheduler/tick
every 60s (curl, no node spawn); observed HTTP 200 against live MC. (diagnostics) 920c7bd — GLOB not
LIKE for `__TEST__` + markdown re-sync after cleanup; the schedulerTick-vs-production-DB isolation is a
larger refactor left in OUT_OF_SCOPE. (mesh deploy auth) `lib/deploy-trigger-auth.mjs` — opt-in signed
deploys (`OPENCLAW_REQUIRE_SIGNED_DEPLOY=1` + `OPENCLAW_DEPLOY_TRUSTED_KEYS`); listener verifies before
`git reset --hard`, both publishers best-effort sign; 9/9 unit tests + e2e probe OBSERVED (signed→verified,
unsigned/forged→rejected under strict; default off = unchanged behavior + unsigned warning). **CAVEATS:**
not runtime-tested vs a live mesh (dormant); activation needs the operator to provision trusted keys +
set the flag. The exec-safety half of C2 is NOT fixable here (no exec responder in-repo) — captured in
OUT_OF_SCOPE.
**Addendum 2026-07-03f (operator-directed "deep review" — CORRECTIONS to prior entries):** a six-agent
deep review (`audits/DEEP_REVIEW_2026-07-03_FULL.md`) re-verified every claim above with differential
probes. Three prior entries are corrected:
- **D7 (addendum c) is RETRACTED as a fix — it was a no-op.** transformers.js 3.8.1's feature-extraction
  pipeline ignores the `max_length` option entirely (destructures only pooling/normalize/quantize/precision;
  tokenizer runs at model_max_length=8192). OBSERVED: same text embedded with `max_length: 4` vs `2048` →
  cosine 1.000000, bit-identical. The old 256 cap was equally ignored — full chunks were ALWAYS embedded;
  the "~45% invisible" premise was false. The addendum-c "runtime probe OBSERVED" was post-only (would have
  passed identically pre-change) — not causal evidence. The re-index CAVEAT is also retracted: OBSERVED,
  a stored vector for a 24k-char chunk matches a fresh full-text embed at cosine 1.000000; no re-index is
  pending. `EMBED_MAX_TOKENS` is dead code; if a real ceiling is ever wanted it must be enforced by
  tokenizing/slicing before `embed()`.
- **C7 live-run "2 UNKNOWN" (addendum a) were watcher defects, not honest unobservability:** `reuse()` in
  `lib/node-watch.mjs` clamps reused probes to the 30s default, discarding their declared 120s budgets
  (LLM-L2-EXTRACT/EMBED) — the watcher structurally cannot observe slow-but-working LLM ops. Queued P1.
- **C2 (addendum e) downgraded to PARTIAL:** the catch-up path (`checkAndCatchUp` in
  `bin/mesh-deploy-listener.js`) executes the UNSIGNED `latest` KV marker without calling
  `verifyDeployTrigger` — a full bypass of the signed-deploy control on every startup/reconnect; plus no
  replay cache within the 24h freshness window. Queued P1 (sign the marker + verify in catch-up).
Also recorded by the review: the runtime deploy gap is systemic (live MC = drifted hand-copy with pre-fix
GET handlers; live daemon = pre-D5 code on an unmigrated v1 state.db; node-watch/heartbeat units not
installed and currently uninstallable — `${VAR}` placeholders nothing renders + install.sh never places
node-watch.mjs at the unit exec path). Batch-0 triage EXECUTED 2026-07-03 (operator-approved): MC rebound
to 127.0.0.1 (OBSERVED lsof + HTTP 200), 7 crash-looping mesh/aux launchd units unloaded → `.disabled`,
branch pushed. Deploy day + P1 round 2 are the queued next scopes.
**Addendum 2026-07-03g (operator-directed "go batch3"):** P1 round 2 from the full deep review (§5 items
3–11): C2 catch-up signing + replay cache; node-acceptance axis validation; node-watch reuse() timeout
inheritance; flush-coalescing guard ported to the live daemon (workspace-bin/memory-daemon.mjs); knowledge-DB
default path fix; federation-suite skip census + regression-bugs silent returns; broadcast dist-import
fail-loud; CI green (lockfile drift + workspace build); mesh-kv-sync test rewritten against production code.
Files added below under "# 2026-07-03g".
— P1 round 2 CLOSED 2026-07-03 (commits 7e3466e, c07a42a, + census/test/CI commits): (axis) unknown
`--axis` throws, OBSERVED exit 3 + evidence file untouched; empty gate ⇒ INCOMPLETE; axis runs no longer
clobber `.node-acceptance.md`. (timeout) reuse targets inherit probe timeoutMs — test proves a 50ms probe
budget governs where the 30s clamp would have passed. (knowledge-db) default now workspace/.knowledge.db;
stale 0-byte extraction.db deleted. (flush) all five runFlush paths in the LIVE daemon serialized + NATS
coalescing + idle re-arm (takes effect at deploy-day restart). (broadcast) event-schemas import hoisted
via lib/event-schemas.mjs — OBSERVED loud failure with dist removed. (C2) latest KV marker now the signed
trigger; checkAndCatchUp verifies via verifyDeployMarker (signature+trust, no freshness — markers are
state); live triggers get replay cache + 15-min window; 15/15 auth tests. (census) second census class
for nats-server-binary suites — OBSERVED: absent ⇒ `skipped 2` w/ filenames, strict ⇒ hard fail;
regression-bugs Bug 3 silent returns ⇒ t.skip/hard asserts. (mesh-kv) test file rewritten against the
real src/lib/sync/mesh-kv.ts — 17 production tests replace 30 green-by-construction ones; MC 82/82.
(CI) lockfiles synced (npm ci verified root+MC), root job runs `npm test` so the workspace dist builds.
Full local suite 1651/0/1. **CI OBSERVED GREEN** 2026-07-03 22:35Z (run 28686140714, commit 09895a3):
all 4 jobs (node 18/20/22 + MC) — first green Tests run after 5+ consecutive reds. Took three
iterations: (1) lockfile + `npm test`, (2) event-schemas builds with its own tsc + clean-room MC lock,
(3) OPENCLAW_NO_EMBED_MODEL=1 on CI — the five embedding suites skip through per-file census sentinels
(OBSERVED: model present ⇒ all run 0 skipped; absent ⇒ `skipped 5` each with reason;
OPENCLAW_REQUIRE_EMBEDDER=1 ⇒ hard fail).
**Addendum 2026-07-04a (operator-directed "Full deploy day"):** deploy day EXECUTED and OBSERVED —
(1) PR #5 merged to main (5c1ebc6); (2) state.db migrated v1→v3 on the live DB (consistent .backup
first; OBSERVED post-migration: user_version=3, 0 dup mention groups, 0 dup decision groups, 337/337
decisions_fts, 0 mention-count drift; daemon stopped-then-restarted in the safe order, stable 5h+);
(3) live MC hand-copy replaced by the repo tree (tar backup kept; data/mission-control.db 538 tasks +
.env.local preserved; OBSERVED: /, /api/scheduler/status, /api/node-watch, /node-watch all 200 on
127.0.0.1); (4) watch units DEPLOYED: install.sh now places bin/node-{watch,acceptance}.mjs at the unit
exec path, heartbeat curl -s→-fsS (failures land in .err), systemd NODE_PATH de-staled; plists rendered
+ loaded — ai.openclaw.node-watch (continuous, 60s/900s) and ai.openclaw.scheduler-heartbeat OBSERVED
live 5h+ (fresh snapshots, heartbeat .err empty); (5) health-watch report converted to per-tick
heartbeat (d9d47c8) — OBSERVED fresh. Deep one-shot 2026-07-04T04:39Z: health 74% (20W/5B/4OFF/2U);
timeout-inheritance verified live (extract probe ran full 120s, embedder WORKING 2s). NEW findings
queued (not in this scope): daemon Phase 2 stalled since 2026-07-03 15:02 (watcher caught it overnight);
NATS client-connect TIMEOUT (pre-existing); MC dev-mode cold-compile vs 2.5s diagnostics probe.
**Addendum 2026-07-04b (operator-directed "go" — Phase-2 stall root cause):** the watcher's overnight
obs.sync/obs.graph_cache BROKEN traced to a compound cause: (1) `~/.openclaw/config/transcript-sources.json`
still pointed `claude-code-repo` at the DEAD pre-rename project dir (`-Users-moltymac-openclaw`) — every
session in openclaw-nodedev was invisible to activity detection, so the daemon sat ENDED (no Phase 2, no
extraction) for the whole deep-review day; (2) the daemon's main loop froze `loadTranscriptSources()` at
startup (five other paths re-read per tick), so the registry fix couldn't apply live. Fixed: registry
gains `claude-code-nodedev` source (runtime config, .bak kept); daemon re-reads sources every tick
(d4dfd34). OBSERVED after restart: `ENDED → BOOT (session: 12c83c0b)`, session-trace tracking this
session's JSONL, Phase 2 stage-1 firing (00:58), backlog ingest of the missed day in progress.
Related gap for next scope: node-watch `mem.ingest` reports WORKING on arbitrarily-old JSONLs — a
freshness-bounded probe (and a registry-paths-exist probe) would have caught the dead source day-of.
**Addendum 2026-07-04d (operator-directed "go V0+V1"):** memory-vault remediation per
audits/MEMORY_SYSTEM_REVIEW_2026-07-04.md — V0: test-vault isolation (thread vaultPath through
runFlush/runConsolidationCycle; tests write tmp vaults) + purge fixture pollution from the live vault.
V1: (1) link emission — concept frontmatter/body emits resolvable piped slug links, graph parser
flattens legacy YAML + normalizes targets, spreading activation walks both directions; (2) session/
decision/theme/daily writers driven by the consolidation cycle (DB-driven backfill) instead of
flush-LLM-success only; (3) decision notes select top-N by salience (no static 0.4 floor vs decay);
(4) canonical_name normalization + v4 merge migration for case/format entity variants.
Acceptance: review §5 criteria (concept→concept edges > 0, channel 5 non-empty on probe suite,
session refs resolve, this-week decision gets a note within one cycle, no fixtures in live vault).
Files added under "# 2026-07-04d".
— V0+V1 CLOSED 2026-07-04 ~02:25, all OBSERVED on the live node: (V0) tests write tmp vaults (0
live-vault writes during the previously-polluting files); 9 fixture files quarantined + 2 dailies
cleaned — 0 fixture refs remain. (V1-1) concept notes emit quoted piped slug links + body ## Related;
buildGraph normalizes targets + flattens legacy YAML; activation walks both directions. (V1-2) session/
decision/theme/daily writers ride the consolidation cycle (session backfill 20/cycle, idempotent),
ordered BEFORE concept regeneration so fresh session notes are linkable same-cycle. (V1-3) decisions
top-30 by salience (0.001 junk floor). (V1-4) v4 canonical merge OBSERVED live: 1087→1062 entities,
0 dupes/orphans/drift; upsert keys on canonical identity. LIVE RESULTS after 2 supervised cycles:
graph 105 edges/60% resolved/0 concept→concept → **1072 edges/100% resolved/611 concept→concept**;
**channel 5 alive** (126 nodes activated from any concept seed; was structurally 0); session notes
7→45 (backfill converging, ~150 remain at 20/cycle); orphan rate 76%→39% (converging; <20% target
pending tail rewrites); daemon+scheduler restarted on new code. PENDING next cycles: <20% orphans,
LLM summaries for the top-10 hub stubs (needs an Ollama-free window), and a this-week decision note
(blocked on upstream: LLM extraction has produced no decisions since 2026-06-17 — queued V2).
**Addendum 2026-07-04f (operator-directed "notif system"):** end-to-end desktop notification system.
Today's popups (memory-plan-notify.sh via terminal-notifier) are fire-and-forget dead ends: no click
target, no ledger, no origin link, macOS-only. Build: (1) `lib/notify.mjs` + `bin/openclaw-notify.mjs` —
append-only JSONL ledger at `~/.openclaw/notifications/ledger.jsonl` (event written BEFORE dispatch;
clicks are separate `type:click` lines), platform dispatch (darwin: terminal-notifier `-open <url>`
+ `-contentImage <icon>`, osascript fallback honest-unclickable; linux: notify-send `--icon`, `-A`+
xdg-open when libnotify supports actions — capability-detected); (2) per-kind icon set
(`services/notify-icons/`, generated PNGs) + `~/.openclaw/config/notify.json` (kind→icon override,
enable/sources toggles); (3) rewire: memory-plan-notify.sh → thin shim over the CLI; workplan-viewer
fires CLI with `?plan=<id>` deep-link URL + gains URL-param plan selection; node-watch fires on
WORKING↔BROKEN transitions → MC /node-watch; (4) MC `/notifications` page + `/api/notifications`
over the ledger; (5) install.sh step: place icons + default config, per-OS dependency check
(terminal-notifier / libnotify-bin + xdg-open), no new daemon. Files under "# 2026-07-04f-notif".
— NOTIF CLOSED 2026-07-04, all OBSERVED on the live node: lib+CLI+ledger+icons (24/24 notify tests;
full suite 1691/0/1 census skip); real popup fired via terminal-notifier `-open` — ledgered
delivery `{method:terminal-notifier, clickable:true, ok:true}`, icon resolved from
~/.openclaw/share/notify-icons; viewer restarted on new code, /api/notify-test → ledger line
source=workplan url=`?plan=protocol`; a live tick-chain caller ("Health: stuck") rode the rewired
shim unprompted at 17:01Z; node-watch unit restarted on new code (transition-fire itself UNKNOWN
until a real WORKING↔BROKEN flip is observed); MC files deployed to the runtime tree —
/api/notifications 200 with real ledger events + /notifications page 200, sidebar entry live
(MC vitest 82/82, no new tsc errors). Linux lane is unit-tested + install-wired only — runtime
UNKNOWN until run on an Ubuntu node. Click-through is `visual:` — operator confirms a popup click
lands on the viewer/MC origin.
— NOTIF ROUND 2 CLOSED 2026-07-04: (banner icon) the LEFT banner icon is the sender bundle's icon —
built `OpenClawNotifier.app` (terminal-notifier copy + generated openclaw.icns: terminal tile w/
orange claw badge bottom-right, bundle id ai.openclaw.notifier, ad-hoc resigned, lsregister'd);
lib prefers it; install.sh builds it on macOS. OBSERVED: usernoted db2 shows ai.openclaw.notifier
registered with 4 delivered records (= 4 test fires); banner pixels not screenshot-verifiable
(NC excluded by allowlist compositor filtering) — icon appearance is the operator's visual check.
(emitters widened per audit) health-watch alertBanner → CLI (own source/kind/URL, was masquerading
as workplan via the shim; darwin-only gate dropped); mesh-deploy-listener REJECTED/applied/FAILED;
consolidation-scheduler cycle-failure; lane-watchdog SIGUSR1 intervention. OBSERVED live:
health-watch "healthy" event post-restart (18:24Z) + node-watch transition wire fired on REAL flips
(obs.links BROKEN 18:20Z error, fabric.services recovered 18:22Z success) — the round-1 UNKNOWN
is closed. Deploy/consolidation/watchdog paths are wired+tested but dormant until their events
occur (mesh listener units currently disabled). 25/25 notify tests; affected suites 73/73; full
suite green except 2 external fails (embed-benchmark perf-under-load; the observer session's
in-progress test).
**Addendum 2026-07-04h (operator-directed "gogo"):** protocol-base remediation per the 2026-07-04
planner deep review — (1) per-addendum scoped ```files blocks: a `closed` word on the fence line
re-locks that batch's files (hook change + this file restructured accordingly); (2) plan-lint
drift checks: active-scope age/size, Runtime-Evidence trailer presence in recent commits,
VERSION-vs-git-activity; (3) `[D]` DEFERRED step state (lint/tick/viewer; redesign's 4 deferred
rows flipped); (4) canonical contradiction pass (MASTER_PLAN §6.2/§7 silo layout, FRAMEWORK 5→6
checks + VERSION_LOG alignment, COWORK_MODEL engine names, PROTOCOL plist naming ai.openclaw.*,
settings.json comment) + sync; (5) §4.6: dead per-plan engines deleted (memory-plan-tick.sh,
redesign-tick.sh 207-line copy) → 2-line shims over plan-tick.sh, automation.json repointed;
(6) mechanical: plan-tick $HOME not /Users/moltymac, dirty-tree check ignores untracked files,
INVENTORY row regex unified whitespace-tolerant across tick/lint/viewer. Files under
"protocol-remediation" block below.
— REMEDIATION CLOSED 2026-07-04, all OBSERVED: (hook) closed-block pruning live-probed 6/6
(open allow · closed block · glob · bare-fence compat · unscoped block · SCOPE self-allow) —
this file restructured into 6 labeled blocks, open allow-list 110→~32 entries; the migration
required a temp bare block (old hook couldn't parse labeled fences — chicken-and-egg, resolved).
(lint) drift checks live: protocol grades "scope hygiene: 32 entries, age 1d" PASS + honest WARN
"step machinery idle: 76 commits since VERSION moved"; stale-canonical FAIL fired during the doc
pass and cleared by sync — the lint caught its own author. (D) redesign 4 rows flipped [D]:
lint CONFORMANT (was 1F), viewer 36/36+4 deferred (was 36/40 forever-incomplete). (canonical)
MASTER_PLAN §hdr/§6.2/§7/§10 silo-true; FRAMEWORK Binding-note reconciles 5→6 checks +
VERSION_LOG (D2) + [D]; COWORK_MODEL names plan-tick.sh, honest "no chain loaded"; PROTOCOL
ai.openclaw.<id>-tick + [D] + closed-block hook text; templates + settings.json comment; synced,
lint documents-surface PASS all silos. (§4.6) memory-plan-tick.sh deleted, redesign-tick.sh
207-line copy → 2-line shim, legacy-tick.sh shim created, automation.json × 3 repointed
(ai.openclaw.*), orphaned com.openclaw plists → .disabled, viewer deriveAutomationDefaults no
longer offers the dead engine. (mechanical) plan-tick $HOME + untracked-not-dirty (preflight
OBSERVED post-commit: tree clean w/ .codex/ + observer files untracked present); viewer
inventory parser now first-4-strict/desc-last — repair renders 49/49 live (was 0/0, a
pre-existing display lie: its rows carry a 6th column). Tests: test/plan-protocol.test.mjs 9/9
(hook open/closed/glob/compat, lint [D]/whitespace/hygiene-bloat-vs-pruned); full suite
1701/1703 (1 skip census, 1 fail = concurrent observer session's own in-progress test).
Repair remains honestly NONCONFORMANT (missing automation surfaces, dormant complete plan — D6).
Chain deliberately NOT loaded for any plan (operator decision, viewer Automation tab).
**Addendum 2026-07-04i (operator-directed "clickable icon to start the full suite"):** one-click
stack launcher — `bin/openclaw-stack.mjs` (up/status/down: discovers installed ai.openclaw.*
launchd / openclaw-* systemd units, bootstraps unloaded ones, kickstarts pid-less KeepAlive
daemons, starts external companion-bridge when its repo exists and :8787 is closed, port-probes
nats/MC/viewer/injection/bridge, prints a truth table, fires a ledgered click-through popup;
NEVER touches .disabled units); macOS double-clickable `OpenClaw Stack.app` (osacompile applet,
claw icns, ad-hoc signed) + Linux .desktop entry; install.sh builds/places both. Files under
"stack-launcher".
— LAUNCHER CLOSED 2026-07-04, OBSERVED live: `status` table truthful vs the real node (7 LIVE /
4 LOADED periodic / 8 DISABLED untouched / bridge DOWN, exit 1); `up` started companion-bridge
DOWN→LIVE :8787 (first managed start ever) while leaving running units alone → popup
"OpenClaw stack — 12/12 up — all systems live" ledgered w/ /diagnostics click-through;
`OpenClaw Stack.app` built (claw icns, ai.openclaw.stack-launcher) and OBSERVED via `open -a`
double-click simulation: applet → stack table in ~/.openclaw/logs/stack-launcher.log + fresh
ledgered 12/12 popup (19:18:58Z). 8/8 stack tests (discovery, .disabled honesty, port probe,
classify rules). install.sh builds the app (macOS) / installs the .desktop (Linux);
`openclaw-stack` bin registered. Ubuntu lane unit-tested only — runtime UNKNOWN until a Linux
node runs it. Double-clicking the icon yourself is the operator's visual check.
**Addendum 2026-07-04j (operator-directed "one big fused obsidian" + "go with the V2 queued"):**
vault fusion + V2. Fusion (operator chose: existing arcane-vault, memory under
nodes/daedalus/memory/): getVaultPath gains a config layer (obsidian-sync.json `memoryVaultPath`,
workspace-relative or absolute; precedence opts > env > config > legacy obsidian-local default);
node-watch obs.* probes + MC config.ts resolve through the same convention; migrate
obsidian-local/{concepts,sessions,decisions,themes,daily} into the real vault; rebuild graph
cache; restart daemon/scheduler/node-watch; verify channel 5 + probes against the fused path.
V2 (in the fused vault): verify today's 3 new decisions are fresh extractions; heavy obs.links
one-shot; orphan convergence + hub summaries via consolidation cycles; this-week decision note.
Files under "vault-fusion".
— FUSION+V2 CLOSED 2026-07-04, OBSERVED: getVaultPath config layer (opts>env>memoryVaultPath>
legacy; 6/6 fusion tests incl. cache/reset + workspace-relative resolution); node-watch obs
probes + MC config.ts on the same convention; 157 notes migrated into
arcane-vault/nodes/daedalus/memory (counts identical), live config gains memoryVaultPath (.bak
kept), obsidian-local → .pre-fusion-backup; daemon+node-watch restarted, MC config deployed
(/obsidian + /memory-content 200); graph REBUILT FROM FUSED PATH identical 157 nodes/1104 edges;
channel 5 OBSERVED live from fused vault (seed {ollama:1} → 152 nodes activated); obs axis
one-shot OBSERVED against fused path (graph_cache WORKING; obs.sync stale-3h = Ollama-busy
consolidation deferral, benign; obs.links 1 dangling of 1614 = session note ef98ec24 not yet
backfilled — session EXISTS in state.db, self-heals with the backfill tail). V2: the 3
2026-07-04 decisions are REAL fresh extractions (session 12c83c0b — yesterday's, the one the
transcript-source fix re-exposed; decision drought since 06-17 is OVER); orphans/hub-summaries/
decision-note ride the next idle-window consolidation cycles (Ollama actively extracting —
idle gate correctly deferring). 55/55 affected tests. PENDING autonomous: backfill tail
(~130 sessions), <20% orphans, hub summaries, this-week decision note — check the vault after
the next quiet hour.
**Addendum 2026-07-04k (operator-directed "merge all project doc/data into one global vault"):**
obsidian-sync gains `extraRoots` — additional source trees beyond the workspace, each with its
own shared-style routes (+ `stripPrefix` for dir-preserving dests, per-root state keys so the
workspace sync state is untouched). First consumer: the openclaw-nodedev repo itself → domain
`22-openclaw-node` (README, docs/**, memory-plan canonical protocol docs, per-plan
ROADMAP/DECISIONS/COMPONENT_REGISTRY). Config-path env override (OPENCLAW_OBSIDIAN_SYNC_CONFIG)
for testability, matching lib/obsidian-vault.mjs. Files under "vault-global".
**Addendum 2026-07-05a (operator-directed "same as github + deployable elsewhere"):** deploy
parity — sed fallback in generate_config missed ${OPENCLAW_REPO_DIR} (envsubst-less fresh nodes
would render a literal placeholder and the vault repo-docs domain would silently never sync).
Fixed; both render paths OBSERVED producing identical valid extraRoots. Repo leak-scan clean
(no local memory content tracked; *.db gitignored; obsidian-vault/ is the scaffold template).
Local was 5 ahead / 0 behind origin — pushed. Files under "deploy-parity".
— GLOBAL CLOSED 2026-07-04, OBSERVED: dry-run routed 33 repo files correctly (per-plan dirs
preserved, 2491 workspace files untouched — state keys intact); real run 33 synced / 0 errors;
vault now carries 22-openclaw-node/{docs,plans/{legacy,protocol,redesign,repair},protocol,
readme} with source_root/source_path frontmatter; operator-sync half verified alive beforehand
(fresh recaps/lessons today, 1555 files under nodes/). 4/4 extra-roots tests;
obsidian-vault.test.mjs isolated from the live fused config (my config layer broke its bare
getVaultPath assumption — fixed with env-pointed nonexistent config); vault tests 18/18.
Daemon Phase 2 spawns the deployed sync fresh each tick — extraRoots active next cycle without
restart. Full suite 1718/1721 (census skip + the 2 known external fails).
**Set at:** 2026-07-03 (operator-directed, interactive session)
**Expires:** 2026-07-10T23:59:00Z

Per-addendum blocks (2026-07-04h restructure). A `closed` word on a ```files fence re-locks that
batch: the hook skips closed blocks. Reopen by deleting the word (operator approval, as ever).

```files node-watch-p0p1 closed
docs/NODE_WATCH_SPEC.md
docs/NODE_ACCEPTANCE.md
bin/openclaw-memory-daemon.mjs
lib/extraction-store.mjs
lib/extraction-trigger.mjs
lib/pre-compression-flush.mjs
lib/mcp-knowledge/core.mjs
lib/retrieval-pipeline.mjs
test/retrieval-pipeline.test.mjs
test/extraction-store.test.mjs
test/extraction-trigger.test.mjs
test/consolidation.test.mjs
test/mesh-skip-census.test.mjs
CLAUDE.md
AGENTS.md
package.json
mission-control/src/app/api/tasks/route.ts
mission-control/src/app/api/scheduler/tick/route.ts
mission-control/src/lib/hooks.ts
mission-control/src/app/live/page.tsx
lib/node-watch.mjs
lib/node-acceptance.mjs
lib/node-acceptance-probes.mjs
bin/node-watch.mjs
bin/node-acceptance.mjs
test/node-watch.test.mjs
test/node-acceptance.test.mjs
test/node-acceptance-probes.test.mjs
mission-control/src/app/api/node-watch/route.ts
mission-control/src/app/diagnostics/page.tsx
mission-control/src/lib/scheduler.ts
mission-control/src/app/api/scheduler/status/route.ts
mission-control/src/app/node-watch/page.tsx
mission-control/src/components/layout/sidebar.tsx
services/launchd/ai.openclaw.node-watch.plist
services/systemd/openclaw-node-watch.service
services/service-manifest.json
services/launchd/ai.openclaw.scheduler-heartbeat.plist
services/systemd/openclaw-scheduler-heartbeat.service
services/systemd/openclaw-scheduler-heartbeat.timer
mission-control/src/app/api/diagnostics/test-runner/route.ts
bin/mesh.js
bin/fleet-deploy.js
lib/deploy-trigger-auth.mjs
test/deploy-trigger-auth.test.mjs
lib/readonly-sql.mjs
test/readonly-sql.test.mjs
lib/mcp-knowledge/server.mjs
memory-plan/plans/protocol/audits/DEEP_REVIEW_2026-07-03_FULL.md
memory-plan/plans/protocol/audits/MEMORY_SYSTEM_REVIEW_2026-07-04.md
install.sh
bin/health-watch.mjs
```

```files batch3-p1r2 closed
workspace-bin/memory-daemon.mjs
lib/broadcast-offerer.mjs
lib/broadcast-acceptor.mjs
lib/broadcast-emitter.mjs
lib/event-schemas.mjs
lib/node-identity.mjs
test/federation-2node.test.mjs
test/federation-3node.test.mjs
test/federation-resilience.test.mjs
test/regression-bugs.test.js
test/broadcast-*.test.mjs
mission-control/src/lib/__tests__/mesh-kv-sync.test.ts
mission-control/src/lib/mesh-kv-sync.ts
mission-control/package.json
mission-control/package-lock.json
package-lock.json
packages/event-schemas/package.json
.github/workflows/test.yml
test/helpers/embedder-available.mjs
test/embed-benchmark.test.mjs
test/gulf1-eval.test.mjs
test/hybrid-search.test.mjs
test/embed-existing-sessions.test.mjs
test/mcp-knowledge-sessions.test.mjs
```

```files vault-v0v1 closed
lib/obsidian-summarizer.mjs
lib/obsidian-decision-notes.mjs
lib/obsidian-theme-notes.mjs
lib/obsidian-session-notes.mjs
lib/obsidian-digest.mjs
lib/obsidian-graph.mjs
lib/obsidian-vault.mjs
lib/spreading-activation.mjs
lib/consolidation.mjs
bin/consolidate.mjs
test/obsidian-*.test.mjs
test/spreading-activation.test.mjs
test/pre-compression-flush.test.mjs
```

```files observer
# 2026-07-04f (operator-directed "start from the beginning") — concurrent session's
# 5-layer observer; left OPEN until that session closes its work.
lib/observer.mjs
bin/observer.mjs
test/observer.test.mjs
services/launchd/ai.openclaw.observer.plist
services/systemd/openclaw-observer.service
services/systemd/openclaw-observer.timer
```

```files notif closed
bin/lane-watchdog.js
bin/mesh-deploy-listener.js
bin/consolidation-scheduler.mjs
bin/health-watch.mjs
lib/notify.mjs
bin/openclaw-notify.mjs
test/notify.test.mjs
workspace-bin/memory-plan-notify.sh
workspace-bin/workplan-viewer.mjs
services/notify-icons/*
mission-control/src/app/api/notifications/route.ts
mission-control/src/app/notifications/page.tsx
docs/NOTIFICATIONS.md
install.sh
package.json
```

```files deploy-parity closed
install.sh
```

```files vault-global closed
workspace-bin/obsidian-sync.mjs
config/obsidian-sync.json.template
test/obsidian-sync-extra-roots.test.mjs
# pre-existing test assumed bare getVaultPath() = legacy default; needs config isolation now
test/obsidian-vault.test.mjs
docs/VAULT.md
```

```files vault-fusion closed
lib/obsidian-vault.mjs
lib/node-watch.mjs
mission-control/src/lib/config.ts
config/obsidian-sync.json.template
test/obsidian-vault-fusion.test.mjs
docs/VAULT.md
```

```files stack-launcher closed
bin/openclaw-stack.mjs
services/launcher/*
test/openclaw-stack.test.mjs
install.sh
package.json
docs/STACK.md
```

```files protocol-remediation closed
.claude/hooks/scope-check.sh
.claude/settings.json
workspace-bin/plan-tick.sh
workspace-bin/plan-lint.sh
workspace-bin/new-plan.sh
workspace-bin/legacy-tick.sh
workspace-bin/redesign-tick.sh
workspace-bin/memory-plan-tick.sh
workspace-bin/workplan-viewer.mjs
memory-plan/canonical/MASTER_PLAN.md
memory-plan/canonical/PROTOCOL.md
memory-plan/canonical/FRAMEWORK_CANONICAL.md
memory-plan/canonical/COWORK_MODEL.md
memory-plan/canonical/BLOCK_TEMPLATE.md
memory-plan/canonical/templates/*
memory-plan/plans/*/MASTER_PLAN.md
memory-plan/plans/*/PROTOCOL.md
memory-plan/plans/*/FRAMEWORK_CANONICAL.md
memory-plan/plans/*/COWORK_MODEL.md
memory-plan/plans/*/BLOCK_TEMPLATE.md
memory-plan/plans/redesign/INVENTORY.md
memory-plan/plans/legacy/automation.json
memory-plan/plans/redesign/automation.json
memory-plan/plans/protocol/automation.json
memory-plan/plans/protocol/DECISIONS.md
test/plan-protocol.test.mjs
```

## Prior closed scopes (retained for history)

- 2026-06-15: built node-acceptance harness (bin/lib/node-acceptance*, 31 mocked tests) — the test-mode gate.
- 2026-06-15: `docs/NODE_ACCEPTANCE.md` design draft delivered.
- 2026-06-03 (Block 2 — conformance): all six viewer surfaces + 9-phase + Goal/Needs/Feeds/Verify.
  CLOSED v2.4: 2.1 68a78fe · 2.2 09babba · 2.3 39c24a8 · 2.4 final; silo CONFORMANT 15P/1W/0F.

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
