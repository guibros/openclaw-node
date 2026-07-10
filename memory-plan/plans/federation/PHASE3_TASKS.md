# PHASE 3 — Atomic task decomposition (the savant cluster)

Steps 5.1–5.5 broken into atomic tasks. Conventions + tiers as in
[PHASE1_TASKS.md](PHASE1_TASKS.md) / [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md).
Phase 3 depends on the Phase-2 gate (4.6). The savant's defining constraint: it emits
**proposals only** — no write path to code exists; the operator gate is structural. Step 5.5
treats the gate as the primary attack surface.

---

## Block 5 — Savant grappe

### Step 5.1 — telemetry substrate
- **T5.1.1** Decide the collector shape (JetStream mirror vs periodic scrape) using Phase-1/2 hindsight → *DECISIONS* · done-when: choice + rationale logged. [decision]
- **T5.1.2** `lib/savant-feed.mjs`: ingest node-watch JSON snapshots (all nodes) → *NEW lib/savant-feed.mjs* · done-when: snapshots become feed entries `{source,node,ts,kind,ref}`. [code]
- **T5.1.3** Ingest the notification ledger → *lib/savant-feed.mjs* · done-when: ledger lines become feed entries. [code]
- **T5.1.4** Ingest session KV outcomes (worker + mgmt: modes, durations, subrounds, votes, gates, reassignments) → *lib/savant-feed.mjs* · done-when: terminal sessions become feed entries with metrics. [code]
- **T5.1.5** Ingest tick digests / plan-lint summaries → *lib/savant-feed.mjs* · done-when: present in feed. [code]
- **T5.1.6** Query API (source filter, time window, ref resolution); feed is append-only → *lib/savant-feed.mjs* · done-when: query returns filtered, ref-resolvable entries. [code]
- **T5.1.7** Unit: query correctness, ref resolution, append-only invariant → *NEW test/savant-feed.test.mjs* · done-when: pass. [T1]
- **T5.1.8** Live: feed query returns ≥4 source types with federation-wide node coverage, freshness ≤ one interval → *runtime* · done-when: observed. [runtime T3]

### Step 5.2 — change-set sessions
- **T5.2.1** Form the savant grappe `sv-one` (3 nodes, adversarial protocol) → *openclaw-grappe form* · done-when: LIVE in registry. [runtime]
- **T5.2.2** Change-set artifact schema wiring (from 0.2): `{v,id,level,target_plan,rationale,edit:{type,content},expected_evidence,votes,sig}` → *lib/savant-changeset.mjs (validation)* · done-when: NEW validator + schema. [code]
- **T5.2.3** Worker (savant) prompt: draft a change-set from a feed slice; rationale MUST cite feed refs → *bin/mesh-agent.js buildSavantPrompt* · done-when: drafts carry feed-ref citations. [code]
- **T5.2.4** Reviewer prompts: attack on 4 axes (evidence real? edit minimal? level right? expected_evidence falsifiable?) → *mesh-agent* · done-when: reviewer critiques structured by axis. [code]
- **T5.2.5** Finalization guard: schema-invalid or uncited/evidence-free change-sets cannot converge → *lib/savant-changeset.mjs + session finalize* · done-when: such a draft is rejectable, not emittable. [code]
- **T5.2.6** `no-change` verdict path (savant may honestly conclude nothing needs changing) → *savant session* · done-when: a clean input yields no-change, not a forced proposal. [code]
- **T5.2.7** Unit: schema validation (fuzzed: missing evidence, bad level enum, oversized patch); no-change path → *NEW test/savant-changeset.test.mjs* · done-when: pass. [T1]
- **T5.2.8** Live: one savant session over seeded telemetry yields a schema-valid, cited change-set with a concrete edit + expected_evidence; reviewer critiques recorded → *T3-S1* · done-when: observed. [runtime T3]

