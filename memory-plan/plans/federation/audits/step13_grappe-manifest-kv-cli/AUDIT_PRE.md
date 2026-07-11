# AUDIT_PRE — Step 1.3 · Grappe manifest schema + KV registry + `openclaw-grappe` CLI

## §0 Micro Re-Orient

Block 1 / Step 1.3 / v1.3. Step 1.2 landed 3 live logical nodes (alpha/bravo/charlie) publishing
heartbeats to MESH_NODE_HEALTH KV. THIS step makes grappes first-class KV objects with a CLI so
the rest of Block 1 (signed membership 1.4, cutover 1.5) and all downstream blocks can address
grappes by id. Block 1 serves Block 1 exit criterion: `openclaw-grappe status` shows one registered
worker grappe of 3 live members. Still the right next step: yes.

## §1 Intent

Deliver `bin/openclaw-grappe.mjs` — a standalone CLI that:
- `form --id <id> --mode <mode> --members <m1,m2,m3>` — writes a grappe manifest to JetStream KV
- `status [--id <id>]` — renders grappe(s) with member heartbeat freshness from MESH_NODE_HEALTH
- `dissolve --id <id>` — marks a grappe dissolved (status → "dissolved") in KV

Wire `openclaw-grappe` into `package.json` bin entries so it's reachable as a command.

KV bucket: `GRAPPE_REGISTRY`. Key pattern: `grappe.<id>` per FEDERATION_SPEC §2.4.

## §2 Design (consuming 1.2 carry-forwards)

**From 1.2 carry-forwards:**
- 3 live node-ids (alpha/bravo/charlie) in MESH_NODE_HEALTH; publishers are background processes
  (not launchd). Per-node launchd units are Block 6 scope — irrelevant here.
- CLI must discover member liveness from MESH_NODE_HEALTH KV, not launchd service state.
- `openclaw-grappe form` must handle the case where the GRAPPE_REGISTRY bucket doesn't exist yet
  (create it on first `form`).

**Schema (FEDERATION_SPEC §2.4):**
```javascript
{
  id: "wg-alpha",
  mode: "adversarial" | "cooperative" | "collaborative",
  members: ["alpha", "bravo", "charlie"],
  formed_at: "<ISO timestamp>",
  status: "live",   // "recruiting" | "live" | "dissolved"
  join_token_hash: null,   // 1.4 fills this in
}
```

**NATS connection:** ESM dynamic import pattern from consolidate.mjs/dogfood-council.mjs:
`const { connect } = await import('nats')`. The live :4222 bus has no token auth yet (pre-1.5
cutover) so no token needed. When the token-hardened cluster lands (1.5), the env-var path
`process.env.OPENCLAW_NATS_TOKEN` covers it without code change.

**Status output:** for each grappe, show id/mode/status/formed_at + per-member row with heartbeat
age (seconds since last MESH_NODE_HEALTH revision timestamp). A member with no KV entry is shown
as UNKNOWN.

**Atomicity check:** one outcome — `openclaw-grappe status` renders a grappe with 3 live members
after `form`. No "and" needed. ✓

## §3 Risk register

| Risk | Mitigation |
|---|---|
| GRAPPE_REGISTRY bucket doesn't exist on fresh system | `form` creates it; `status`/`dissolve` emit actionable error if absent |
| Member heartbeat timestamps not parseable from KV | `nats kv get` with `--raw` returns JSON; mesh-health-publisher payload has `timestamp` field |
| `nats` ESM import in a `.mjs` that resolves CJS — already works per consolidate.mjs | no action needed |
| `join_token_hash: null` upsets 1.4 — needs a valid value or null | null is explicitly valid (schema comment "1.4 fills this"); document it |

## §4 Pre-screen (§11 Needs check)

| Need | Present? | Evidence |
|---|---|---|
| 1.2 live nodes (alpha, bravo, charlie) | ✓ | KV revisions 367/368/369 at 2026-07-10 21:28:21 |
| JetStream KV on :4222 | ✓ | `nats kv ls` → MESH_NODE_HEALTH bucket exists |
| Grappe schema locked in FEDERATION_SPEC (0.2) | ✓ | docs/FEDERATION_SPEC.md §2.4 — schema at lines 102–110 |

All Needs present. No Need building needed.

## §6 File-delta outline

| File | Change |
|---|---|
| `bin/openclaw-grappe.mjs` | NEW — CLI with form/status/dissolve subcommands |
| `package.json` | ADD `"openclaw-grappe": "./bin/openclaw-grappe.mjs"` to bin |
| `memory-plan/plans/federation/INVENTORY.md` | flip row 1.3 `[ ]` → `[A]` |
| `memory-plan/plans/federation/VERSION` | v1.2 → v1.3-pre (this phase) → v1.3-mid (post-impl) → v1.3 (close) |
| `memory-plan/plans/federation/SCOPE.md` | already updated (step-1.3 block open) |
| `memory-plan/plans/federation/audits/step13_grappe-manifest-kv-cli/AUDIT_PRE.md` | this file |
| `memory-plan/plans/federation/audits/step13_grappe-manifest-kv-cli/AUDIT_POST.md` | Phase 7 |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` | Phase 9: new §1.3 grappe CLI entry |
