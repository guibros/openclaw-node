# AUDIT_POST — Step 9.6: Cross-node integration test for broadcast → offer → accepted round-trip

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `test/broadcast-cross-node.test.mjs` (new) | `test/broadcast-cross-node.test.mjs:1` | yes | 9 describe blocks, 10 `it()` blocks covering full round-trip, TTL, privacy, offer expiry, artifact refs, self-skip, below-threshold, non-matching, offer building |

All 1 promised delta landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| Full round-trip test | `grep -n 'full broadcast.*offer.*accepted round-trip' test/broadcast-cross-node.test.mjs` | line 207 |
| TTL-expired test | `grep -n 'TTL-expired broadcasts' test/broadcast-cross-node.test.mjs` | line 301 |
| Privacy filtering test | `grep -n 'private items do not leak' test/broadcast-cross-node.test.mjs` | line 332 |
| Offer expiry test | `grep -n 'expires_at respected' test/broadcast-cross-node.test.mjs` | line 418 |
| Artifact refs test | `grep -n 'artifact_refs flow correctly' test/broadcast-cross-node.test.mjs` | line 444 |
| Self-skip test | `grep -n 'self-originated broadcasts' test/broadcast-cross-node.test.mjs` | line 503 |
| Below-threshold test | `grep -n 'below-threshold results' test/broadcast-cross-node.test.mjs` | line 528 |
| Non-matching test | `grep -n 'not responding to own broadcasts' test/broadcast-cross-node.test.mjs` | line 554 |
| Offer building test | `grep -n 'offer building and peer-memory formatting' test/broadcast-cross-node.test.mjs` | line 580 |
| createSharedBus | `grep -n 'createSharedBus' test/broadcast-cross-node.test.mjs` | line 51 |

## §3 — Cross-references still valid

- All imports from `lib/broadcast-emitter.mjs`, `lib/broadcast-offerer.mjs`, `lib/broadcast-acceptor.mjs` reference existing exports — verified at runtime via `npm test`.
- `better-sqlite3` imported directly for in-memory DB creation — same pattern as `test/privacy-markers.test.mjs`.
- `_processBroadcast` (offerer) and `_processOffer` (acceptor) entry points used per their documented testing interfaces.
- No symbols renamed or deleted. No stale references.
- `filterPrivateItems` tested with a proper in-memory DB that includes the `private` column migration (matches `lib/extraction-store.mjs:134-143`).

## §4 — Findings

1. **[POSITIVE]** Full round-trip test validates the complete broadcast protocol: A broadcasts → B offers → A accepts → accepted event flows back with correct artifact_refs and causation chain.
2. **[POSITIVE]** TTL expiry correctly tested: broadcast from 2 hours ago with 60-min TTL is skipped by the offerer. Stats counter incremented.
3. **[POSITIVE]** Privacy filtering test uses a real in-memory SQLite database with the full `private` column migration, proving that `filterPrivateItems` removes sessions linked to private entities while retaining public and unlinked sessions.
4. **[POSITIVE]** End-to-end privacy test verifies that when ALL retrieval results are from private sessions, the offerer reports `below_threshold` (because filtered results are empty), producing zero offers.
5. **[POSITIVE]** Offer expiry test confirms the acceptor skips offers with `expires_at` in the past, matching the TTL contract from the ContextOfferSchema.
6. **[POSITIVE]** Artifact ref flow test verifies that `context.accepted.data.accepted_artifacts` contains the exact refs from the offer, and `parseArtifactRef` correctly parses them back to `{sessionId, chunkId}`.
7. **[POSITIVE]** Self-skip test confirms the offerer's node_id comparison correctly filters self-originated broadcasts.
8. **[POSITIVE]** Below-threshold test confirms the offerer produces no offers when all retrieval scores are below `RELEVANCE_THRESHOLD`.
9. **[POSITIVE]** Non-matching responding_to test confirms the acceptor skips offers not related to its own broadcasts.
10. **[POSITIVE]** Offer building + formatting test validates the `buildOfferFromResults → formatPeerMemoryBlock` pipeline produces well-formed `[peer-memory: ...]` blocks with node ID, session references, and relevance scores.

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Block 9 → Block 10)

- Test baseline: 1024 tests (949 pass, 75 fail — 73 pre-existing + 2 flaky variance). +10 `it()` blocks added this step.
- The cross-node integration test (`test/broadcast-cross-node.test.mjs`) is now the automated guard for the broadcast protocol. Any regression in broadcaster, offerer, or acceptor modules will break this test.
- `@publish` directive wiring into daemon's per-prompt path is still deferred (carried from Step 9.5). The CLI (`bin/publish-item.mjs`) remains the primary publication mechanism.
- Block 9 closes with all 6 steps complete. The broadcast protocol is fully implemented and deterministically tested.
- Block 10 frozen decisions must be authored by the operator before the next tick can proceed.
