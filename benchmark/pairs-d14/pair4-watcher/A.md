# Watcher Contract Audit — lib/node-watch.mjs vs NODE_WATCH_SPEC (Updated)

## Build verification

```
$ node --check lib/node-watch.mjs
[no output]
exit: 0
```

No syntax errors. Line numbers and code snippets below are confirmed against the live file.

---

## Methodology

Each of the 29 SPEC rows was traced to its corresponding WATCH_TARGETS entry (or entries — the single storage row in the SPEC expands to three separate targets in the implementation). For each target, the return-path was followed to its terminal W/B/OFF/U call and the result was compared against the SPEC's declared signal. Implementation targets with no SPEC row (ops.hyperagent, fed.coordinator, fed.cluster.quorum, fed.grappe.members, fed.session.liveness) are extensions beyond the locked list and not audited here.

**Totals:** 36 implementation targets; 29 SPEC rows; 3 gaps found; 26 SPEC rows contract-matched.

---

## Spot-checks: 5 representative passing targets

| SPEC signal (verbatim) | Target ID | Implementation return | Verdict |
|---|---|---|---|
| `watcher.jsonl fresh < 30min` | `mem.watcher` | `fileFresh(ctx, p, 30 * 60_000)` → W(`fresh Nmin`) / B(`stale Nmin`) / U(`watcher.jsonl absent`) | PASS |
| `bridge :8787 /health reports healthy served sessions` | `llm.cloud` | probes `/health`; checks `sessions[].zombieRetryCount`, `lifetimeTurns`; returns W/B/OFF/U | PASS |
| `/api/diagnostics 200 + .daemon-health.md fresh` | `ops.diagnostics` | checks HTTP 200 AND `fileFresh(…, 5 * 60_000)` — both required for W | PASS |
| `diff -rq repo lib ↔ workspace lib empty` | `fabric.deploy_drift` | runs `diff -rq repoLib workspaceLib`; W if exit 0; B if diff output present | PASS |
| `opens, integrity_check ok` | `store.state_db` | `PRAGMA integrity_check` via `dbIntegrity()`; W if result === 'ok' | PASS |

---

## Gap table

| # | Target ID | SPEC signal | Implementation behavior | Severity |
|---|---|---|---|---|
| G1 | `net.federation` | `identity-registry + shared stream` | registry present → `U('registry present but no live federation probe yet')`; absent → OFF | **HIGH** — any deployed federation node returns UNKNOWN every cycle |
| G2 | `ops.roadmap` | `HTTP 200 + plans discovered` | returns `W('viewer responds 200')` on any 200; "plans discovered" half of the signal never checked | **MEDIUM** — viewer up but plan count unverified |
| G3 | `obs.sync` | `vault notes written < 2h` | scans only `vault/concepts/`; sync writing exclusively to `decisions/`, `themes/`, `sessions/` returns UNKNOWN or false-BROKEN | **HIGH** — false signal on any vault whose live notes land outside `concepts/` |

---

## G1 — source

```javascript
// lib/node-watch.mjs lines 357–361
{ id: 'net.federation', family: 'network', label: 'Federation (cross-node)',
  signal: 'identity-registry + shared stream',
  async run({ ctx, config }) {
    try { await ctx.fsp.access(ctx.path.join(config.home, 'identity-registry.json'));
          return U('registry present but no live federation probe yet'); }
    catch { return OFF('not deployed (no identity-registry.json) — deferred'); }
  } },
```

**Contract:** SPEC (NODE_WATCH_SPEC.md line 100) defines the signal as `identity-registry + shared stream`. When the registry IS present, the probe must check both the registry entry for the local node AND the JetStream shared stream. Instead it immediately returns UNKNOWN, confirming in its own detail string that no live probe exists. The SPEC coverage annotation at line 133 (`none — all targets now have a probe`) is therefore incorrect for this target — the probe code itself contradicts it.

---

## G2 — source

```javascript
// lib/node-watch.mjs lines 427–431
{ id: 'ops.roadmap', family: 'ops', label: 'Workplan viewer :7892',
  signal: 'HTTP 200 + plans discovered',
  async run({ ctx }) {
    const r = await ctx.httpGet('http://127.0.0.1:7892/', { timeoutMs: 2000 })
                       .catch((e) => ({ status: 0, error: e.message }));
    return r.status === 200 ? W('viewer responds 200')
         : (r.status ? B(`HTTP ${r.status}`) : OFF('not listening (start workplan-viewer)'));
  } },
```

**Contract:** SPEC signal is `HTTP 200 + plans discovered`. The second conjunction is missing. Confirmed: the viewer exposes `/api/plans` (workplan-viewer.mjs line 2789) returning `{ roots, plans: [...] }`.

---

## G3 — source

```javascript
// lib/node-watch.mjs lines 271–278
{ id: 'obs.sync', family: 'obsidian', label: 'Obsidian sync',
  signal: 'vault notes written recently (<2h)',
  async run({ ctx }) {
    const vault = getVaultPath();
    const newest = await newestMtimeMs(ctx, ctx.path.join(vault, 'concepts'));
    if (newest == null) return U(`no vault concept notes found at ${vault}`);
    const age = Date.now() - newest;
    return age <= 2 * HOUR ? W(`newest note ${Math.round(age / 60000)}min ago`)
                           : B(`stale: newest note ${Math.round(age / HOUR)}h ago (sync running?)`);
  } },
```

**Contract:** SPEC signal is `vault notes written < 2h` — unqualified, covering the whole vault. Scope is hardcoded to `concepts/`.

