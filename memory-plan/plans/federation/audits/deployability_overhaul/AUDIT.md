# AUDIT — deployability-install-overhaul (operator-directed batch, 2026-07-11)

**Scope label:** `deployability-install-overhaul` · **Decision:** D9 · **Evidence base:** the
2026-07-11 fresh-install audit (OUT_OF_SCOPE evening entry; 4 auditors + Opus cross-review).
**Directive:** operator, in-session 2026-07-11 ~18:30 Montreal: spec sheet → functional parameters
→ corrected install protocol → exhaustive test protocol.

## What shipped

| Area | Change |
|---|---|
| docs/NODE_SPEC.md (new) | The deployment contract: everything-but-the-OS requirements, §3 parameter table, service topology, HIL walkthrough, gate definition |
| docs/INSTALL_TEST_PROTOCOL.md (new) | T0–T7 proof ladder; T7 clean-machine is the only "fresh works" authority |
| openclaw.env.example | Full functional parameter set — LLM local-first defaults now first-class |
| services/nats/nats-single.conf + ai.openclaw.nats.plist + openclaw-nats.service (new) | Single-node bus: loopback, token, JetStream, absolute store_dir; `${NATS_SERVER_BIN}` rendered |
| services/systemd/openclaw-nats-{1,2,3}.service (new) | Linux parity for the cluster upgrade path |
| services/nats/nats-{1,2,3}.conf | store_dir tilde → `${HOME}` (nats-server does not tilde-expand) |
| services/service-manifest.json | +openclaw-nats (autostart), +consolidation-scheduler (timer); gateway + mesh-tool-discord → autostart:false (honest: exec not vendored / token required) |
| All 6 mesh systemd units | Exec root unified on `${OPENCLAW_REPO_DIR}` (was `~/openclaw` divergence), NODE_PATH fixed, OPENCLAW_NODE_ID added; deploy-listener's hardcoded `~/openclaw-node` removed |
| mesh-agent units (both OS) | MESH_LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL rendered in |
| mission-control units (both OS) | Exec `${NPM_BIN}` (was a never-created path) |
| consolidation-scheduler plist | Hardcoded `daedalus` → `${OPENCLAW_NODE_ID}`; systemd service+timer added |
| bin/log-rotate (new) | The weekly-rotate exec target that never existed |
| install.sh | +nats-server install (brew / pinned GitHub release), +ollama install (`--skip-llm` opt-out), +repo `npm install`, mcp-knowledge NO LONGER excluded from workspace lib + its deps installed there, workspace bin cherry-pick +graph-cache/observer/consolidation-scheduler, **workspace node_modules = symlink-all of repo deps**, packages/event-schemas copied, LLM env keys appended + RAM-tier model pick (check-llm-baseline), ed25519 identity provisioned (getOrCreateIdentity), ollama model pull + BGE-M3 prefetch, MC `next build` attempt, `$HOME/.openclaw` hardcodes → `$OPENCLAW_ROOT`, unit-dir/mesh-home overrides (sandbox-testable), **render audit fail-loud on live `${VAR}`**, `--update` no longer bare-unloads running units, **final phase = node-acceptance gate, exit non-zero on failure**, honest VERIFIED/NOT-VERIFIED banner, `--sandbox/--skip-llm/--skip-verify` flags |
| README.md / MULTI_NODE_DEPLOY.md | Install steps rewritten to reality; the unrendered-conf token trap replaced with rendered-conf instructions |

## The five boot kills (memory-daemon), closed and proven

1. `lib/mcp-knowledge` excluded from workspace lib copy (install.sh:345 old) — **static audit**
2. `bin/obsidian-graph-cache.mjs` never placed at `$WS/bin` — **static audit**
3. `nats` unresolvable from `$WS/node_modules` (4-package symlink list) — **static audit**
4. `zod` unresolvable (`lib/extraction-schema.mjs`) — **caught by the live boot test**, missed by every static audit including Opus's
5. `packages/event-schemas/dist` never copied (event spine silently off) — **caught by the live boot test**

Fix class for 3–5: workspace daemons are repo code copied out → workspace now symlinks the repo's
ENTIRE dependency set (168 links) instead of an allow-list that rots.

## Verification (all observed 2026-07-11 evening, sandbox = scratch OPENCLAW_ROOT/MESH_HOME/UNIT_DIR)

| Check | Result |
|---|---|
| `bash -n install.sh` | clean |
| Full `install.sh --sandbox` run | end-to-end, exit 0, **19 units rendered**, zero launchctl side effects, honest NOT-VERIFIED banner |
| Unrendered `${VAR}` in units/configs | **none** (grep + the new in-install audit) |
| `plutil -lint` all 19 plists | valid |
| Rendered values | mesh-agent: `ollama`/`qwen3:8b` · nats unit: real binary path · MC: real npm path |
| memory-daemon boot (scratch tree, fake HOME) | **BOOTS**: NATS connected, Knowledge DB + graph cache + LLM client + extraction store initialized, graceful SIGTERM. Round 1 caught kill #4 (zod); round 2 caught #5 (event-schemas); round 3 clean |
| memory-daemon boot, bus DOWN | tolerant: "NATS unavailable — retrying every 60s", all stores init (R16 behavior confirmed on the deployed tree) |
| Single-node NATS from rendered conf (scratch ports 14222/18222) | v2.12.6 up, `server_name=openclaw-nats-freshtest` (node-id render works), **jetstream=true**, correct token CONNECT OK, wrong token → `Authorization Violation` |
| ed25519 identity | `identity.key` (mode 600) + `identity.pub` created in scratch root |
| env file | all 5 functional params present, token = generated hex |

## Honest UNKNOWNs (open until T7 on a clean machine)

- ollama install / model pull / BGE-M3 prefetch paths (skipped in sandbox — dev box has them)
- MC `npm install` + `next build` (sandbox-skipped; build is KNOWN-failing — 20 tsc errors queued; the gate reports MC honestly)
- The full `--enable-services` + acceptance-gate run (cannot start duplicate units on the live dev node)
- Everything Linux (static-only evidence)
- Known cosmetic: daemon's own node-id fallback (env absent) uses unsanitized hostname → dotted stream name rejected; units always set the env, so unreachable via installed paths

**Per MASTER_PLAN §5: "fresh install works" may only be written after a signed T7
(INSTALL_TEST_PROTOCOL §T7). Until then the claim is: implemented + sandbox-verified.**
