# Node Watch Spec — the elements to watch, and how

**Status:** LOCKED list, watcher BUILT (2026-06-15). `bin/node-watch.mjs` + `lib/node-watch.mjs`
report the real per-element status; 12 mocked tests green. **Not yet run against a live node** — the
operator runs it on the deployment to get real status. Reuses `lib/health-check.mjs` + the read-only
`node-acceptance` probes (no parallel implementation, MASTER_PLAN §4.6).

This is the single source of truth for *what the node watches to know it works*. Companion to
`docs/NODE_ACCEPTANCE.md` (the one-shot deploy gate); both consume the same probes — watch is the
continuous, read-only view.

---

## Verdict model (the honesty invariant)

Every element resolves to exactly one of:

| Verdict | Meaning |
|---|---|
| **WORKING** | a probe **observed** the working signal. |
| **BROKEN** | a probe observed a failure (should be working, isn't). |
| **OFF** | intentionally not active on this node (not configured / not deployed / on-demand). |
| **UNKNOWN** | could not observe — no probe yet, probe errored, or a dependency for the probe is absent. |

**The rule that fixes the lie:** nothing is ever WORKING without an observation. A target with no
implemented probe returns **UNKNOWN, never green**. Staleness of a daemon-guaranteed signal (e.g. graph
cache refresh) is **BROKEN**; absence of activity for an activity-driven signal (e.g. no recent sessions)
is **not** BROKEN. Watch mode is **read-only** — no synthetic writes per tick. Heavy probes (LLM
generate/embed/extract) run one-shot or with `--deep`; in the continuous loop they report
UNKNOWN("not probed this cycle"), never a stale WORKING.

---

## Running it

```bash
node bin/node-watch.mjs            # one-shot, ALL probes incl. heavy; exit 1 if any BROKEN
npm run node-watch                 # same
openclaw-node-watch                # same, after npm i -g / link (bin entry)
node bin/node-watch.mjs --watch                  # continuous, every 60s, heavy probes skipped
node bin/node-watch.mjs --watch --interval 30 --deep
node bin/node-watch.mjs --json --report ~/.openclaw/.node-watch.md
```

Portable: every path/URL/port resolves from the node's own env (`OPENCLAW_HOME`, `OPENCLAW_NODE_ID`,
`LLM_MODEL`, `MEMORY_INJECT_PORT`, `NATS_MONITOR_URL`, `OBSIDIAN_VAULT_PATH`, …). Writes an evidence
report to `~/.openclaw/.node-watch.md`.

---

## The locked watch list

`probe` column is the honest coverage today: **live** = real read-only probe implemented · **reuse** =
delegates to a `node-acceptance` probe · **applic.** = applicability gate (OFF when not configured) ·
**UNKNOWN-stub** = declared but no probe yet (reports UNKNOWN until built — does not lie).

### Memory
| Element | Watch signal | Probe |
|---|---|---|
| Memory daemon | process alive | reuse (health) |
| Session ingest | state.db readable + recent messages | live |
| LLM extraction | entities present, latest `last_seen` | live |
| Knowledge index | `.knowledge.db` `last_index_time` < 2h | live |
| Inject server :7893 | authorized POST returns block + items | reuse (`MEM-L2-INJECT`) |
| Memory watcher | `watcher.jsonl` fresh < 30min | live |

### Obsidian (memory subsystem)
| Element | Watch signal | Probe |
|---|---|---|
| Obsidian sync | vault notes written < 2h | live |
| Graph cache (retrieval ch.5) | `graph-cache.db` `last_refresh_at` < 30min | live |
| Vault link integrity | no dangling wikilinks | live (wraps read-only `checkVaultLinks`; heavy → one-shot/`--deep`) |

### LLM — local
| Element | Watch signal | Probe |
|---|---|---|
| Ollama model present | `LLM_MODEL` in `/api/tags` | reuse |
| Local generation | `/api/generate` non-empty completion | reuse (heavy) |
| Embedder (BGE-M3) | 1024-dim finite vector | reuse (heavy) |
| Structured extraction | schema-valid extraction | reuse (heavy) |

### LLM — cloud
| Element | Watch signal | Probe |
|---|---|---|
| Cloud LLM (via companion-bridge) | bridge `:8787` `/health` reports healthy served sessions | live (via bridge `/health`) |