---

## Corrections (revised)

### C1 — net.federation: implement the two-part signal check

**Severity:** HIGH

The SPEC signal requires both the identity-registry entry AND the shared stream (`OPENCLAW_SHARED` — canonical name from `lib/shared-event-stream.mjs:23`). The fix uses `ctx.natsConnect()` → `nc.jetstreamManager()`, matching the pattern established by `NET-L2-STREAM` and `NET-L2-PUBSUB` (both 8000ms budgets).

Return-value map:
- registry absent → `OFF('not deployed')`
- NATS unreachable → `UNKNOWN('NATS unreachable — see net.nats for authoritative status')`
- registry present + `OPENCLAW_SHARED` stream info error → `BROKEN('shared stream OPENCLAW_SHARED absent or inaccessible')`
- registry present + stream present + local node absent from registry → `BROKEN('local node <id> not found in identity-registry')`
- all checks pass → `WORKING('registry + OPENCLAW_SHARED stream reachable; local node registered')`

```javascript
import { SHARED_STREAM_NAME } from './shared-event-stream.mjs';

{ id: 'net.federation', …, timeoutMs: 8000,
  async run({ ctx, config }) {
    const regPath = ctx.path.join(config.home, 'identity-registry.json');
    let reg;
    try { reg = JSON.parse(await ctx.fsp.readFile(regPath, 'utf8')); }
    catch { return OFF('not deployed (no identity-registry.json)'); }

    let nc;
    try { nc = await ctx.natsConnect('watcher-federation-probe'); }
    catch (e) {
      return U(`NATS unreachable (${e.message}) — defer to net.nats for authoritative status`);
    }
    try {
      const jsm = await nc.jetstreamManager();
      await jsm.streams.info(SHARED_STREAM_NAME); // throws if absent
      const nodes = Array.isArray(reg.nodes) ? reg.nodes : Object.values(reg);
      const localPresent = nodes.some(
        (n) => (n.nodeId || n.id) === config.nodeId
      );
      if (!localPresent) return B(`local node ${config.nodeId} not found in identity-registry`);
      return W(`registry + ${SHARED_STREAM_NAME} stream reachable; local node registered`);
    } catch (e) {
      return B(`shared stream ${SHARED_STREAM_NAME} absent or inaccessible: ${e.message}`);
    } finally {
      try { nc.close(); } catch { /* best-effort */ }
    }
  } },
```

### C2 — ops.roadmap: check /api/plans count

**Severity:** MEDIUM

The `/api/plans` endpoint is confirmed present in workplan-viewer.mjs (line 2789), returning `{ roots, plans: [...] }`. Both branches are now fully specified:

```javascript
{ id: 'ops.roadmap', …, timeoutMs: 4000,
  async run({ ctx }) {
    const root = await ctx.httpGet('http://127.0.0.1:7892/', { timeoutMs: 2000 })
                          .catch((e) => ({ status: 0, error: e.message }));
    if (!root.status) return OFF('not listening (start workplan-viewer)');
    if (root.status !== 200) return B(`HTTP ${root.status}`);
    // Root responds — now verify plans discovered
    const r = await ctx.httpGet('http://127.0.0.1:7892/api/plans', { timeoutMs: 2000 })
                       .catch((e) => ({ status: 0, error: e.message }));
    if (!r.status || r.status !== 200) return U('200 but /api/plans unreachable — plan count not verifiable');
    const plans = r.json?.plans;
    if (!Array.isArray(plans) || plans.length === 0) return U('200 but no plans discovered at /api/plans');
    return W(`viewer responds 200; ${plans.length} plan(s) discovered`);
  } },
```

### C3 — obs.sync: scan all vault subdirectories with exclusion list

**Severity:** HIGH

Committed to scanning all immediate subdirectories with an explicit exclusion list (forward-compatible; matches SPEC's unqualified "vault notes" language):

```javascript
const VAULT_EXCLUDE = new Set(['.git', '.obsidian', 'tmp', '.tmp', '.trash', 'node_modules']);

{ id: 'obs.sync', …,
  async run({ ctx }) {
    const vault = getVaultPath();
    let subdirs;
    try {
      const entries = await ctx.fsp.readdir(vault, { withFileTypes: true });
      subdirs = entries
        .filter((e) => e.isDirectory() && !VAULT_EXCLUDE.has(e.name))
        .map((e) => ctx.path.join(vault, e.name));
    } catch { return U(`vault root unreadable at ${vault}`); }
    if (!subdirs.length) return U(`no note subdirectories found at ${vault}`);
    let newest = 0;
    for (const dir of subdirs) {
      const m = await newestMtimeMs(ctx, dir);
      if (m != null && m > newest) newest = m;
    }
    if (!newest) return U(`no notes found in any subdirectory of ${vault}`);
    const age = Date.now() - newest;
    return age <= 2 * HOUR ? W(`newest note ${Math.round(age / 60000)}min ago`)
                           : B(`stale: newest note ${Math.round(age / HOUR)}h ago (sync running?)`);
  } },
```

`VAULT_EXCLUDE` is a named constant, easy to update as new system directories appear.

---

*Audit scope: 29 SPEC rows vs 36 implementation targets. 26 SPEC rows contract-match; 3 gaps (G1, G2, G3) with corrections C1, C2, C3 above. 5 extra implementation targets (ops.hyperagent, fed.coordinator, fed.cluster.quorum, fed.grappe.members, fed.session.liveness) extend beyond the locked SPEC list and are not evaluated here.*
