# AUDIT_PRE — Step 10.7: Network resilience: peer-offline + reconnect + dead-peer detection + TTL cleanup

## §1 — Intent

Implement network resilience primitives for the federation protocol: peer lifecycle tracking (alive/dead detection), automatic NATS reconnect with backoff, periodic TTL cleanup of expired pending offers on the acceptor side, and a resilience test suite that validates these behaviors with real NATS servers (including SIGKILL scenarios).

## §2 — Inventory excerpt

| Block | Step | Version | Status | Description |
|-------|------|---------|--------|-------------|
| 10 | 10.7 | v10.7 | [A] | Network resilience: peer-offline + reconnect + dead-peer detection + TTL cleanup |

## §3 — Design decisions (from Step 10.6 AUDIT_POST §6)

- Test baseline: 1087 tests (1012 pass, 75 fail — 73 pre-existing + 2 flaky variance). +12 `it()` blocks added last step.
- The 3-node NATS cluster lifecycle helpers (`startNatsCluster`/`stopNatsCluster`) are self-contained in the test file. Step 10.7 may reuse the same cluster pattern with additional SIGKILL/reconnect scenarios.
- Step 10.7 needs to test: peer goes offline mid-offer (SIGKILL one nats-server), NATS reconnect handling, dead-peer detection, broadcast TTL cleanup. The cluster helpers from Step 10.6 support SIGKILL via `stopNatsServer(proc)`.
- `@publish` directive wiring into daemon per-prompt path still deferred (carried to 10.8+).
- Dist files for event-schemas still need full tsc rebuild when toolchain available (carried from Step 10.4).

Block 10 §0 frozen decisions for this step:
> **10.7** — Network resilience. Peer goes offline mid-offer (test via `nats-server` SIGKILL), NATS reconnect handling in `memory-daemon.mjs` (auto-reconnect with backoff), dead-peer detection (broadcasts to a peer that's been silent >N min get logged + ignored for offer scoring), broadcast TTL cleanup on receive side (expire pending offers whose source broadcast TTL elapsed).

## §4 — Risk register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Real NATS required for integration tests; may not be on PATH | LOW | Graceful skip when `nats-server` not on PATH — same pattern as Steps 10.5/10.6. Unit tests run without NATS. |
| 2 | NATS reconnect opts may vary by nats.js version | LOW | Use standard reconnect options from nats.js v2 API (maxReconnectAttempts, reconnectTimeWait, reconnectJitter). Already proven in codebase. |
| 3 | Peer tracker cleanup timer must not prevent Node.js exit | LOW | Use `timer.unref()` for background cleanup — same pattern as broadcaster dedup sweep. |
| 4 | Modifying daemon NATS connect call could break existing behavior | LOW | NATS reconnect options are additive; existing `natsConnectOpts` already merges extra opts via spread. |

## §5 — Deferrals

- `@publish` directive wiring into daemon per-prompt path (carried from Step 9.5 → deferred to Step 10.8+).
- Dist files for event-schemas tsc rebuild (carried from Step 10.4).
- Multi-machine resilience testing (this step tests single-machine cluster only; real multi-machine resilience is operational, not code-testable here).

## §6 — Phase 4 implementation outline

1. **`lib/federation-resilience.mjs` (new)** — Peer tracker + TTL cleanup utilities + NATS reconnect opts.
   - `DEAD_PEER_TIMEOUT_MS` constant (default 600_000 = 10 min, configurable via `DEAD_PEER_TIMEOUT_MIN` env).
   - `OFFER_CLEANUP_INTERVAL_MS` constant (default 60_000 = 1 min).
   - `createPeerTracker(opts)` factory returning `{ recordSeen(peerId), isAlive(peerId), getDeadPeers(), getPeerStatus(), cleanup(), stop() }`. Uses a `Map<peerId, lastSeenMs>`. `cleanup()` removes entries older than 2x timeout. `stop()` clears interval timer. Optional periodic auto-cleanup via `setInterval` + `unref()`.
   - `cleanupExpiredOffers(pendingOffers)` — mutating in-place filter: removes offers whose `data.expires_at` is in the past. Returns count of removed offers.
   - `NATS_RECONNECT_OPTS` constant: `{ maxReconnectAttempts: -1, reconnectTimeWait: 2000, reconnectJitter: 1000, reconnect: true }`.

2. **`lib/broadcast-offerer.mjs` (modify)** — Integrate peer tracker.
   - Accept optional `peerTracker` in `createOfferer` opts.
   - After signature verification pass (line ~250), call `peerTracker?.recordSeen(broadcastData.node_id)` to track broadcaster liveness.
   - New stat: `deadPeerLogged` — increment + log when a broadcast arrives from a peer that was previously tracked as dead (came back from the dead).

3. **`lib/broadcast-acceptor.mjs` (modify)** — Periodic TTL cleanup + dead-peer filtering in getTopOffer.
   - Accept optional `peerTracker` in `createAcceptor` opts.
   - After offer is queued (line ~221), call `peerTracker?.recordSeen(offerData.data?.offerer_node_id)`.
   - Add periodic cleanup interval (every `OFFER_CLEANUP_INTERVAL_MS`): calls `cleanupExpiredOffers(pendingOffers)` to purge expired offers. Timer is `.unref()`'d. Cleared on `stop()`.
   - New stat: `expiredCleaned` — count of offers removed by periodic cleanup.
   - In `getTopOffer()`: filter out offers from peers that `peerTracker?.isAlive()` returns false for. Log dead-peer filtering. New stat: `deadPeerFiltered`.

4. **`workspace-bin/memory-daemon.mjs` (modify)** — NATS reconnect opts + status event logging.
   - Import `NATS_RECONNECT_OPTS` from `../lib/federation-resilience.mjs`.
   - Merge reconnect opts into the `natsConnect()` call at line 1092: `natsConnectOpts({ name: 'memory-daemon', timeout: 5000, ...NATS_RECONNECT_OPTS })`.
   - Add async status iterator after NATS connect to log reconnect/disconnect/error events: `for await (const s of natsConn.status()) { log(...) }`.

5. **`test/federation-resilience.test.mjs` (new)** — Network resilience test suite with ~14 `it()` blocks.
   - Unit tests (no NATS required):
     - `createPeerTracker` records and detects alive peers
     - `createPeerTracker` detects dead peers after timeout
     - `createPeerTracker` cleanup removes stale entries
     - `cleanupExpiredOffers` removes expired offers from array
     - `cleanupExpiredOffers` keeps valid offers
     - `NATS_RECONNECT_OPTS` has expected structure
   - Integration tests (require real `nats-server`):
     - Peer goes offline mid-federation (SIGKILL one nats-server; surviving nodes continue)
     - NATS reconnect after server restart (stop + restart; connection recovers)
     - Dead-peer detection: offerer logs when dead peer broadcasts after silence
     - Acceptor periodic TTL cleanup: expired offers purged from pending queue
     - Acceptor getTopOffer filters dead-peer offers
     - Full resilience round-trip: A broadcasts, B offers, B goes offline, A detects B dead, A's pending offers from B are filtered
     - Reconnect opts are present in NATS connection (verify via nats status events)
     - SIGKILL + restart: full message flow recovers after nats-server restart
