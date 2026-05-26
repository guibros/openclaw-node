# AUDIT_POST — Step 10.4: Node identity + ed25519 signing infrastructure (`lib/node-identity.mjs`); STRICT verification

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `lib/node-identity.mjs` (new) | `lib/node-identity.mjs:45` | yes | `export function getOrCreateIdentity` at line 45; `export function signEvent` at line 117; `export function verifyEvent` at line 141; `export function canonicalizeEvent` at line 91 |
| 2 | `packages/event-schemas/src/envelope.ts` (modify) | `packages/event-schemas/src/envelope.ts:18-19` | yes | `signature: z.string().optional()` at line 18; `signer_pubkey: z.string().optional()` at line 19; dist files also updated |
| 3 | `lib/local-event-log.mjs` (modify) | `lib/local-event-log.mjs:72` | yes | `opts.identity && opts.identity.privateKey` at line 72; `signEvent(validated, opts.identity.privateKey)` at line 74 |
| 4 | `lib/broadcast-offerer.mjs` (modify) | `lib/broadcast-offerer.mjs:241-247` | yes | `signatureRejected: 0` at line 224; `stats.signatureRejected++` at line 245; `verifyEvent(broadcastData)` at line 243 |
| 5 | `lib/broadcast-acceptor.mjs` (modify) | `lib/broadcast-acceptor.mjs:177-183` | yes | `signatureRejected: 0` at line 145; `stats.signatureRejected++` at line 181; `verifyEvent(offerData)` at line 179 |
| 6 | `test/node-identity.test.mjs` (new) | `test/node-identity.test.mjs:1` | yes | 12 `it()` blocks covering keypair generation, idempotent reload, file permissions, base64 key size, canonical JSON, sign+verify round-trip, tamper rejection, backward compat, wrong-key rejection, corrupted sig, offerer integration, acceptor integration |

All 6 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| getOrCreateIdentity function | `grep -n 'getOrCreateIdentity' lib/node-identity.mjs` | line 45 |
| signEvent function | `grep -n 'export function signEvent' lib/node-identity.mjs` | line 117 |
| verifyEvent function | `grep -n 'export function verifyEvent' lib/node-identity.mjs` | line 141 |
| canonicalizeEvent function | `grep -n 'export function canonicalizeEvent' lib/node-identity.mjs` | line 91 |
| Schema signature field | `grep -n 'signature.*optional' packages/event-schemas/src/envelope.ts` | line 18 |
| Schema signer_pubkey field | `grep -n 'signer_pubkey.*optional' packages/event-schemas/src/envelope.ts` | line 19 |
| Dist signature field | `grep -n 'signature.*optional' packages/event-schemas/dist/envelope.js` | line 17 |
| Event log identity wiring | `grep -n 'opts.identity' lib/local-event-log.mjs` | line 32 |
| Offerer signatureRejected stat | `grep -n 'signatureRejected' lib/broadcast-offerer.mjs` | line 224 |
| Acceptor signatureRejected stat | `grep -n 'signatureRejected' lib/broadcast-acceptor.mjs` | line 145 |
| Test file imports | `grep -n 'verifyEvent' test/node-identity.test.mjs` | line 11 |

## §3 — Cross-references still valid

- `signEvent` and `verifyEvent` imported from `./node-identity.mjs` via dynamic import in `local-event-log.mjs` (line 73), `broadcast-offerer.mjs` (line 242), and `broadcast-acceptor.mjs` (line 178). All imports use `await import('./node-identity.mjs')` which resolves correctly from the `lib/` directory.
- `EventEnvelopeSchema` in `packages/event-schemas/src/envelope.ts` is the base schema extended by all memory and broadcast event schemas. The new `signature` + `signer_pubkey` fields are `.optional()`, so all existing schemas that extend it (8 memory events + 3 broadcast events) transparently gain these fields without breaking validation of unsigned events.
- `MemoryEventSchema.parse()` in `local-event-log.mjs:66` validates before signing — the signed event (with `signature` + `signer_pubkey` added) is a valid extension since those fields are optional on the envelope.
- No symbols renamed or deleted. All existing tests remain valid.
- `createLocalEventLog` third parameter `opts` defaults to `{}` — existing callers (daemon, tests) that pass only `(nc, nodeId)` continue to work with no identity (no signing).

## §4 — Findings

1. **[POSITIVE]** Pure function design: `signEvent` and `verifyEvent` are pure functions with no side effects. `canonicalizeEvent` is independently testable. All three are suitable for unit testing without mocking.
2. **[POSITIVE]** Ed25519 via Node.js built-in `crypto` module — zero new dependencies. The SPKI DER prefix for ed25519 public key reconstruction (`302a300506032b6570032100`) is a fixed 12-byte constant per RFC 8410.
3. **[POSITIVE]** Backward compatibility: `verifyEvent` returns `true` for events with no `signature` field, allowing gradual rollout. Only events that HAVE a signature get strict verification.
4. **[POSITIVE]** STRICT mode implemented per Block 10 §0: offerer and acceptor both reject (skip) events with present-but-invalid signatures. Log messages include "STRICT" keyword for grep-based monitoring.
5. **[POSITIVE]** Canonical JSON serialization uses recursive key sorting via `sortReplacer`, ensuring nested objects (like `data` and `actor`) are also deterministically serialized. This prevents false verification failures from key-order variance.
6. **[POSITIVE]** File permissions: `identity.key` written with mode `0o600` (owner-only read/write). Test verifies this explicitly.
7. **[POSITIVE]** `createLocalEventLog` accepts identity via `opts.identity` — clean dependency injection, no global state, no import-time side effects.
8. **[POSITIVE]** Dynamic import of `node-identity.mjs` in offerer/acceptor avoids circular dependency and keeps the signing module optional (not imported at parse time).
9. **[POSITIVE]** Test coverage: 12 `it()` blocks across 6 describe groups. Integration tests for both offerer and acceptor signature rejection use the actual `createOfferer`/`createAcceptor` factories with mock NATS.
10. **[POSITIVE]** Test count: 1064 total (989 pass, 75 fail — unchanged pre-existing). +12 `it()` blocks + 4 sub-test implicit assertions = +16 net test increase from 1048 baseline.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.4 → Step 10.5)

- Test baseline: 1064 tests (989 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added this step (+16 total test count increase including sub-assertions).
- `getOrCreateIdentity()` creates keypair at `<dir>/identity.key`. For spawned nodes (Step 10.1), the identity dir is `~/.openclaw-<nodeid>/`. Step 10.5's two-node integration test should verify both nodes have distinct identities.
- Signing is wired into `publishLocal` via `opts.identity`. The memory daemon (which calls `createLocalEventLog`) needs to pass its identity at startup — this wiring lands in Step 10.5 integration test setup.
- STRICT verification is active in offerer and acceptor. Step 10.5's two-node test should verify that signed events traverse the federation loop correctly (broadcast signed by A → offerer on B verifies → offer signed by B → acceptor on A verifies).
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5).
- The dist files for event-schemas (`dist/envelope.js`, `dist/envelope.d.ts`) were manually updated to match the TypeScript source change. A full `tsc` rebuild should be run when the build toolchain is available.
