# AUDIT_POST — Step 1.3 · Grappe manifest schema + KV registry + `openclaw-grappe` CLI

## §1 Promised-vs-landed ledger

| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| `bin/openclaw-grappe.mjs` — CLI with form/status/dissolve | **yes** | new file, 220 lines |
| `package.json` — add `openclaw-grappe` bin entry | **yes** | `"openclaw-grappe": "./bin/openclaw-grappe.mjs"` |
| `memory-plan/plans/federation/INVENTORY.md` — flip 1.3 `[ ]` → `[A]` | **yes** | Phase 1; → `[x]` Phase 9 |
| `memory-plan/plans/federation/VERSION` — v1.2 → v1.3-pre → v1.3-mid → v1.3 | **yes** | each phase |
| `memory-plan/plans/federation/SCOPE.md` — step-1.2 block closed, step-1.3 block open | **yes** | Phase 1 |
| `memory-plan/plans/federation/audits/step13_grappe-manifest-kv-cli/AUDIT_PRE.md` | **yes** | Phase 1 |
| `memory-plan/plans/federation/audits/step13_grappe-manifest-kv-cli/AUDIT_POST.md` | **yes** | this file |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` — add Family 1 §1.3 entry | **yes** | Phase 9 |

Every row **yes** → step is done.

## §2 Greppable deltas

- `grep "openclaw-grappe" /Users/moltymac/openclaw-nodedev/package.json` → `"openclaw-grappe": "./bin/openclaw-grappe.mjs"`
- `node bin/openclaw-grappe.mjs status --id wg-alpha` → `Grappe wg-alpha (adversarial) — live / Members: alpha LIVE 5s ago, bravo LIVE 5s ago, charlie LIVE 5s ago` (observed 2026-07-11T01:41:58Z)
- `nats kv get GRAPPE_REGISTRY grappe.wg-alpha --server nats://127.0.0.1:4222 --raw` → `{"id":"wg-alpha","mode":"adversarial","members":["alpha","bravo","charlie"],"formed_at":"2026-07-11T01:41:53.440Z","status":"live","join_token_hash":null}`
- `grep "GRAPPE_BUCKET\|HEALTH_BUCKET\|KEY_PREFIX" bin/openclaw-grappe.mjs` → 3 hits (constants defined)

## §3 Cross-refs still valid

- INVENTORY 1.3 Needs "1.2 live nodes" — KV revisions 495+ confirmed ✔
- INVENTORY 1.3 Needs "JetStream KV" — GRAPPE_REGISTRY bucket created, 1 entry ✔
- INVENTORY 1.3 Needs "grappe schema locked in FEDERATION_SPEC (0.2)" — schema at §2.4 lines 102–110, honored exactly ✔
- INVENTORY 1.3 Feeds "management dispatch (4.2) addresses grappes by registry id" — `id` field in manifest, bucket key `grappe.<id>` ✔
- INVENTORY 1.3 Feeds "MC page (6.2) lists them" — GRAPPE_REGISTRY KV bucket now queryable by any future MC page ✔
- COMPONENT_REGISTRY Family 1 "Membership & signing" — CLI is local-first, join_token_hash=null; 1.4 fills this in ✔

## §4 Findings

- **[POSITIVE]** All three subcommands (form/status/dissolve) verified runtime-observable: manifest written to KV with correct schema, status renders with member heartbeat freshness from MESH_NODE_HEALTH, dissolve updates status to "dissolved".
- **[POSITIVE]** Schema matches FEDERATION_SPEC §2.4 exactly: {id, mode, members, formed_at, status, join_token_hash} — `join_token_hash: null` is correct placeholder for 1.4.
- **[POSITIVE]** Status cross-references MESH_NODE_HEALTH KV for member freshness — "LIVE 5s ago" pattern is honest: if the publisher dies, the entry goes stale and shows "STALE Xs ago" or "UNKNOWN".
- **[MID-IMPL FINDING / fixed]** `readEnvFile()` in the initial implementation picked up `OPENCLAW_NATS=nats://100.91.131.61:4222` from `~/.openclaw/openclaw.env` (fleet-prototype era, D4/retiring). Fixed: CLI uses `process.env.OPENCLAW_NATS` only with loopback fallback. The env file URL predates D4 cleanup and is correctly ignored here — this is loopback-first tool. Recorded for whoever scopes openclaw.env cleanup later.
- **[NOTE]** `nats kv ls` now shows two buckets: `MESH_NODE_HEALTH` (from 1.2) and `GRAPPE_REGISTRY` (this step). The KV layer is growing — consistent with Block 1's "substrate" purpose.
- **[NOTE]** `nc.drain()` in `finally` could throw TIMEOUT if JetStream publish has pending acks. The ESM `import('nats')` pattern with `{history: 1}` on an existing bucket worked cleanly in all observed runs; drain completed without error.

## §5 Phase-8 patches

None.

## §6 Carry-forwards to the next step (1.4)

- **To 1.4:** `join_token_hash: null` in every formed manifest. Step 1.4 needs to: (a) provision a join token for the grappe, (b) compute `sha256(token)`, (c) update the KV manifest's `join_token_hash`. The `kv.put(KEY_PREFIX + id, ...)` pattern in `cmdForm` is the write path to update.
- **To 1.4:** The unsigned-join rejection test requires a "join attempt" concept — FEDERATION_SPEC §2.4 says members array in the manifest, but the join protocol (present a token → accepted, absent/forged → rejected) is not yet defined at the KV level. 1.4 adds this.
- **To 6.1:** `openclaw-grappe` is not yet in the PATH for normal shell use (must run as `node bin/openclaw-grappe.mjs`). `npm link` or `npm install -g` installs it. install.sh should wire it — this is Block 6 scope.
- **To all consumers:** GRAPPE_REGISTRY KV bucket is live on the existing :4222 bus. After 1.5 (cutover), the bucket will survive on the R=3 cluster unchanged.
