# Node Acceptance Protocol

**Status:** BUILT for single-node (2026-06-15) — `bin/node-acceptance.mjs` + `lib/node-acceptance.mjs` +
`lib/node-acceptance-probes.mjs` implement L0–L2 + L4 hard-tests across memory / LLM / network. 31
mocked unit tests green; **not yet run against a live node** (operator will run it on the deployment).
Inter-node L3 is specified but deferred (§8).
**Owner principle:** MASTER_PLAN §4.1 (code on disk ≠ shipped), §4.7 (tests are not done-criteria),
§5 (done requires runtime evidence). This protocol is the operational instance of §5 applied to a
*whole node* rather than a single step.

---

## 0. Running it (the built global system check)

```bash
node bin/node-acceptance.mjs            # full single-node gate, hard-tests every component
npm run node-check                      # same, via package script
openclaw-node-check                     # same, after `npm i -g` / link (bin entry)
node bin/node-acceptance.mjs --axis llm # one axis: memory | llm | network | storage
node bin/node-acceptance.mjs --no-mutate# skip probes that write synthetic data
node bin/node-acceptance.mjs --deep     # include invasive probes (e.g. extract-trigger)
node bin/node-acceptance.mjs --json --report /path/report.md
```

Exit codes: **0** ACCEPTED · **1** REJECTED · **2** INCOMPLETE · **3** harness error. Writes an evidence
report to `~/.openclaw/.node-acceptance.md` by default. **Portable:** every path/URL/port/model resolves
from the same env vars the deployed components read (`OPENCLAW_HOME`, `OPENCLAW_WORKSPACE`,
`OPENCLAW_NODE_ID`, `LLM_BASE_URL`, `LLM_MODEL`, `MEMORY_INJECT_PORT`, `NATS_MONITOR_URL`,
`OPENCLAW_NATS`, …), so the same binary self-tests any node, including `spawn-node` trees via
`OPENCLAW_HOME=~/.openclaw-<id>`.

**Deployment integration:** run as a post-deploy gate (CI / `mesh-deploy-listener`), or schedule
periodically alongside `health-watch`. A non-zero exit means the node is not 100% — see §10.

---

## 1. Why this exists

A node has three independent notions of "working", and the existing tooling only covers two:

| Question | Answered by today | Gap |
|---|---|---|
| Is the code *correct*? | 69 test files / 1414 unit+integration tests (mocked NATS, in-process) | proves logic, not a deployed node |
| Is each part *running*? | `lib/health-check.mjs` `runHealthCheck()` + the `health-watch` daemon (6 liveness probes) | proves a PID exists, not that the function works |
| Does the whole node *function* end-to-end? | **nothing** | **this protocol** |

The failure mode this guards against is the May-2026 one (MASTER_PLAN intro): "the daemon starts and
prints *startup complete* while hiding three disabled subsystems." A green PID and a passing test suite
both reported success while the node produced ~0 working behavior. **Liveness ≠ acceptance.**

`bin/openclaw-status.mjs` is *not* an acceptance gate either: it greps daemon **source** statically and
(per COMPONENT_REGISTRY cross-component issues) introspects the *wrong* daemon, reporting false
`NOT_WIRED`. **This protocol probes the running runtime, never source.**

"100%" is defined precisely here: every **required** check in the node's profile returns `PASS` **with
captured runtime evidence**. Anything unobservable is `SKIP`/`BLOCK`, never `PASS` — fake-passing is the
cardinal failure (same rule the tick-chain runs on, PROTOCOL §7).

---

## 2. Scope of this round

- **In scope:** single-node acceptance — layers **L0, L1, L2, L4** across the **memory**, **LLM-backing**,
  and **network (local)** axes.
- **Deferred (operator decision 2026-06-15):** layer **L3 inter-node / federation**. It is *specified*
  here (§8) so the later round starts from a contract, but it is not built this round and is reported
  `N/A (deferred)` on a single node — never `PASS`, never `FAIL`. Rationale: federation is `ABSENT` in the
  live runtime (COMPONENT_REGISTRY 1.5; NATS is loopback-only single-node per 7.1; redesign D4 deferred it).

### Profiles

