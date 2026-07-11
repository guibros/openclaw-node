# AUDIT_PRE — Step 1.4 · Signed grappe membership

## §0 Micro Re-Orient

Block 1 / step 1.4 / overall step 6.
Last step (1.3): GRAPPE_REGISTRY KV live, `openclaw-grappe form/status/dissolve` working; `join_token_hash: null` in every manifest.
This step: provision a join token (SHA-256 stored in manifest), add `issue-token` + `join` subcommands; a valid join lands in the manifest, a forged join is rejected with a logged reason.
Serves MASTER_PLAN §3.1 trust floor and Block 1 exit criterion (unsigned join observed-rejected).
Still the right next step. ✓

## §1 Intent

Cryptographically gate grappe membership so only a node presenting the correct join token can enter the `members` array in GRAPPE_REGISTRY. This is the trust floor that step 4.2 signed task envelopes and step 5.3 savant change-set signing build on.

No new daemon. No new signing library. Just two new `openclaw-grappe` subcommands added to `bin/openclaw-grappe.mjs`:
- `issue-token --id <id>` — generates a random 32-byte token, stores SHA-256 hash in the manifest, prints the raw token.
- `join --id <id> --node <node-id> --token <token>` — hashes the presented token, compares with stored hash; on match: adds the node to members and updates the manifest; on mismatch or missing hash: logs rejection reason and exits 1.

## §2 Design

**Token format:** `crypto.randomBytes(32).toString('base64url')` — 43 printable characters, URL-safe, enough entropy. Not encrypted; opaque to the network.

**Hash storage:** `createHash('sha256').update(token).digest('hex')` stored in `join_token_hash`. Verifier hashes the presented token and compares. This matches FEDERATION_SPEC §2.4 exactly.

**Rejection path (carry-forward from AUDIT_POST 1.3):** The `join` subcommand is the "join attempt" concept 1.3's carry-forward identified as needed. On rejection it logs `[grappe-auth] join rejected: <reason>` to stderr and exits 1. Reasons: `no-token-provisioned`, `invalid-token`.

**Accepted path:** On success, if the node-id is not already in `members`, it is appended. The manifest is updated in GRAPPE_REGISTRY KV. stdout prints `join accepted: <node-id> added to <grappe-id>`.

**No node-identity.mjs for this step.** The spec says the same sign/verify pair is used for join tokens (1.4) and task envelopes (4.2). However FEDERATION_SPEC §2.4 explicitly specifies `join_token_hash: "<sha256 of the provisioned join token>"` — a simple hash, not an ed25519 event. The deploy-trigger-auth.mjs Needs reference refers to the structural pattern (issue → store hash → verify on presentation), not the ed25519 mechanism itself. Ed25519 task envelopes land at 4.2; using it here would be scope creep and a premature abstraction over a secret that never needs public-key semantics (it's a shared secret, not a sender-identity proof).

**Cons check:** The manifest currently has no version field. We update it in-place with `kv.put` (same pattern as `cmdDissolve`). If we add node-id `delta` to wg-alpha, wg-alpha's members array grows from 3 to 4 — acceptable for the test; we can dissolve and re-form before Block 2.

**Pre-screen (§11 Needs):**
- 1.3 registry: GRAPPE_REGISTRY KV with wg-alpha manifest (join_token_hash: null) confirmed in COMPONENT_REGISTRY. ✓
- lib/deploy-trigger-auth.mjs: exists. Pattern (issue → store hash → verify on presentation) consumed above. ✓
- bin/mesh-join-token.js: exists. Pattern (HMAC-SHA256 shared-secret, base64url token) confirms approach. ✓

All Needs satisfied. ✓

## §6 File-delta outline

| File | Change |
|---|---|
| `bin/openclaw-grappe.mjs` | Add `cmdIssueToken` (generate token, sha256 hash → KV manifest) + `cmdJoin` (hash presented token, compare, accept/reject) + case entries in `main()` switch |
| `memory-plan/plans/federation/VERSION` | v1.3 → v1.4-pre (Phase 1) → v1.4-mid (Phase 4) → v1.4 (Phase 9) |
| `memory-plan/plans/federation/INVENTORY.md` | flip 1.4 `[ ]` → `[A]` (Phase 1) → `[x]` (Phase 9) |
| `memory-plan/plans/federation/SCOPE.md` | already open |
| `memory-plan/plans/federation/audits/step14_signed-grappe-membership/AUDIT_PRE.md` | this file |
| `memory-plan/plans/federation/audits/step14_signed-grappe-membership/AUDIT_POST.md` | Phase 7 |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` | update §Membership entry (Phase 9) |

## §7 Risk register

| Risk | Mitigation |
|---|---|
| NATS not reachable at test time | :4222 verified reachable (curl :8222/varz in prior steps). If not, error is visible and step blocks. |
| Re-forming wg-alpha after join test | Dissolve + form is idempotent (1.3 proven). Note in AUDIT_POST. |
| nc.drain() TIMEOUT on issue-token | Same pattern as 1.3 cmdForm — two round-trips (get + put), drain seen clean in all 1.3 runs. |
