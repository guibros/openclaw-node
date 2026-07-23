# LOCAL_LANE_DESIGN — lane-stratified evidence for HyperAgent (step 2.0)

**Status:** DESIGN ONLY — approved by operator "ok go" 2026-07-22. Zero production code ships with
this document; every implementation item below opens as its own atomic step with its own batch.
**Supersession:** D3 supersedes hyperagent-evidence D1 **boundary 1 only** (mesh-only production
lane). D1 boundaries 2–4 (human-gated everything, preregistered evidence, reflection
notifications) and federation D13 remain binding verbatim.

## 1. Provenance

A local-integration pivot was proposed 2026-07-22 and REJECTED as written after a four-review
verification chain. The verified P0s that shape this design:

- **Friction ≠ outcome.** Extraction's `friction_signals` measure difficulty/frustration
  (extraction-prompt.mjs:222); `ha_telemetry.outcome` requires `success|partial|failure`
  (hyperagent-store.mjs:88). No defensible mapping exists — friction may never become outcome.
- **The daemon flush hook lacks the claimed data.** `result.extraction` carries counts + capped
  samples only; friction/actions are neither passed through nor persisted anywhere.
- **Mechanical ≠ automatically-invoked-LLM-judgment.** Extraction is an LLM over the last 40
  messages with a regex fallback; a session ending proves nothing about task success.
- **`execution_class` is workload realness** (`real|mock|chaos|synthetic`, throws otherwise,
  hyperagent-store.mjs:224) — lane is an orthogonal dimension and must be a separate field.

What survives from the rejected pivot: the diagnosis. The loop is starved (live 2026-07-22:
1 telemetry / 0 strategies / 0 reflections / 0 proposals), the daemon schedules reflections with
no producer, and a correctly designed local lane is worth having.

## 2. Evidence model — three surfaces, not one table

Contamination must be structurally impossible, not WHERE-clause discipline. Three storage
surfaces, all in state.db, all additive migrations (`#ensureColumn` / `CREATE TABLE IF NOT
EXISTS` per the 0.2 pattern):

| Surface | Grade | Holds | Outcome column | Feeds |
|---|---|---|---|---|
| `ha_telemetry` (existing) | `attested` only | Task outcomes from an explicit completion signal | `success\|partial\|failure` NOT NULL (unchanged) | Success rates, reflection thresholds, cohort claims |
| `ha_lane_metrics` (new) | `operational` | Mechanical transport facts: latency, tokens, cost, retries, error/timeout class, tool failures | NONE — operational rows have no success semantics | Synthesis context; operational regression review; never rates |
| `ha_observations` (new) | `derived` | LLM-extracted session signals: themes, friction (severity), entity/decision counts | NONE | Synthesis context, explicitly flagged `derived`; never rates, never thresholds |

New columns on `ha_telemetry` (additive): `lane TEXT CHECK(lane IN ('mesh','companion'))`,
`unit_kind TEXT CHECK(unit_kind = 'task')`, `evidence_grade TEXT CHECK(evidence_grade =
'attested')`. The CHECKs are the point: the outcome ledger can only ever hold attested task
outcomes. `ha_lane_metrics.unit_kind ∈ ('turn','session')`; `ha_observations.unit_kind ∈
('session','derived')`. Existing rows backfill `lane='mesh'`-if-mesh-attributable else NULL
(NULL = unknown, cohort-ineligible — same semantics 0.2 gave `execution_class`).

**Threshold eligibility matrix (the binding rule):**
- `attested` → counts toward success rates, `createPendingReflections` thresholds, cohort claims.
- `operational` → readable by synthesis as context; MAY motivate an operational observation in a
  proposal's notes; contributes to NO rate, NO threshold, NO cohort claim.
- `derived` → readable by synthesis as context, always rendered with a `derived` label;
  contributes to NOTHING countable.

Reflection windows become lane-scoped: grouping key `(node_id, soul_id, lane)` so companion
patterns never dilute mesh patterns or vice versa.

## 3. Identity and attribution contracts

- **node_id:** existing convention (NODE_ID).
- **soul_id:** gains a writer. `~/.openclaw/config/souls.json` maps frontend/source → soul_id;
  the bridge carries its configured soul explicitly on every producer call. Absent config, the
  NODE_ID fallback stays legal but every fallback row is mechanically marked (meta) as
  identity-degraded. No LLM ever infers a soul.
