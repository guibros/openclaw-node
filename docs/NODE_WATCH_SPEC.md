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
| Vault link integrity | no dangling links / coverage floor | **UNKNOWN-stub** |

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
| Mesh services | `ai.openclaw.mesh-*` units loaded | live (OFF if none) |
| Federation (cross-node) | identity-registry + shared stream | applic. (OFF if not deployed) |

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
| Calendar / scheduler | `/api/scheduler/tick` reachable | **UNKNOWN-stub** (needs safe GET, not dispatch POST) |
| Workplan viewer :7892 | HTTP 200 + plans discovered | live |
| Diagnostics (MC + health report) | `/api/diagnostics` 200 + `.daemon-health.md` fresh | live |

### Node fabric
| Element | Watch signal | Probe |
|---|---|---|
| launchd services loaded | core `ai.openclaw.*` units loaded | live |
| Deploy in sync | `diff -rq` repo lib ↔ workspace lib empty | live |
| Identity + token + config | token `0600`, identity keypair present | live |

---

## Honest coverage today

- **Implemented (live or reused):** every element above except the three marked UNKNOWN-stub.
- **UNKNOWN-stub (no probe yet — reports UNKNOWN, never green):** vault link integrity and
  calendar/scheduler. (Cloud-LLM reachability is now wired through companion-bridge — see above.)
- **Heavy probes** (local generation, embedder, structured extraction) run one-shot/`--deep` only.

The watcher's status of any element is whatever it **observes at runtime** — this doc declares the
targets and signals; it does not assert any element currently works.
