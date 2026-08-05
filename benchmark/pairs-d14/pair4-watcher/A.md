---

## Node Watch Contract Audit: `lib/node-watch.mjs` vs `docs/NODE_WATCH_SPEC.md`

### Gap Table

| ID | Element | Spec Signal | Implementation | Gap Type |
|---|---|---|---|---|
| `net.federation` | Federation (cross-node) | identity-registry + shared stream; OFF if not deployed | Returns `UNKNOWN("registry present but no live federation probe yet")` when `identity-registry.json` exists; shared stream never probed | UNKNOWN-stub present despite spec asserting "none — all targets now have a probe" |
| `ops.roadmap` | Workplan viewer :7892 | HTTP 200 **+ plans discovered** | `r.status === 200 ? W('viewer responds 200')` — body never inspected for plans | Asserts less than documented signal |
| `fabric.identity_config` | Identity + token + config | token 0600, identity keypair, **configs parse** | Checks token mode and `identity.key` presence; no config file is read or parsed | Asserts less than documented signal |
| `obs.sync` | Obsidian sync | vault notes written < 2h | Scans only `vault/concepts`; no other subdirectories included | Signal narrowed (recent writes to sessions/, decisions/, snippets/ etc. invisible) |
| `ops.taskboard` | Task board (kanban) | active-tasks.md **parses** | Non-empty check + line count; no structural kanban parse | Asserts less than documented signal |

**Verified contracts (no gap found):**

- *Loaded vs. running*: `gradeMeshServices` and `gradeRequiredServices` correctly grade loaded-but-stopped services as BROKEN rather than WORKING. The spec's "units loaded" language is imprecise; the implementation is stricter and correct.
- *Stale evidence read as fresh*: All freshness probes (`mem.knowledge_index`, `obs.graph_cache`, `mem.watcher`, `obs.sync`) call `Date.now()` at probe time and compute age against it. No cached timestamp is reused across cycles.
- *Heavy probes in watch mode*: `LLM-L2-GEN`, `LLM-L2-EMBED`, and `LLM-L2-EXTRACT` all return `UNKNOWN("not probed this cycle")` when `includeHeavy` is false; `obs.links` is flagged `slow: true` and skips identically. No stale WORKING leaks through.
- *Ingest/extraction freshness*: `gradeIngest` compares `lastMessageMs` against live transcript mtime at call time; `gradeExtraction` enforces a 6-hour stall budget against the live `lastMessageMs`. Both fixed the historical "dark ingest" class of false WORKING.
- *All 29 spec elements are present* in `WATCH_TARGETS`; no spec element is missing an entry. Four federation targets (`fed.coordinator`, `fed.cluster.quorum`, `fed.grappe.members`, `fed.session.liveness`) exist beyond the spec's locked list and are additive.

---

### Three Highest-Value Corrections

**1. `net.federation` — UNKNOWN-stub contradicts the spec's own invariant**

The spec's "Honest coverage" section explicitly states: *"UNKNOWN-stub (no probe yet — reports UNKNOWN, never green): none — all targets now have a probe."* This claim is false. When `identity-registry.json` is present (federation deployed), the probe unconditionally returns `U('registry present but no live federation probe yet')` — a stub comment baked into shipping code. Both halves of the documented signal are checkable without mutations: the registry is readable with `ctx.fsp.readFile`, and the shared stream's existence can be queried via the JetStream manager using the same `jsm.streams.info(name)` pattern already in `NET-L2-STREAM`. A deployed federation node permanently reports UNKNOWN on a target the spec guarantees has a probe; this is the honesty invariant broken at the spec level, not just the implementation level.

**2. `ops.roadmap` — Plans-discovered half is unimplemented**

The implementation returns `W('viewer responds 200')` for any HTTP 200, with no body inspection. The spec signal is "HTTP 200 + plans discovered" — the second half is the meaningful assertion (an empty or misconfigured viewer can return 200). The workplan viewer's response body is expected to contain discoverable plan entries; checking for at least one plan (e.g., a non-empty list or route indicator in the JSON body) is the observation that earns WORKING. Without it, a correctly-listening but content-empty viewer passes as WORKING while the "plans discovered" signal goes permanently unearned.

**3. `fabric.identity_config` — Configs parse is entirely absent**

The documented signal is "token `0600`, identity keypair, configs parse." The implementation checks `st.mode & 0o077` for the inject token and `ctx.fsp.access(identity.key)` for the keypair — then stops. No config file is opened or parsed. A node whose `node-config.json` (or equivalent from `resolveNodeConfig`) is corrupted, truncated, or missing required keys passes this probe, while the spec requires that condition to produce BROKEN. The config path is already available via `config` in the probe env; a `JSON.parse(readFile(...))` covering the node config file resolves the gap.