### Step 5.3 — proposal pipeline (the gate)
- **T5.3.1** Sign the converged change-set → *lib/savant-changeset.mjs + 1.4 signing* · done-when: signed artifact. [code]
- **T5.3.2** Emit a `savant` ledgered notification (click-through to the MC review view) → *openclaw-notify* · done-when: popup with the change-set summary + link. [code]
- **T5.3.3** Append a PROPOSED entry to the TARGET plan's OUT_OF_SCOPE.md (the always-writeable drift file — savant proposals ARE captured drift) → *pipeline writer* · done-when: entry lands with signature + expected_evidence. [runtime]
- **T5.3.4** **Write-jail**: the pipeline process has write access to OUT_OF_SCOPE.md paths ONLY; any other write throws → *NEW lib/savant-pipeline.mjs with a path allowlist* · done-when: coded + a unit test asserts a non-OUT_OF_SCOPE write throws. [code T1]
- **T5.3.5** Self-referential flag: a change-set targeting the gate/pipeline code is allowed to PROPOSE (policy level) but marked `self-referential:true` in the notification → *pipeline* · done-when: the flag surfaces to the operator. [code]
- **T5.3.6** Rate limit: ≤N proposals/day; excess GATED as a batch, ledgered → *pipeline* · done-when: N+1th is batched, not dropped. [code]
- **T5.3.7** Live: a change-set reaches the gate as notification + PROPOSED entry with valid signature; grep/test proves no apply path skips the gate → *T3 + code audit* · done-when: observed + jail verified. [runtime T3]

### Step 5.4 — first real cycle
- **T5.4.1** Accumulate ≥7 days of real telemetry (Phases 1–2 soaks + interim traffic feed the substrate) → *let it run* · done-when: feed spans ≥7 days, ≥4 source types. [PROBE]
- **T5.4.2** Run savant sessions until ≥1 change-set per level (substrate/worker/management/policy) reaches the gate → *live cadence* · done-when: 4 gated change-sets, one per level. [runtime T4]
- **T5.4.3** Record each change-set + the operator's verdict → *audit* · done-when: table {change-set → level → verdict} in AUDIT_POST. [code]
- **T5.4.4** Audit: zero write events outside the gate path over the cycle → *fs-event / git-status audit* · done-when: confirmed clean. [runtime]

### Step 5.5 — PHASE-3 GATE (savant-cluster operational testing + plan-done)
- **T5.5.1** Land `fed.savant.*` probes (feed freshness, session cadence, gate backlog) → *lib/node-watch.mjs* · done-when: `node-watch --axis federation` grades the savant layer. [runtime 6.3]
- **T5.5.2** Land the MC change-set review view (rationale, telemetry refs, diff render, approve/reject writing the verdict back) → *mission-control/src/app/federation* · done-when: page + API 200; approve/reject exercised. [runtime/visual 6.2]
- **T5.5.3** T2 fixture tests: planted-defect fixture → change-set targets it; clean fixture → no-change verdict → *test/savant-integration.test.mjs* · done-when: both pass. [T2]
- **T5.5.4** T3 cells S1–S3 (change-set to gate; reviewer-rejection loop then converge; no-change session) → *live* · done-when: observed. [T3]
- **T5.5.5** Gate-security chaos G1–G5 (write-jail throw; unsigned refused; tampered-sig refused; self-referential flagged; rate-limit batches) → *T5* · done-when: all observed. [T5]
- **T5.5.6** 7-day soak on the real cadence across live Phase-1/2 traffic → *feeder/cadence* · done-when: every emission schema-valid + cited + gated; zero writes outside OUT_OF_SCOPE (fs-audit); no proposal storms. [T6]
- **T5.5.7** **Close the loop (plan-done):** one approved change-set implemented through normal scope/commit discipline, and its `expected_evidence` probe observed TRUE → *the full operator loop* · done-when: the improvement landed and its own probe confirms it. [T7]
- **T5.5.8** T7 acceptance: operator signs the Phase-3 (and plan) checklist; Block 6 fully closed → *visual* · done-when: signed; federation plan reaches its done-contract (ROADMAP). [T7]

---

## Closing note — what the atomic level buys

At this grain every step's Phase-4 is a checklist an autonomous tick (or a human) can execute
without re-deriving intent: the file to touch, the function to write, the observable that proves
it. The `[runtime]`/`[T5]`/`[T7]` tags mark which tasks CANNOT be closed by tests alone — they
gate on live-grappe observation, per MASTER_PLAN §5. Nothing here is committed as done until its
done-when is witnessed.
