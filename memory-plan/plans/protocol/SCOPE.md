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
**Set at:** 2026-07-03 (operator-directed, interactive session)
**Expires:** 2026-07-10T23:59:00Z

```files
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
package.json
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
bin/mesh-deploy-listener.js
bin/mesh.js
bin/fleet-deploy.js
lib/deploy-trigger-auth.mjs
test/deploy-trigger-auth.test.mjs
lib/readonly-sql.mjs
test/readonly-sql.test.mjs
lib/mcp-knowledge/server.mjs
# 2026-07-03f (operator-directed, interactive session): full deep-review report document
memory-plan/plans/protocol/audits/DEEP_REVIEW_2026-07-03_FULL.md
# 2026-07-03g (operator-directed "go batch3"): P1 round 2
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
# CI-green continuation: embedding-model suites need a visible skip on model-less runners
test/helpers/embedder-available.mjs
test/embed-benchmark.test.mjs
test/gulf1-eval.test.mjs
test/hybrid-search.test.mjs
test/embed-existing-sessions.test.mjs
test/mcp-knowledge-sessions.test.mjs
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