- **Task boundary (companion):** EXPLICIT ONLY. A companion task exists between a structured
  `task-open` and `task-close` signal — CLI (`hyperagent task open|close --outcome …`) or a
  structured bridge command. `task-close` carries the outcome and is the ONLY companion source of
  an attested row. Session end is not a close. Friction is not a close. An unclosed task expires
  to NO ROW (absence of evidence, never an inferred outcome).
- **domain:** declared at task-open from the frozen taxonomy. Never inferred post-hoc.
- **Strategy attribution:** consultation happens at task-open; the selected `strategy_id` is
  stored on the open task record and stamped into the injected block. The close writes that
  stored id — never re-resolved at close time, so mid-task approvals cannot corrupt attribution.

## 4. Consultation and injection contract (companion lane)

- **Transport:** a read-only GET on the daemon's loopback inject-server (:7893), e.g.
  `GET /hyperagent/strategy?domain=&soul=` returning the active approved strategy (or none).
  The bridge NEVER opens state.db directly (no cross-repo SQLite coupling).
- **Injection point:** the bridge's existing per-prompt seam — beside `injectRules` /
  `injectMemory` (adapter.ts ~:2094/:2101, canonical repo) — but injected ONCE per task/session,
  idempotent, with the `[strategy #id]` marker for observability.
- **Behavior boundary (D13):** injection of an approved strategy is the only apply surface.
  Nothing writes harness rules, workflows, or source from HyperAgent.

## 5. Bridge lifecycle ownership (decided)

- **Canonical repo:** `~/Documents/openclaw infrastructure/companion-bridge`
  (`OPENCLAW_BRIDGE_DIR` override honored). The commitless Downloads stray is archived
  (renamed `companion-bridge.stray-20260722`) — it already caused one wrong audit finding.
- **Mechanism:** a launchd unit `ai.openclaw.companion-bridge` (install.sh-rendered, KeepAlive),
  consistent with every other node service; `openclaw-stack` keeps working unchanged (it skips
  when :8787 is open). Health = HTTP probe on :8787 wired into node-watch's fabric family.
- **Ordering:** the unit + health probe land BEFORE any companion lane activates. A telemetry
  lane on an unsupervised process is not a production lane.

## 6. Cohort revision (amends 2.1/2.2/2.3 contracts)

- The 2.1 manifest gains a `lanes` section. The mesh cohort remains the primary preregistered
  cohort. Companion-attested rows form a SEPARATE stratum with its own operator-set floor.
- No pooling, ever: every aggregate in 2.3's report is stratified by lane.
- Only `evidence_grade='attested'` companion rows are cohort-eligible. `operational` and
  `derived` surfaces may appear in the report appendix as context, clearly labelled, outside all
  claims.

## 7. Implementation queue (each a future atomic step; NONE executed in 2.0)

| id | Step | Touches |
|---|---|---|
| I1 | Schema + store guards (three surfaces, CHECKs, lane backfill, lane-scoped reflections) | lib/hyperagent-store.mjs + tests |
| I2 | Daemon: read-only strategy GET + observations writer (incl. friction pass-through in the flush return) | lib/memory-inject-server.mjs, lib/pre-compression-flush.mjs, workspace-bin/memory-daemon.mjs + tests |
| I3 | Bridge: task open/close signals, once-per-task injection, per-turn operational metrics | companion-bridge repo (own discipline) |
| I4 | Bridge lifecycle: launchd unit, install.sh render, node-watch health probe | services/, install.sh, lib/node-watch.mjs |
| I5 | Cohort manifest schema: lanes section + validation | bin/hyperagent.mjs + tests |

Prerequisites recorded: the D11 mesh runtime must be up for 2.2 regardless of this design
(mesh-agent currently loaded-not-running); the bridge is DOWN today (:8787 closed, probed
2026-07-22) and stays out of production until I4.

## 8. What this design explicitly does NOT change

- D13: human approval for every strategy change; structured-strategy-only apply; observational
  language, never A/B. Reaffirmed.
- D1 boundaries 2–4: human-gated everything; preregistered, no-mid-cohort-tuning evidence;
  reflection notifications.
- Block 3 deferrals and their un-defer triggers.
- The 2.1 and 2.3 `visual:` hard gates.
