# AUDIT_POST — Step 1.4 · Signed grappe membership

## §1 Promised-vs-landed ledger

| Promised (AUDIT_PRE §6) | Landed? | Where |
|---|---|---|
| `bin/openclaw-grappe.mjs` — add `cmdIssueToken` + `cmdJoin` + switch cases | **yes** | lines 182–292; `issue-token` and `join` cases in switch |
| `memory-plan/plans/federation/VERSION` — v1.3 → v1.4-pre → v1.4-mid → v1.4 | **yes** (v1.4 at close) | each phase |
| `memory-plan/plans/federation/INVENTORY.md` — flip 1.4 `[ ]` → `[A]` → `[x]` | **yes** | Phases 1/9 |
| `memory-plan/plans/federation/SCOPE.md` — step-1.4 block open → closed | **yes** | Phases 1/9 |
| `memory-plan/plans/federation/audits/step14_signed-grappe-membership/AUDIT_PRE.md` | **yes** | Phase 1 |
| `memory-plan/plans/federation/audits/step14_signed-grappe-membership/AUDIT_POST.md` | **yes** | this file |
| `memory-plan/plans/federation/COMPONENT_REGISTRY.md` — update Membership entry | **yes** | Phase 9 |

Every row **yes** → step is done.

## §2 Greppable deltas

- `grep "cmdIssueToken" bin/openclaw-grappe.mjs` → line 187, 291
- `grep "cmdJoin" bin/openclaw-grappe.mjs` → line 218, 292
- `grep "grappe-auth" bin/openclaw-grappe.mjs` → lines 240, 246 (`join rejected: no-token-provisioned`, `join rejected: invalid-token`)
- `grep "join accepted" bin/openclaw-grappe.mjs` → line 256
- `grep "tokenHash" bin/openclaw-grappe.mjs` → lines 60-62, 206, 245

Runtime observations (2026-07-11T01:54Z):
- `node bin/openclaw-grappe.mjs issue-token --id wg-alpha` → `join token issued for grappe wg-alpha` + `token: QAanEzOLCke75rqrKbaCW3Q87_mA8dsAgVcAfcjF6gI`
- `node bin/openclaw-grappe.mjs join --id wg-alpha --node delta --token QAanEzOLCke75rqrKbaCW3Q87_mA8dsAgVcAfcjF6gI` → `join accepted: delta added to wg-alpha`
- `node bin/openclaw-grappe.mjs join --id wg-alpha --node epsilon --token forged_token_abc123` → exit 1 + `[grappe-auth] join rejected: invalid-token (node epsilon → grappe wg-alpha)` on stderr
- `nats kv get GRAPPE_REGISTRY grappe.wg-alpha --raw` → `{"id":"wg-alpha","mode":"adversarial","members":["alpha","bravo","charlie","delta"],"formed_at":"2026-07-11T01:41:53.440Z","status":"live","join_token_hash":"7d562ce0de7e2472e22518dffc25ac57093d972ae775c48bd790ace82afd60ca"}` — delta in members, epsilon absent, hash non-null.

## §3 Cross-refs still valid

- INVENTORY 1.4 Needs "1.3 registry" — GRAPPE_REGISTRY KV with wg-alpha manifest confirmed reachable ✔
- INVENTORY 1.4 Needs "lib/deploy-trigger-auth.mjs signature pattern" — hash-compare pattern applied; `{ok, reason}` shape mirrored in cmdJoin's rejection log ✔
- INVENTORY 1.4 Needs "bin/mesh-join-token.js" — HMAC-SHA256 + base64url token pattern adopted (SHA-256 + randomBytes(32)) ✔
- INVENTORY 1.4 Feeds "4.2 signed task envelopes reuse the same verification" — `tokenHash()` utility at bin/openclaw-grappe.mjs:60 is the hash contract; 4.2 will use ed25519 at the envelope level (different layer, same trust model) ✔
- INVENTORY 1.4 Feeds "savant change-set signing (5.3)" — gate pattern (reject unsigned, log reason, exit 1) established ✔
- FEDERATION_SPEC §2.4 `join_token_hash: "<sha256 of the provisioned join token>"` — satisfied exactly ✔
- COMPONENT_REGISTRY Family 1 "Membership & signing" — updated to LIVE (Phase 9) ✔

## §4 Findings

- **[POSITIVE]** Both runtime paths of the Verify contract observed: valid-token join accepted (delta in KV members); forged-token join rejected with logged reason and exit 1.
- **[POSITIVE]** KV manifest now non-null `join_token_hash` — Block 1 exit criterion ("an unsigned join observed-rejected") is met.
- **[POSITIVE]** Token generation uses `crypto.randomBytes(32).toString('base64url')` — sufficient entropy (256 bits), URL-safe, no external dependency.
- **[NOTE]** wg-alpha's members array now has 4 entries (alpha/bravo/charlie/delta from the verify test). For Block 2 to use a clean 3-node adversarial grappe, the operator should dissolve and re-form wg-alpha before Block 2 work begins. This is Block 2 setup, not a step-1.4 defect.
- **[NOTE]** `cmdStatus` updated to show `Token: provisioned / not provisioned` — honest at-a-glance view of whether the grappe is gated.

## §5 Phase-8 patches

None.

## §6 Carry-forwards to the next step

- **To 1.5 (OPERATOR-GATED):** Block 1 is now feature-complete pending the production bus cutover. The tick will BLOCK at 1.5 (visual: modality). No code carry-forwards.
- **To 2.1 (Block 2 pre-setup):** Dissolve and re-form wg-alpha with 3 members before Block 2 starts (wg-alpha currently has 4 members from the 1.4 verify test). Issue a fresh join token if needed.
- **To 4.2:** The `tokenHash()` / `{ok, reason}` rejection pattern established here is the structural model for task-envelope signing (step 4.2 uses ed25519 rather than a shared-secret hash, but the verify-on-receive → log-reason-on-reject shape is the same).
