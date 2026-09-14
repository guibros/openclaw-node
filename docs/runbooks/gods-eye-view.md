# Runbook — God's Eye View (external, keyless, :4173)

**For:** integrations plan steps 4.1, 4.3 and 4.4. This runbook is the *procedure*; 4.1 closes on the
probes at the bottom, run on the design box.
**Status:** not yet performed. No clone exists; `COMPONENT_REGISTRY.md` records it UNBUILT.

A live globe with real-world layers (Cesium + Esri/OSM imagery, ADS-B flights, AIS vessels, USGS
quakes, CelesTrak passes). It is here because Arcane is a **geolocated** AR game — ManaWell,
LocationClaimVerifier, BiomeOracle, territory capture — and a real map is a genuine design and ops
surface for it.

**Tracked upstream, never vendored (D3)** and **keyless, text-only first**: Esri/OSM tiles, no Google
tiles, no OpenAI Realtime.

## 1. Node 24 beside the Node 22 baseline

GEV's `package.json` declares `"node": ">=24.14.0 <25 || >=26 <27"`. This node's baseline is Node 22
(`bootstrap.sh`) and **must not change** — the memory daemon, Mission Control and the mesh all run on
it.

So Node 24 is used *per launch*, never globally:

```sh
fnm install 24.14.0          # or the equivalent in your version manager
```

Never `nvm use 24` in a shell you then run node tooling from. A global switch is how the baseline
silently moves.

## 2. Clone and branch

```sh
cd ~/Documents/openclaw\ infrastructure
git clone https://github.com/<upstream>/gods-eye-view.git
cd gods-eye-view
git checkout -b arcane origin/main
echo '24.14.0' > .node-version
```

The same parent directory `companion-bridge` already uses, which is also what
`bin/openclaw-stack.mjs` defaults `OPENCLAW_GEV_DIR` to. A clone somewhere else works — set
`OPENCLAW_GEV_DIR` and the status row follows.

`arcane` is a long-lived overlay branch, not a fork. Step 4.3 touches exactly two upstream lines (a
spread in `src/data/localLayers.js`, a registry entry in `src/data/layerState.js`) plus two new files,
so rebasing stays cheap:

```sh
git fetch origin && git rebase origin/main
```

Conflicts can only land on those two lines. Prefix overlay commits `arcane:`.

## 3. Launch — and why the host argument is not optional

```sh
fnm exec --using 24 npm run dev -- --host 127.0.0.1 --port 4173
```

`vite.config.js` already defaults to `host: env.HOST || 'localhost'` and
`port: parseInt(env.PORT) || 4173`, so the port looks redundant. **The host is not.**

`bin/openclaw-stack.mjs`'s `probePort` connects to `127.0.0.1` specifically. On a Mac with IPv6,
`localhost` can bind `::1` only — and then `openclaw-stack status` reports `gods-eye-view CLOSED`
while the globe is serving perfectly at `http://localhost:4173`. Passing `--host 127.0.0.1` makes
the two agree. If you ever see CLOSED next to a working globe, this is why.

**Create no `.env`.** `npm run dev` reads only explicit environment and Vite dotenv values, so an
absent `.env` is what keeps the keyless promise mechanical rather than aspirational.

## 4. Routes

Safe, keyless GETs an agent may use:
`/api/setup/status`, `/api/regional-brief`, `/api/overpass`, `/api/celestrak`, `/api/launches`,
`/api/gbfs`.

**Off-limits, no exceptions:** `/api/setup/keys` (it *writes* provider keys), `/api/realtime/*`,
`/api/openai/*`, `/api/google/*`, `/api/tomtom`, `/api/firms`. The first is the one that matters —
a single POST there ends the keyless posture and starts brokering credentials.

Never bind the server to `0.0.0.0`. Upstream is blunt about it: a LAN-visible server brokers your
configured API keys to anyone who can reach it. Keyless or not, keep it on loopback.

`workspace-bin/web-fetch.mjs` refuses loopback **by design** (step 1.2's address pinning), so agents
drive GEV through `agent-browser`, not web-fetch. That is not a limitation to work around.

## 5. The driving seam

Layers register through `DataLayerManager` and are sealed by `finalizeRegistrations`, so a new layer
is two upstream lines. In-page, an agent toggles a layer with:

```js
window.__godsEyeView.dataManager.setEnabled('arcane-manawells', true, { origin: 'user' })
```

The same seam upstream's own `scripts/qa-cables-shot.mjs` uses — it is a supported entry point, not
a private field being poked.

## 6. The stack row is already waiting (step 4.2, done)

`openclaw-stack status` prints a `gods-eye-view` row on 4173 today:

| It prints | Meaning |
|---|---|
| `LIVE` | the port answers |
| `CLOSED` | the clone is there, GEV is not running — **not a fault**, exit stays 0 |
| `ABSENT` | no clone at `OPENCLAW_GEV_DIR` |

It never moves the exit code or the "N/M up" tally in any of those states: a desktop app you have not
opened is not a failing daemon. Nothing to configure after cloning — the row follows the directory.

## Probes that close 4.1

1. `curl -s 127.0.0.1:4173/api/setup/status` → 200 with **every provider absent**.
2. `node -v` inside the launch shell prints `24.x` — and `node -v` in your ordinary shell still
   prints `22.x`. Both halves matter; the second is the one that proves the baseline held.
3. `visual:` the globe renders with the **Esri attribution string** visible and no Google tiles.
4. `node bin/openclaw-stack.mjs status` shows `gods-eye-view LIVE 4173 open`.

Attach the screenshot to `audits/step41_*/AUDIT_POST.md`.

## Then 4.3 and 4.5

4.3 adds the ManaWell seed layer (Point features around Montreal; properties named for what a
contract read will return later — `wellId, name, biome, manaCap, manaCurrent, ownerAddress,
claimedAt, contract, chainId, source` — so swapping the loader later is not a rewrite).

4.5 is yours to decide **with the seed layer on screen**: the Arcane world data source (Hardhat
JSON-RPC `eth_call` on ManaWell views · a GeoJSONL export from `projects/arcane` watched with
`fs.watch` · locations from the pipeline/lore) and the primary job (world console · feeds for game
logic · agent design tool). 4.6–4.9 un-defer from that answer.
