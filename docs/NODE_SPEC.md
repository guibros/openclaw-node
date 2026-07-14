# NODE_SPEC — everything a fresh OpenClaw node needs (except the OS)

**Status:** authoritative as of 2026-07-11. This is the deployment contract: what must exist on a
machine for an OpenClaw node to be *functionally running*, which of it `install.sh` provides, and
where a human is required in the loop. The enforcement of this spec is `bin/node-acceptance.mjs`,
which `install.sh` runs as its final phase. The verification matrix is
[INSTALL_TEST_PROTOCOL.md](INSTALL_TEST_PROTOCOL.md).

Plain-language summary: a node is (1) a **message bus** (NATS), (2) a **memory brain**
(memory-daemon + local LLM extraction + embeddings), (3) a **federation worker** (mesh daemons +
agents that do LLM work in grappes), (4) an **honest watcher** (node-watch + acceptance gate +
notifications), and (5) **surfaces** (Mission Control, gateway). Everything below exists to stand
those five up.

---

## §1 Hardware baseline (consumer-HW target)

| Resource | Floor | Recommended | Why |
|---|---|---|---|
| RAM | 16 GB | 32 GB+ | `check-llm-baseline.mjs` tier policy: <16 GB = below floor → local extraction not viable (cloud or regex-degraded). 16 GB → qwen3:8b (~5 GB), 32 GB → qwen3:14b, 48 GB → qwen3:32b |
| Disk | 20 GB free | 40 GB+ | qwen3:8b ~5 GB · BGE-M3 embedder ~2 GB · JetStream store (cap 2 GB) · MC node_modules ~1 GB · Chromium ~400 MB · logs/ledgers |
| CPU/GPU | Apple Silicon or x86-64 w/ AVX2 | Apple Silicon / CUDA | ollama inference speed; all functionality works CPU-only, slower |
| Network | required at install | — | package installs, model pulls, one-time ~2 GB HuggingFace embedder fetch. Runtime is loopback-local |

## §2 System software (everything except the OS)

**Required — install.sh installs or verifies each, fail-loud:**

| Component | macOS source | Linux source | Consumed by |
|---|---|---|---|
| Node.js ≥18 (22 LTS) | operator installs (brew/nodejs.org) — install exits with instruction | auto (NodeSource apt) | every daemon |
| npm | ships with node | ships with node | MC, skills, repo deps |
| **repo `node_modules`** (`nats`, `better-sqlite3`, …) | **install.sh runs `npm install` in the repo** | same | all mesh daemons (exec from repo), workspace symlinks |
| **nats-server ≥2.10** | brew (auto if brew present) | pinned GitHub release binary → `/usr/local/bin` | the bus every subsystem talks through |
| **ollama** | brew (auto if brew present) | official install script | extraction LLM + local mesh-agent brain (skippable: `--skip-llm`) |
| python3 + PyYAML | operator installs / pip --user | auto (apt + pip) | compile-boot |
| git, sqlite3, curl, jq | assumed/warned | auto (apt) | tooling, probes |
| build-essential | Xcode CLT assumed | auto (apt) | better-sqlite3 native build |
| terminal-notifier / libnotify-bin | brew (auto) | apt (auto) | clickable popups (fallback: ledger-only) |

**Models — pulled by install.sh unless `--skip-llm`:**

| Model | Size | Runtime | Used by |
|---|---|---|---|
| `qwen3:8b` (or RAM-tier: 14b/32b — `check-llm-baseline.mjs` picks) | 5–18 GB | ollama | memory extraction, inject analysis, concept notes, watch probes — **harness organ ONLY, never a grappe worker (D11)** |
| `Xenova/bge-m3` | ~2 GB | in-process (transformers.js, NOT ollama) | embeddings: session indexing, semantic search, inject retrieval |

**The agent frontend — the OpenClaw's mind (D10):** the node is frontend-agnostic (Claude Code /
codex / gemini — whatever drives this OpenClaw). install.sh detects an installed frontend, installs
the default (`@anthropic-ai/claude-code`) when none exists, and guides sign-in; **authentication is
inherently human-in-the-loop** (run `claude` once interactively; optional live check:
`bash install.sh --update --verify-frontend`). The *harness* runs headless without a frontend —
but a node with no mind seated is a body, not an OpenClaw.

**Explicitly NOT required for a functional harness:** frontend auth (required only to seat the
mind), Discord token (only mesh-tool-discord), Gemini/Google API key (only MC TTS), Tailscale (only
multi-machine mesh), the global `openclaw` npm package (only the gateway surface), ClawVault.

