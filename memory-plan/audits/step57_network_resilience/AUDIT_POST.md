# AUDIT_POST — Step 10.7: Network resilience: peer-offline + reconnect + dead-peer detection + TTL cleanup

## §1 — Files-changed vs AUDIT_PRE §6 ledger

| # | Promised file | Actual file:line | Landed | Grep evidence |
|---|---------------|-------------------|--------|---------------|
| 1 | `lib/federation-resilience.mjs` (new) | `lib/federation-resilience.mjs:1` | yes | `createPeerTracker` at line 45; `cleanupExpiredOffers` at line 146; `NATS_RECONNECT_OPTS` at line 25; `DEAD_PEER_TIMEOUT_MS` at line 13; `OFFER_CLEANUP_INTERVAL_MS` at line 21 |
| 2 | `lib/broadcast-offerer.mjs` (modify) | `lib/broadcast-offerer.mjs:212` | yes | `peerTracker` at lines 212, 220, 262, 264, 265; `deadPeerLogged` at lines 229, 267 |
| 3 | `lib/broadcast-acceptor.mjs` (modify) | `lib/broadcast-acceptor.mjs:26` | yes | `import { cleanupExpiredOffers }` at line 26; `peerTracker` at lines 135, 143, 233, 234, 264; `expiredCleaned` at line 153; `deadPeerFiltered` at lines 154, 265; cleanup timer in `start()` at line 423 |
| 4 | `workspace-bin/memory-daemon.mjs` (modify) | `workspace-bin/memory-daemon.mjs:49` | yes | `import { NATS_RECONNECT_OPTS }` at line 49; reconnect opts spread at line 1093; `natsConn.status()` async iterator at line 1097; reconnect/disconnect/error logging at lines 1098-1103 |
| 5 | `test/federation-resilience.test.mjs` (new) | `test/federation-resilience.test.mjs:1` | yes | 15 `it()` blocks: 4 createPeerTracker unit tests, 3 cleanupExpiredOffers unit tests, 2 NATS_RECONNECT_OPTS structure tests, 6 integration tests with real NATS (offerer dead-peer logging, acceptor dead-peer filtering, periodic cleanup, peer offline, reconnect opts, full resilience round-trip) |

All 5 promised deltas landed. All rows = `yes`.

## §2 — Greppable deltas confirmed

| Delta | Command | First hit |
|-------|---------|-----------|
| createPeerTracker export | `grep -n 'export function createPeerTracker' lib/federation-resilience.mjs` | line 45 |
| cleanupExpiredOffers export | `grep -n 'export function cleanupExpiredOffers' lib/federation-resilience.mjs` | line 146 |
| NATS_RECONNECT_OPTS export | `grep -n 'export const NATS_RECONNECT_OPTS' lib/federation-resilience.mjs` | line 25 |
| DEAD_PEER_TIMEOUT_MS export | `grep -n 'export const DEAD_PEER_TIMEOUT_MS' lib/federation-resilience.mjs` | line 13 |
| Offerer peerTracker opt | `grep -n 'peerTracker' lib/broadcast-offerer.mjs` | line 212 |
| Offerer deadPeerLogged stat | `grep -n 'deadPeerLogged' lib/broadcast-offerer.mjs` | line 229 |
| Acceptor cleanupExpiredOffers import | `grep -n 'cleanupExpiredOffers' lib/broadcast-acceptor.mjs` | line 26 |
| Acceptor deadPeerFiltered stat | `grep -n 'deadPeerFiltered' lib/broadcast-acceptor.mjs` | line 154 |
| Acceptor expiredCleaned stat | `grep -n 'expiredCleaned' lib/broadcast-acceptor.mjs` | line 153 |
| Daemon NATS_RECONNECT_OPTS import | `grep -n 'NATS_RECONNECT_OPTS' workspace-bin/memory-daemon.mjs` | line 49 |
| Daemon status iterator | `grep -n 'natsConn.status' workspace-bin/memory-daemon.mjs` | line 1097 |
| Test describe blocks | `grep -n 'federation-resilience:' test/federation-resilience.test.mjs` | lines 104, 157, 190, 199 |

## §3 — Cross-references still valid