| Profile | Layers run | Use |
|---|---|---|
| `single-node` (default) | L0, L1, L2, L4; L3 → `N/A` | Accept one deployed node (today's reality). |
| `federated` (future) | + L3 against a real or `spawn-node` peer | Accept a node's links to other nodes (§8). |

The harness also accepts `--axis memory|llm|network|storage|e2e` to run one axis in isolation.

---

## 3. The gate model

Five layers, ascending in integration. A node is accepted only when **all required checks across all
active-profile layers** are `PASS`.

| Layer | Proves | Evidence class |
|---|---|---|
| **L0 Presence** | every part is *deployed* (no deploy gap, §4.1) | file stat · `readlink` · `diff -rq` · `launchctl list` · perms |
| **L1 Liveness** | every part is *running* | PID · port listen · `launchctl` PID · HTTP `healthz` |
| **L2 Functional** | each part *does its job* in isolation | SQL row-delta · HTTP body · generated text · vector dims |
| **L3 Inter-node** | the link to *other nodes* is real + reliable | observed offer/accept · rejected forgery · reconnect log *(deferred §8)* |
| **L4 End-to-end** | the *whole loop* works | a unique fact ingested becomes retrievable / injected upstream |

### Check verdicts

- `PASS` — observed, threshold met, evidence captured.
- `FAIL` — observed, threshold missed (gate goes red).
- `SKIP` — a precondition for *this* probe is absent in this profile (e.g. companion-bridge off); recorded, not counted against the gate, **must state why**.
- `N/A` — out of profile (e.g. all of L3 on `single-node`).
- `BLOCK` — the probe *should* run but cannot observe (tool missing, headless-only). Treated as `FAIL` for the gate. Never silently downgraded to `PASS`.

### Gate rule

```
accepted  ⇔  (no FAIL) ∧ (no BLOCK) ∧ (every required check is PASS)
```

The harness runs **all** layers (no early abort) so one report shows the full picture, then computes the
gate. Exit code: `0` accepted, `1` rejected.

---

## 4. Axis: Memory function (the deepest)

The pipeline under test: `JSONL session → ingest → state.db → extraction (LLM) → entities/themes/mentions/
decisions → indexing (knowledge.db FTS+vec, graph-cache.db) → retrieval (5 channels) → inject :7893`.
Acceptance is a **round-trip**, not "the database opens".

All synthetic data is tagged with a per-run nonce (`acceptance-<runId>`) in an isolated synthetic session
so probes never pollute real memory, and is deleted in teardown (§7.4).

| ID | Proves | Method | PASS threshold | Evidence captured | Builds on |
|---|---|---|---|---|---|
| MEM-L0-1 | DBs deployed | stat the 3 DB files | `state.db`, `.knowledge.db`, `graph-cache.db` all present + non-empty | paths + sizes + mtimes | COMPONENT_REGISTRY 6.1 |
| MEM-L0-2 | inject token deployed | stat `~/.openclaw/config/memory-injection-token` | exists, mode `0600`, 64 bytes | `ls -l` line | 1.3 |
| MEM-L0-3 | watched sources configured | read `~/.openclaw/config/transcript-sources.json` | ≥1 source dir exists + readable | source list | 1.1 |
| MEM-L1-1 | daemon up | `launchctl list ai.openclaw.memory-daemon` → PID | PID present (reuse `parseLaunchctlPid`) | PID | health-check `checkDaemon` |
| MEM-L1-2 | inject server up | TCP connect `:7893` + `POST /memory/inject` no-token → `401` | listening + auth enforced | status code | 1.3 |
| MEM-L2-1 | **ingest works** | write a synthetic JSONL (nonce) into a watched source; poll `state.db` | `messages` count for the synthetic session grows within `pollInterval + 10s` | SQL before/after counts | session-store, append-delta 3.1 |
| MEM-L2-2 | **extraction works** | trigger flush on the synthetic session (`openclaw-extract-now` / NATS); poll extraction tables | ≥1 row in `entities` with fresh `created_at`; result schema-valid | SQL row + validation result | extraction-store, schema 3.4 |
| MEM-L2-3 | mentions carry grain | check `mentions.turn_index` for the synthetic rows | non-NULL on ≥1 mention | SQL value | 3.3 |
| MEM-L2-4 | FTS+vec indexed | query `knowledge.db` `last_indexed`; confirm synthetic chunks present | `last_indexed` advanced after the session; nonce findable in FTS | SQL + FTS hit | 5.1 |
| MEM-L2-5 | graph fresh | `graph-cache.db` `last_refresh_at` | within 1h (or advanced this run) | SQL value | 5.2 |
| MEM-L2-6 | **all 5 retrieval channels live** | `POST /memory/inject` with token + the known-good query | `concepts≥1 ∧ decisions≥1 ∧ snippets≥1`; each of FTS/vec/entity/theme/spreading returns ≥1 | response body (per-channel counts) | 1.3 v5.3 done-criterion |
| MEM-L2-7 | inject latency | time MEM-L2-6 (analysis-disabled or tolerant of the 1s LLM ceiling) | p95 < 500 ms excluding LLM analysis | measured ms | 1.3 target |
| MEM-L4-1 | **gold round-trip** | inject a unique nonce *fact* via the synthetic session → after extract+index → query inject for the nonce | the nonce string appears in a returned snippet/concept | the matching block, verbatim | full pipeline |
| MEM-L2-8 | watcher observing | tail `~/.openclaw/watcher.jsonl` | a record within the last health interval; no open `watcher.alert` | last record + alert state | 1.8 |

> **MEM-L4-1 is the crown probe.** It is the single check that proves *the memory function actually
> works* on this node: a fact that did not exist before the run is created, extracted, indexed, and
> retrieved by content. If only one memory check could run, it is this one.

---

## 5. Axis: LLM backing

Ollama-served generation + BGE-M3 embedding, model selected by `LLM_MODEL` (default `qwen3:8b`),
serialized through `lib/ollama-queue.mjs`. Acceptance proves the model **runs**, not that the server
answers `/api/tags`.

| ID | Proves | Method | PASS threshold | Evidence | Builds on |
|---|---|---|---|---|---|
| LLM-L1-1 | server up | `GET :11434/api/tags` | HTTP 200 | model list | health-check `checkOllama` |
| LLM-L1-2 | **configured model present** | the model named by `LLM_MODEL` is in `/api/tags` | exact name match (not "some model") | matched tag | MASTER_PLAN 3.2 |
| LLM-L2-1 | **generation runs** | `POST :11434/api/generate` `{model:LLM_MODEL, prompt:"reply OK", stream:false}` | non-empty `response`, `eval_count>0`, within budget (default 30s, env `ACCEPT_GEN_BUDGET_MS`) | response text + eval_count + ms | llm-client |
| LLM-L2-2 | **embedder runs** | embed a string with BGE-M3 via `@huggingface/transformers` | vector length = 1024, all finite, L2-norm > 0 | dim + norm | health-check `checkEmbedder`, embed-benchmark |
| LLM-L2-3 | **production task works** | run the structured-extraction path on a tiny synthetic transcript | output passes `extraction-schema` validation (after `coerceExtractionResult`) | validation result + counts | extraction-prompt/schema 3.4 |
| LLM-L2-4 | queue not stuck | read `ollama-queue` state snapshot | `consecutive_timeouts.{extraction,analysis} < 3`; no fallback in last 5 min | snapshot fields | ollama-queue, health-watch `deriveQueueStatus` |
| LLM-L0-1 | RAM headroom (advisory) | `bin/check-llm-baseline.mjs` | advisory only — `WARN` not `FAIL` if under recommendation | advisor output | MASTER_PLAN 3.2 |

> LLM-L2-3 is the LLM analogue of the gold round-trip: it proves the backing works for the *real* task
> (schema-valid structured extraction), not just freeform text. A model that generates prose but fails
> structured extraction is a failed LLM backing for this node's purpose.

---

## 6. Axis: Network connection (local)

Local NATS (loopback `:4222`, monitor `:8222`, JetStream on), the per-node stream
`local-events-<NODE_ID>`, and the daemon's connection to it. Acceptance proves messages **flow**, not
that a server is listening.

| ID | Proves | Method | PASS threshold | Evidence | Builds on |
|---|---|---|---|---|---|
| NET-L0-1 | NATS service installed | `launchctl list ai.openclaw.nats` → PID | PID present | PID | 7.1 |
| NET-L1-1 | port listening | TCP connect `:4222` | connects | socket ok | 7.1 |
| NET-L1-2 | monitor healthy | `GET :8222/healthz` | HTTP 200 | body | health-check `checkNats` |
| NET-L1-3 | **JetStream enabled** | `GET :8222/jsz` | returns JS stats (api level, limits) | jsz JSON | 7.1 |
| NET-L1-4 | per-node stream exists | stream info for `local-events-<NODE_ID>` | stream present, subjects `local.>` | stream config | 1.7 |
| NET-L2-1 | **core pub/sub round-trip** | subscribe a probe subject, publish a nonce, await delivery | message received within 1s, payload matches | sent/received nonce + ms | nats-resolve |
| NET-L2-2 | **JetStream durability** | publish a nonce to the stream, read it back via consumer | the published message is read back intact | seq + payload | 1.7 done-criterion |
| NET-L2-3 | daemon connected | grep daemon log for `NATS connected` + stream-init line at boot | both lines present, current boot | log lines + ts | 0.4 |
| NET-L2-4 | **extraction trigger round-trip** | publish `mesh.memory.extract_request`; watch for a flush boundary (log/event) | a flush fires within `N` s | trigger→flush log pair | 1.6 done-criterion |
| NET-L1-5 | mesh services loaded | `launchctl list` for the 5 `mesh-*` jobs | all loaded | launchctl rows | 4.1 |

> NET-L2-1/L2-2 distinguish "server up" (L1) from "messaging works" (L2). NET-L2-4 is the
> network×memory cross-probe: it proves the *wire actually drives the pipeline*, which is the only thing
> that ever exercised real-time extraction (1.6 notes the idle timer is otherwise the sole path).

---

## 7. The harness

### 7.1 Contract

```
bin/node-acceptance.mjs [--profile single-node|federated] [--axis <axis>] [--json] [--report <path>] [--quiet]
```

- Default profile `single-node`. `--axis` runs one axis; otherwise all in-profile axes.
- Each check is a pure async fn returning
  `{ id, layer, axis, status, required, threshold, evidence, detail, latency_ms }`.
- Runs all layers (no early abort), then computes the §3 gate.
- Exit `0` accepted · `1` rejected.
- **Reality-first (§4.5):** every value is re-probed live. The harness trusts no doc, including this one
  and COMPONENT_REGISTRY.
- **Composition, not duplication:** reuses `lib/health-check.mjs` for L1 liveness, `ollama-queue`
  snapshot for LLM-L2-4, `node-identity` for L3 (future), `spawn-node` for the `federated` peer.

### 7.2 Output

Human table (default) + `--json` machine object. Always writes a dated report to
`~/.openclaw/.node-acceptance.md` (sibling of `.daemon-health.md`) and `--report` if given. The report
embeds the captured evidence verbatim — it **is** the §5 runtime-evidence artifact for a deploy.

```
Node Acceptance — node=daedalus profile=single-node — 2026-06-15T18:22:04Z
  L0 Presence   ████████  8/8   PASS
  L1 Liveness   ███████░  7/8   FAIL (companion-bridge :8787 down → MEM/E2E-L4-2 SKIP)
  L2 Functional ████████ 14/14  PASS
  L3 Inter-node  —  N/A (deferred this round)
  L4 End-to-end ███████░  1/2   PASS (gold round-trip MEM-L4-1 ✓; bridge e2e SKIP)
GATE: REJECTED — 1 FAIL. Evidence → ~/.openclaw/.node-acceptance.md
```

### 7.3 Determinism + safety

- Synthetic-only writes, tagged `acceptance-<runId>`; no mutation of real sessions/entities.
- Idempotent: a second run produces the same verdicts (modulo real drift).
- Read-mostly: the only writes are the synthetic session JSONL, its derived rows, a probe NATS message,
  and the report file.

### 7.4 Teardown

Always-run cleanup (even on failure): delete the synthetic JSONL, `DELETE` synthetic rows from
`state.db`/`knowledge.db`/`graph-cache.db` by nonce, purge the probe NATS subject. A `--keep` flag
preserves fixtures for debugging. Teardown failures are themselves reported (a node that can't clean up
is a finding).

---

## 8. Inter-node reliability — L3 (DEFERRED this round; contract for the next)

Federation is `ABSENT` in the live runtime, so these are specified, not built, and report `N/A (deferred)`
on `single-node`. They activate under `--profile federated`, validated against a `bin/spawn-node.mjs`
peer on one machine or a real second node. This honors the original "be thorough about other-node
reliability" intent by leaving the next round a complete contract; it does **not** authorize build now.

| ID | Proves | Method | PASS threshold | Builds on |
|---|---|---|---|---|
| NODE-1 | identity | each node has ed25519 `identity.{key,pub}`; `identity-registry.json` lists the peer | signature verify succeeds for a trusted peer | node-identity, 1.5 |
| NODE-2 | **broadcast→offer→accept** | node A broadcasts a context theme; B offers; A accepts | a `[peer-memory:]` block surfaces in A's next injection | broadcast-emitter/offerer/acceptor, 1.5 done-criterion |
| NODE-3 | signature enforcement | inject an unsigned/forged broadcast | it is **rejected**, not surfaced | broadcast-schemas, federation-startup |
| NODE-4 | replay dedup | resend a broadcast with a seen event id | ignored (seenIds cache) | `createSeenEventCache` |
| NODE-5 | **resilience to peer drop** | kill peer B mid-exchange | A degrades gracefully (no crash, local-first continues) then reconnects when B returns | federation-resilience, heartbeat-detect |
| NODE-6 | heartbeat/liveness | each node observes the other's heartbeat | dead-node detection fires when a peer drops | heartbeat-detect |
| NODE-7 | **partition / offline tolerance** | make *all* peers unreachable | full local function continues (local-first guarantee) | MASTER_PLAN 3.2 local-first |

Observability for these already exists: `bin/dogfood-council.mjs` (docs/DOGFOOD_PROTOCOL.md) subscribes to
the federation subjects and records round-trips — the L3 harness should *drive* the exchange and let the
dogfood harness *witness* it. Cluster/peer setup: docs/MULTI_NODE_DEPLOY.md, docs/NATS_CLUSTER.md.

---

## 9. End-to-end — L4

| ID | Proves | Method | PASS threshold | Note |
|---|---|---|---|---|
| E2E-L4-1 | memory loop closes | = MEM-L4-1 gold round-trip | nonce fact retrievable | the deployable single-node e2e |
| E2E-L4-2 | harness→LLM injection | with companion-bridge `:8787` up, send a prompt; inspect the upstream request | a memory block is present in the request to the LLM | `SKIP` while bridge is `INERT` (2.1); conditional |

E2E-L4-2 depends on companion-bridge running as a daemon, which it currently is not (COMPONENT_REGISTRY
2.1). Until it is, the gold round-trip (E2E-L4-1) is the binding end-to-end acceptance.

---

## 10. How it enforces "100%"

This protocol has teeth only if a deploy is *not done* until the gate is green:

1. **Manual gate** — `node bin/node-acceptance.mjs` after any deploy/restart. Non-zero exit = not done.
2. **Deploy-listener gate** — the mesh deploy path (`mesh-deploy-listener`) runs the harness post-restart;
   a red gate refuses to mark the deploy complete and alerts via the existing `health-watch` channels.
3. **Done-contract binding** — the harness report at `~/.openclaw/.node-acceptance.md` is the
   `Runtime-Evidence:` artifact (MASTER_PLAN §5.4) any node-touching step cites.
4. **Continuous** — optionally schedule the harness (cron / launchd) so acceptance is re-verified, not
   assumed; it complements `health-watch` (liveness, 60 s) with deep functional acceptance (e.g. hourly).

It does **not** replace the unit suite (correctness) or `health-watch` (liveness) — it sits above both as
the deployed-node truth gate.

---

## 11. Proposed build plan (after operator review)

Each step is atomic, runtime-verifiable, and maps to a layer — suitable as a `node-acceptance` plan silo
(`new-plan.sh`) or a single scoped feature, operator's call:

1. **Harness skeleton** — `bin/node-acceptance.mjs` runner, verdict/report types, gate computation,
   `--json`/report writer; wire L1 by delegating to `runHealthCheck`. *Verify:* runs, reports L1, exit code reflects gate.
2. **L0 presence** — deploy-surface probes (files, symlinks, `diff -rq`, plists, token perms). *Verify:* a deliberately-removed symlink flips MEM-L0 red.
3. **Network axis (L1/L2)** — NATS port/monitor/jsz/stream, pub/sub + JetStream round-trip, trigger round-trip. *Verify:* round-trip nonce echoed; stopping NATS flips it red.
4. **LLM axis** — model-present, generation, embedding, structured-extraction, queue. *Verify:* real generation text + 1024-dim vector captured.
5. **Memory axis incl. gold round-trip** — synthetic ingest→extract→index→inject, MEM-L4-1, teardown. *Verify:* nonce fact retrieved by content; fixtures gone after.
6. **Enforcement wiring** — deploy-listener hook + optional schedule + done-contract reference. *Verify:* a red gate blocks deploy-complete.

L3 (§8) is a **separate future block**, gated on federation being deployed.

---

## 12. Open decisions for the operator

- **D1** — Build vehicle: a dedicated `node-acceptance` **plan silo** (full protocol/tick/viewer treatment)
  vs a **single scoped feature** (`bin/node-acceptance.mjs` + this doc). (You chose design-doc-first; this
  is the next fork.)
- **D2** — Should a red acceptance gate *hard-block* the `mesh-deploy-listener`, or only warn? (§10.2)
- **D3** — Generation latency budget (`ACCEPT_GEN_BUDGET_MS`) default — 30 s tolerates cold model load;
  too loose to catch a degraded GPU. Set per-hardware?
- **D4** — Schedule cadence for continuous acceptance (§10.4), or manual/CI only?