## §3 Functional parameters (the canonical set)

Written to `~/.openclaw/openclaw.env` by install (generated where marked ⚙; RAM-tiered where marked ⚖):

| Key | Default | ⚙ | Consumer | Meaning |
|---|---|---|---|---|
| `OPENCLAW_NATS` | `nats://127.0.0.1:4222` | | `lib/nats-resolve.js` → every bus client | bus address (loopback by design) |
| `OPENCLAW_NATS_TOKEN` | ⚙ `openssl rand -hex 32` | ⚙ | nats-resolve + rendered NATS confs | server-side auth (D2 trust floor) |
| `OPENCLAW_NODE_ID` | hostname (sanitized) | | heartbeats, KV keys, identity, grappe membership | stable node identity string |
| `OPENCLAW_NODE_ROLE` | macOS `lead` / Linux `worker` | | service-manifest role filter | which units install |
| `MESH_LLM_PROVIDER` | `ollama` ⚠ | ⚙ | `lib/llm-providers.js` → mesh-agent | **DEFECT (D11): defaulting the grappe worker to a local model is wrong — a grappe worker MUST be the node's OpenClaw agent on an advanced LLM. Fix queued for the next code pass.** |
| `LLM_MODEL` | `qwen3:8b` ⚖ | ⚙ | llm-client (extraction) + probes | the local model tag — extraction/probe organ ONLY, never a grappe worker's mind (D11) |
| `LLM_BASE_URL` | `http://localhost:11434` | ⚙ | llm-client, probes | ollama endpoint |
| `USE_LLM_EXTRACTION` | `true` | | pre-compression-flush | extraction mode (falls back to regex, loudly watched) |
| `OPENCLAW_TIMEZONE` | `America/Montreal` | | timers, memory files | timestamps |
| optional: `ANTHROPIC/OPENAI/GOOGLE_API_KEY`, `DISCORD_BOT_TOKEN`, `OBSIDIAN_API_KEY`, `KNOWLEDGE_MODEL`, `LLM_TIMEOUT`, `LLM_ANALYSIS_TIMEOUT` | — | | respective adapters | cloud/off-node extras; the core node runs with none of them |

**Identity (not env):** ed25519 keypair provisioned at install via `lib/node-identity.mjs getOrCreateIdentity(~/.openclaw)` — grappe signing (federation 1.4) has a keypair to stand on from day 1.

## §4 Filesystem layout after install

```
~/.openclaw/                    runtime root (OPENCLAW_ROOT)
  openclaw.env                  the parameter file (§3)
  openclaw.json                 gateway/companion profile (auth added by operator if used)
  config/{daemon,transcript-sources,obsidian-sync,notify}.json
  config/nats.conf              single-node bus (rendered, token embedded)   ← DEFAULT BUS
  config/nats-{1,2,3}.conf      R=3 cluster (rendered; operator-gated upgrade, fed. 1.5)
  identity/                     ed25519 node keypair
  nats/jetstream/               JetStream store (absolute path — no tilde)
  logs/  notifications/  souls/  rules/  plan-templates/  share/
  workspace/                    the agent workspace (OPENCLAW_WORKSPACE)
    bin/                        workspace daemons + watch + notify (+ graph-cache, observer, …)
    lib/                        shared libs INCLUDING mcp-knowledge (embedder)
    node_modules/               symlinks: better-sqlite3, bindings, nats, js-yaml, …
    memory/  .learnings/  .boot/  skills/  projects/mission-control/
~/openclaw/{bin,lib,node_modules}   mesh tree (Linux exec root; macOS units exec from the repo)
~/Library/LaunchAgents/ai.openclaw.*.plist   (or ~/.config/systemd/user/openclaw-*)
```

## §5 Service topology (what runs, what it needs)