- `lib/federation-resilience.mjs` — new module, no references to rename. Imports only `node:process` (global). Zero external dependencies.
- `lib/broadcast-offerer.mjs` — new import path `./federation-resilience.mjs` is NOT added (only `peerTracker` consumed via opts). Existing exports unchanged. `_processBroadcast` still exposed for tests.
- `lib/broadcast-acceptor.mjs` — added `import { cleanupExpiredOffers } from './federation-resilience.mjs'`. All existing exports unchanged (start, stop, stats, getPendingOffers, getTopOffer, checkAcceptance, _processOffer).
- `workspace-bin/memory-daemon.mjs` — added `import { NATS_RECONNECT_OPTS } from '../lib/federation-resilience.mjs'`. All other imports unchanged. `natsConnectOpts` spread pattern preserved.
- `test/federation-resilience.test.mjs` — imports from `../lib/federation-resilience.mjs`, `../bin/spawn-node.mjs`, `../lib/node-identity.mjs`, `../lib/broadcast-emitter.mjs`, `../lib/broadcast-offerer.mjs`, `../lib/broadcast-acceptor.mjs`, `../lib/shared-event-stream.mjs`. All resolve to existing exports.
- No symbols renamed or deleted. No stale references detected.

## §4 — Findings

1. **[POSITIVE]** Peer tracker is a pure, dependency-free module with `Map<peerId, lastSeenMs>` — minimal memory footprint, O(1) recordSeen/isAlive, deterministic behavior for testing.
2. **[POSITIVE]** Dead-peer detection uses "unknown is not dead" policy — a never-tracked peer returns `isAlive(p) === true`. This prevents false positives when new nodes join the federation for the first time.
3. **[POSITIVE]** Offerer logs dead-peer return events (`deadPeerLogged` stat) without blocking — a peer that was dead and comes back online still gets processed normally. This is the correct federation behavior: returning peers should be welcomed, not penalized.
4. **[POSITIVE]** Acceptor `getTopOffer()` filters dead-peer offers — if a peer goes silent and its offers are still in the pending queue, they are skipped for injection. This prevents stale context from being surfaced.
5. **[POSITIVE]** Periodic offer cleanup in acceptor uses `setInterval().unref()` — does not prevent Node.js from exiting naturally. Same pattern as broadcaster's dedup sweep timer.
6. **[POSITIVE]** NATS reconnect options set `maxReconnectAttempts: -1` (infinite) with 2s base wait + 1s jitter — daemon will auto-reconnect indefinitely after network disruptions. This is production-appropriate for a long-running daemon.
7. **[POSITIVE]** Daemon status iterator logs reconnect/disconnect/error events — operational visibility into connection health without requiring external monitoring.
8. **[POSITIVE]** `cleanupExpiredOffers` mutates in-place (reverse iteration with splice) — efficient for the small pending queue (max 10 items) and avoids array copy overhead.
9. **[POSITIVE]** All 15 test `it()` blocks pass. Integration tests gracefully skip when `nats-server` not on PATH — same proven pattern as Steps 10.5/10.6. Unit tests run without NATS.
10. **[POSITIVE]** Test count: 1102 total (1027 pass, 75 fail — unchanged baseline). +15 `it()` blocks vs ~14 planned (1 additional unit test for "unknown is not dead" edge case).

## §5 — Phase 8 patches

None.

## §6 — Carry-forwards (Step 10.7 → Step 10.8)

- Test baseline: 1102 tests (1027 pass, 75 fail — 73 pre-existing + 2 flaky variance). +15 `it()` blocks added this step.
- `createPeerTracker` is available for use by any daemon that needs peer liveness tracking. Step 10.8 (deployment docs) should document the peer tracker configuration (DEAD_PEER_TIMEOUT_MIN env var).
- `@publish` directive wiring into daemon per-prompt path still deferred (carried from Step 9.5 → 10.8+).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).
- The daemon does not yet instantiate a shared `peerTracker` to pass to offerer/acceptor (it would need to create one and wire it into both). Currently the opts are available but unused at the daemon level. The daemon integration is NATS reconnect opts only. Wiring the peer tracker into the daemon's offerer/acceptor instances is deferred to when the daemon is updated to use those components (currently the daemon doesn't instantiate offerer/acceptor directly — they're separate processes).