> Wired **through companion-bridge** (the bridge proxies to the upstream cloud LLM). The probe reads the
> bridge's free `/health` (no tokens): WORKING if it reports sessions with completed turns and no
> zombie-retry/context failures; BROKEN if sessions are degraded; OFF if the bridge isn't running
> (it's on-demand); UNKNOWN if up but no completed turns. The watcher never sends a billable
> generation, so a definitive live upstream check requires an operator-initiated test prompt.

### Network
| Element | Watch signal | Probe |
|---|---|---|
| NATS + JetStream | `:8222/jsz` stats | reuse (`NET-L2-JSZ`) |
| Per-node event stream | `local-events-<node>` exists | reuse |
| Pub/sub round-trip | published msg echoed < 1.5s | reuse |
| Mesh services | observed running PIDs; explicitly disabled Discord loaded/not-running/exit0 is optional OFF | live (OFF if none active) |
| Federation (cross-node) | identity-registry + shared stream | applic. (OFF if not deployed) |

The mesh aggregate reads Discord's effective `HOME/.openclaw/openclaw.json`
from the HOME observed in its loaded launchd environment. Strict
`channels.discord.enabled=false`, loaded/not-running state and observed exit0
are all required to report its optional OFF detail; healthy running peers can
then make the aggregate WORKING. A disabled running tool, failure exit or another
loaded stopped peer remains BROKEN. Missing state/normal-exit/config evidence
cannot authorize the exception; unreadable/malformed policy is UNKNOWN. Missing
enabled retains the legacy expectation. This does not enable Discord, assert
its API works, or turn other node failures into healthy results. An observed
service failure keeps BROKEN even when another service or policy is unobservable.

### Storage

| Element | Watch signal | Probe |
|---|---|---|
| state.db / knowledge.db / graph-cache.db | opens, `integrity_check` ok | live |

### Agent runtime
| Element | Watch signal | Probe |
|---|---|---|
| OpenClaw gateway | fresh session JSONLs produced | live |
| companion-bridge :8787 | HTTP responds (OFF if on-demand/down) | live |

### Operations & planning surfaces
| Element | Watch signal | Probe |
|---|---|---|
| Task board (kanban) | `active-tasks.md` parses | live |
| Calendar / scheduler | `/api/scheduler/status` reachable; no overdue triggers | live (read-only GET `/api/scheduler/status`) |
| Workplan viewer :7892 | HTTP 200 + plans discovered | live |
| Diagnostics (MC + health report) | `/api/diagnostics` 200 + `.daemon-health.md` fresh | live |

### Node fabric
| Element | Watch signal | Probe |
|---|---|---|
| Core launchd services | required labels have running PIDs; known duplicate NATS jobs absent in other domains | live |
| Deploy in sync | `diff -rq` repo lib ↔ workspace lib empty | live |
| Identity + token + config | token `0600`, identity keypair present | live |

The installer declares the single `nats` job on a fresh node. A node using
the documented `nats-1..3` cluster or the `nats`, `nats-2`, `nats-3` layout declares
`{"schema":1,"activeLabels":[...]}` in
`~/.openclaw/config/nats-writer-cohort.json`. After a protected writer
handoff, the root-owned marker pins the active labels and selects launchd's
`system` domain. A missing declaration reports UNKNOWN; an update to an
existing NATS installation does not guess its cohort. The watcher reports PID
liveness and checks the four known
NATS labels in `gui`, `user` and `system`; it does not prove binary, UID,
config, store, JetStream health, or absence of unlisted/unmanaged processes.

---

## Honest coverage today

- **Implemented (live or reused):** every element above except the three marked UNKNOWN-stub.
- **UNKNOWN-stub (no probe yet — reports UNKNOWN, never green):** none — all targets now have a probe.
  (Vault link integrity wraps the read-only `checkVaultLinks`; calendar reads `/api/scheduler/status`;
  cloud-LLM reachability is wired through companion-bridge — see above.)
- **Heavy probes** (local generation, embedder, structured extraction) run one-shot/`--deep` only.

The watcher's status of any element is whatever it **observes at runtime** — this doc declares the
targets and signals; it does not assert any element currently works.
