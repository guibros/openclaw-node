# AUDIT_PRE — Step 10.4: Node identity + ed25519 signing infrastructure (`lib/node-identity.mjs`); STRICT verification

## §1 — Intent

Implement per-node ed25519 identity keypair management and event signing/verification. Every event published to the federation layer gets signed; every incoming event on the shared stream gets verified with STRICT rejection of bad signatures. This is the cryptographic trust foundation for multi-node federation.

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.4 | v10.4 | [A] | Node identity + ed25519 signing infrastructure (`lib/node-identity.mjs`); STRICT verification |

## §3 — Design decisions (consumed from Step 10.3 AUDIT_POST §6)

- Test baseline: 1048 tests (973 pass, 75 fail — 73 pre-existing + 2 flaky variance). +11 `it()` blocks added last step.
- Shared stream verified at daemon startup. R=3 + File storage enforced.
- Step 10.4 adds `signature` + `signer_pubkey` fields to event-schemas and wires signing into `publishLocal`. The shared stream carries signed events.

Block 10 §0 frozen decisions for this step:
- Node identity = ed25519 keypair per node at `~/.openclaw/identity.key`
- Auth strictness: STRICT — reject events with bad signatures (drop silently + log warning)
- `signEvent(event, privateKey)` returns event with `signature` + `signer_pubkey` fields
- `verifyEvent(event, expectedPubkey)` returns boolean
- Wire into `local-event-log.publishLocal` (signs outgoing) and broadcast-offerer/acceptor subscribers (verifies incoming)

## §4 — Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Node.js ed25519 support varies by version | LOW | Node.js ≥16 has full ed25519 support via `crypto.generateKeyPairSync('ed25519')`. Project already requires Node.js ≥18. |
| Canonical JSON serialization for signing | LOW | Use deterministic key-sorted JSON.stringify. Exclude `signature` + `signer_pubkey` from signing payload to avoid circular dependency. |
| PEM file permissions | LOW | Set 0o600 on identity.key file. Node.js `fs.writeFileSync` with `mode` option. |
| Schema backward compatibility | LOW | Fields are optional (`.optional()`) on EventEnvelopeSchema — existing events without signatures still parse. |

## §5 — Deferrals

- Key rotation mechanism (revoke old key, issue new) — deferred to Block 11+.
- Public key distribution / trust-on-first-use registry — deferred. For now, `verifyEvent` uses the `signer_pubkey` field embedded in the event itself (self-asserted identity). Peer pubkey pinning comes with the trust infrastructure.
- The daemon's signing integration (passing identity to event log at startup) will be fully tested in Step 10.5's two-node integration test.

## §6 — Phase 4 implementation outline

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/node-identity.mjs` | new | Core identity module: `getOrCreateIdentity(identityDir?)` generates ed25519 keypair PEM at `<dir>/identity.key` if absent, returns `{ publicKey, privateKey, publicKeyBase64 }`. `signEvent(event, privateKey)` produces canonical JSON (sorted keys, excluding `signature`+`signer_pubkey`), signs with ed25519, returns event + `signature` (base64) + `signer_pubkey` (base64 raw public key). `verifyEvent(event)` extracts `signature`+`signer_pubkey`, reconstructs canonical payload, verifies. `canonicalizeEvent(event)` exported for testing. |
| 2 | `packages/event-schemas/src/envelope.ts` | modify | Add `signature: z.string().optional()` and `signer_pubkey: z.string().optional()` to `EventEnvelopeSchema`. |
| 3 | `lib/local-event-log.mjs` | modify | Accept optional `identity` parameter in `createLocalEventLog`. If provided, `publishLocal` calls `signEvent(validated, identity.privateKey)` before publishing. |
| 4 | `lib/broadcast-offerer.mjs` | modify | In `processBroadcast`, after JSON parse, call `verifyEvent(data)`. If verification fails (signature present but invalid), increment `stats.signatureRejected`, log warning, return `{ action: 'skip', reason: 'bad_signature' }`. If no signature present, allow (backward compat during migration). |
| 5 | `lib/broadcast-acceptor.mjs` | modify | In `processOffer`, after JSON parse, call `verifyEvent(data)`. Same STRICT rejection pattern as offerer. Add `signatureRejected` to stats. |
| 6 | `test/node-identity.test.mjs` | new | ~12 `it()` blocks: keypair generation (creates file, idempotent reload), public key derivation, sign+verify round-trip, tampered event rejected, missing signature allowed (backward compat), canonical JSON determinism, file permissions (0o600), `signEvent` adds both fields, `verifyEvent` returns false on wrong key, integration with `publishLocal` signing, offerer rejects bad sig, acceptor rejects bad sig. |