| Unit | Autostart | Depends on | Plain-language job |
|---|---|---|---|
| **openclaw-nats** (single-node) | **yes** | nats-server binary, rendered conf | the loopback message bus + JetStream KV. Everything else talks through it |
| openclaw-nats-1/2/3 | no (upgrade path) | operator (federation step 1.5 runbook) | R=3 cluster for production resilience |
| openclaw-memory-daemon | yes | workspace tree, ollama (degrades honestly) | watches Claude transcripts → extraction → memory files/DB → event spine. Unit execs `workspace-bin/memory-daemon.mjs`; the federation-hardened `bin/openclaw-memory-daemon.mjs` is a separate variant with no unit yet (dormant) |
| openclaw-consolidation-scheduler | yes (timer 30 min) | memory-daemon DB | idle-time memory consolidation cycles |
| openclaw-mesh-task-daemon | yes (lead) | bus, repo node_modules | task coordinator: task KV, collab/circling sessions, plan waves |
| openclaw-mesh-bridge | yes (lead) | bus | kanban ⇄ mesh dispatch + result sync |
| openclaw-mesh-health-publisher | yes | bus | heartbeats node health into MESH_NODE_HEALTH KV |
| openclaw-mesh-deploy-listener | yes | bus (retry-loops politely) | fleet deploy receiver |
| openclaw-mesh-agent | **no — on demand** | bus, LLM provider | the worker brain; started per-node for grappe work (see §6) |
| openclaw-mesh-tool-discord | **no** (needs token) | bus + `DISCORD_BOT_TOKEN` | Discord proxy tool |
| openclaw-node-watch | yes | nothing (honest probes) | WORKING/BROKEN/OFF/UNKNOWN watcher + notifications |
| openclaw-observer | yes (timer 60s) | workspace tree | 5-layer uptime/activity ledger sampler |
| openclaw-scheduler-heartbeat | yes (timer 60s) | Mission Control | ticks MC's scheduler API |
| openclaw-mission-control | yes | npm, production build (see gate) | the dashboard on :3000 |
| openclaw-gateway | **no** (product not vendored) | global `openclaw` pkg + auth | external gateway surface; enable after `npm i -g openclaw` |
| openclaw-log-rotate | yes (timer weekly) | nothing | rotates `~/.openclaw/logs` + workspace `.tmp` |

**Ports:** 4222 bus (+8222 monitor; cluster adds 4223-4/6222-4/8223-4) · 3000 MC · 7893 memory-inject · 11434 ollama · 8787 companion-bridge · 18789 gateway. All loopback.

## §6 Human-in-the-loop walkthrough (the honest list)

**Required humans steps — exactly these, in order:**
1. macOS only: install Node ≥18 (and Homebrew if you want nats-server/ollama auto-installed). Linux: none.
2. Run `bash install.sh --enable-services` (add `--role=lead|worker` if the default is wrong).
3. Wait for model pulls (5–18 GB) and the embedder prefetch (~2 GB) — one-time.
4. **Seat the mind:** run `claude` once interactively to sign in (install already put the CLI in
   place if it was missing). Verify any time: `bash install.sh --update --verify-frontend`.
5. Read the acceptance gate output at the end. **Green (`ACCEPTED`) = the node is running.** Anything else prints exactly what is broken and why.

**Optional human steps (feature unlocks, not core):**
- Cloud agent brain: `claude` CLI login, set `MESH_LLM_PROVIDER=claude`.
- Gateway surface: `npm i -g openclaw`, add auth profile to `~/.openclaw/openclaw.json`, flip `openclaw-gateway` autostart.
- Discord tool: put `DISCORD_BOT_TOKEN` in the env, flip `openclaw-mesh-tool-discord`.
- MC voice (TTS): `GOOGLE_API_KEY` in env.
- Multi-machine: Tailscale + `docs/MULTI_NODE_DEPLOY.md`.

**Running grappe work (single box, 3 logical agents):**
```bash
for n in alpha bravo charlie; do
  OPENCLAW_NODE_ID=$n node bin/mesh-agent.js >>/tmp/agent-$n.log 2>&1 &
done
node bin/openclaw-grappe.mjs form --id wg-alpha --mode adversarial --members alpha,bravo,charlie
node bin/mesh.js submit <task.yaml>     # collaboration.mode: circling_strategy
```
(Agents inherit `MESH_LLM_PROVIDER=ollama` from the env — no cloud auth needed. Per-node agent
*units* are federation Block 6 work; today agents are on-demand processes by design.)

## §7 What "functionally running" means (the gate)

`install.sh` ends by executing `node-acceptance.mjs` (when services were enabled): every axis —
memory, LLM, network/bus, storage, runtime, ops — must probe WORKING or the install **exits
non-zero with the failing axis named**. No echo-banner-and-hope. Re-verify any time:

```bash
node ~/.openclaw/workspace/bin/node-acceptance.mjs            # full gate, evidence → ~/.openclaw/.node-acceptance.md
node ~/.openclaw/workspace/bin/node-watch.mjs --once          # live WORKING/BROKEN/OFF/UNKNOWN map
```

Known-dishonest areas the gate will name on some machines: MC production build (blocked by queued
tsc errors — MC probes read BROKEN until fixed; `npm run dev` is the interim), and sub-floor-RAM
machines (extraction honestly degrades to regex and the llm axis says so).
