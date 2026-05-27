# OpenClaw Memory Plan — Testing Protocol

**Date:** 2026-05-26
**Status:** v1, draft. Designed in response to the follow-up code review (see `CODE_REVIEW_2026-05-26-FOLLOWUP.md`).

This document defines the testing strategy for the OpenClaw memory infrastructure. It is **diagnostic-driven** — every section here responds to a specific failure mode the review surfaced.

---

## 1. Failure modes this protocol must catch

The follow-up review found ~70 new defects after the prior remediation round. **Most of them are not the bugs you'd find by running the existing tests.** Three repeating patterns dominate:

| Pattern | Examples | What the test suite missed |
|---|---|---|
| **Fix-at-leaf-not-wired-at-call-site** | F-N50 (`respectPrivacy` opt exists, `retrieve()` doesn't pass it); F-N100 (`signal` passed to runCycle, destructured away); F-N107 (`onIngest` optional, events ack'd into void) | Unit tests of the helper hide the integration gap |
| **Applied-to-A-but-not-B symmetry break** | F-N4 (ack/nak on offerer, not acceptor); F-N6 (loopPromise on offerer, not acceptor); F-N52 (read mention.salience, write entity.salience) | No "symmetric-modules-stay-in-sync" check |
| **Never-instantiated-in-production dead code** | F-N1 (federation factories not called from `bin/`); F-N2 (registry never built) | No "every public factory has a production caller" check |

The protocol must specifically defend against these three patterns. Conventional unit + integration testing alone has demonstrably failed to catch them.

---

## 2. Test tiers

### Tier 1 — Unit (`test/*.test.mjs`, ≤ 50 ms each)

**Purpose:** Verify a single function or small module behaves correctly in isolation.
**Allowed:** mocks, fakes, in-memory SQLite, env-var manipulation
**Forbidden:** real network, real Ollama, real NATS, real filesystem outside tmpdir
**Run:** every commit, via pre-commit hook

**Convention for auth-bypass tests:** If a unit test exercises handler logic (not the auth boundary), set `process.env.OPENCLAW_REQUIRE_SIGNED = '0'` in a `before()` hook and restore in `after()`. This is what should have been done before the sig-verify-before-schema-parse reorder. The 61 REORDER_BREAK test failures all stem from violating this.

```js
// test/broadcast-acceptor.test.mjs — example
describe('processOffer (handler logic)', () => {
  let originalEnv;
  before(() => { originalEnv = process.env.OPENCLAW_REQUIRE_SIGNED; process.env.OPENCLAW_REQUIRE_SIGNED = '0'; });
  after(() => { process.env.OPENCLAW_REQUIRE_SIGNED = originalEnv; });
  // ... tests
});
```

### Tier 2 — Auth-boundary (`test/*-auth.test.mjs`, ≤ 200 ms each)

**Purpose:** Verify the signing/verification/registry/replay code paths specifically.
**Convention:** Always run with `OPENCLAW_REQUIRE_SIGNED=1` (no override). Use the shared `test/helpers/sign-fixture.mjs` to produce signed events.

```js
// test/helpers/sign-fixture.mjs (NEW — write this)
import { signEvent, getOrCreateIdentity } from '../../lib/node-identity.mjs';

let testIdentity;
export async function getTestIdentity() {
  if (!testIdentity) testIdentity = await getOrCreateIdentity({ dir: tmpDirForTests });
  return testIdentity;
}

export async function signFixture(eventDraft, identity) {
  identity = identity || await getTestIdentity();
  return signEvent({ ...eventDraft, node_id: identity.nodeId }, identity.privateKey);
}
```

Every fixture builder (`makeOffer`, `makeBroadcast`, etc.) gets a signed variant: `makeSignedOffer(identity, opts)`. Unsigned tests use the original; auth-boundary tests use the signed variant.

### Tier 3 — Integration (`test/*-integration.test.mjs`, ≤ 5 s each)

**Purpose:** Verify two or more real modules interact correctly through real interfaces (NATS in-memory, real SQLite, real signing).
**Allowed:** real `local-event-log`, real `ollama-queue` with mocked `runFetch`
**Forbidden:** real Ollama daemon, real federation peer
**Run:** every push, via pre-push hook

**Convention for peer-trust bootstrap:** Multi-node integration tests must call `registry.trust(nodeId, pubkey)` for each peer they expect to communicate with. The 6 fed-2node/3node BUGs all stem from missing this. Provide a helper:

```js
// test/helpers/peer-trust.mjs (NEW — write this)
export function bootstrapPeerTrust(registry, ...identities) {
  for (const id of identities) registry.trust(id.nodeId, id.publicKeyBase64);
}
```

### Tier 4 — End-to-end (`test/e2e/*.test.mjs`, ≤ 60 s each)

**Purpose:** Verify the deployed-shape system actually works. Spins up a real daemon, real NATS embedded server (or `nats-server` binary), real SQLite. Mocks Ollama via a fake-Ollama HTTP server with deterministic responses.
**Run:** nightly + on release branches

**Convention for "is X actually wired" checks:** Every E2E test asserts that the production wiring path executed — not just that a module's behavior is correct. See section 4 below.

### Tier 5 — Smoke / production-shape (`test/smoke.test.mjs`, ≤ 5 min total)

**Purpose:** Tests that the daemon-as-deployed actually does what it claims. Catches "not wired" defects.
**Convention:** Each smoke test exercises a user-visible behavior end-to-end via the same entry point a user would use. If `bin/openclaw-daemon` starts the federation layer, the smoke test starts `bin/openclaw-daemon` and verifies a peer's broadcast actually reaches a peer's acceptor.

---

## 3. Mandatory test categories per change

A pull request modifying memory infrastructure must include tests in the categories that apply:

| Change touches | Must add |
|---|---|
| A new public function in `lib/` | Unit test + a citation to its production caller (or the change is reverted) |
| A new `opts.{flag}` on an existing function | Unit test for the flag's behavior + a test that the live caller in `retrieve()`/`processBroadcast()`/etc. exercises the flag with the value it should have in production |
| A fix to a Critical or High finding | A regression test named `regression_F-{ID}_*` in the matching tier |
| A change to the auth boundary | Tier 2 test under `OPENCLAW_REQUIRE_SIGNED=1` |
| A change to a module with a sibling (e.g. offerer ↔ acceptor) | Both modules tested in symmetric tests; see section 5 |
| A change to a daemon entrypoint | Tier 4 or Tier 5 test |

---

## 4. The "is it actually wired" check

**Problem:** F-N1 (federation not called from `bin/`) is invisible to any unit/integration test that constructs the factory directly.

**Solution:** A wiring manifest. `test/wiring-manifest.test.mjs` parses each daemon entrypoint and asserts every memory-critical factory is instantiated.

```js
// test/wiring-manifest.test.mjs (NEW — write this)
import { readFileSync } from 'node:fs';

const REQUIRED_PRODUCTION_WIRES = [
  { factory: 'createBroadcaster',   calledIn: 'bin/openclaw-daemon.mjs' },
  { factory: 'createOfferer',       calledIn: 'bin/openclaw-daemon.mjs' },
  { factory: 'createAcceptor',      calledIn: 'bin/openclaw-daemon.mjs' },
  { factory: 'createIdentityRegistry', calledIn: 'bin/openclaw-daemon.mjs' },
  { factory: 'createSeenEventCache',   calledIn: 'bin/openclaw-daemon.mjs' },
  { factory: 'createSubscriber',    calledIn: 'bin/memory-subscriber.mjs' },
  { factory: 'createMemoryInjector', calledIn: 'bin/memory-inject-server.mjs' },
  // … etc
];

describe('production wiring manifest', () => {
  for (const { factory, calledIn } of REQUIRED_PRODUCTION_WIRES) {
    it(`${factory} is called from ${calledIn}`, () => {
      const src = readFileSync(calledIn, 'utf8');
      assert.match(src, new RegExp(`\\b${factory}\\s*\\(`),
        `${factory} must be invoked from ${calledIn} — see F-N1`);
    });
  }
});
```

**This test would have caught F-N1, F-N2, and (when extended) F-N107.**

---

## 5. The "symmetric modules stay in sync" check

**Problem:** F-N4, F-N6 — a fix was applied to the offerer but not the acceptor. The two modules have parallel structure that's expected to evolve together.

**Solution:** Property tests over both modules. For each behavior that should exist in both, write one test parameterized over the module:

```js
// test/federation-symmetry.test.mjs (NEW — write this)
import * as offerer from '../lib/broadcast-offerer.mjs';
import * as acceptor from '../lib/broadcast-acceptor.mjs';

describe.each([
  { name: 'offerer', mod: offerer, factory: offerer.createOfferer },
  { name: 'acceptor', mod: acceptor, factory: acceptor.createAcceptor },
])('$name symmetry contract', ({ name, mod, factory }) => {
  it('rejects unsigned events with action:skip reason:bad_signature', async () => { /* ... */ });
  it('captures loopPromise and awaits it in stop()', async () => { /* ... */ });
  it('returns outcome ack/nak based on processing result, not blanket ack', async () => { /* ... */ });
  it('aborts in-flight handler within graceMs on stop()', async () => { /* ... */ });
});
```

If the acceptor lacks the loopPromise behavior tested in the offerer, the symmetry test fails. **This would have caught F-N4 and F-N6.**

---

## 6. The "leaf-fix gets wired" check

**Problem:** F-N50 (added `respectPrivacy`, retrieve never passes it); F-N100 (added `signal`, runConsolidationCycle destructures away).

**Solution:** For each opt added to a leaf function, require a "consumer test" that calls the leaf via the production entry point and asserts the opt was honored.

Pattern:

```js
// test/memory-injector-privacy-integration.test.mjs
it('F-N50: retrieve() passes respectPrivacy through to queryRelevantConcepts', async () => {
  const calls = [];
  const fakeStore = {
    /* ... */
    query: (sql, ...args) => { calls.push({ sql, args }); return []; }
  };
  const injector = createMemoryInjector({ extractionDb: fakeStore, /* ... */ });
  await injector.retrieve('test prompt');
  const conceptQuery = calls.find(c => /entities/.test(c.sql));
  assert.match(conceptQuery.sql, /AND.+private.+= 0/,
    'retrieve() must invoke queryRelevantConcepts with respectPrivacy=true');
});
```

Or, more robustly, install a spy on the helper and assert it was called with the expected opts:

```js
import { queryRelevantConcepts } from '../lib/memory-injector.mjs';
const original = queryRelevantConcepts;
let lastOpts;
queryRelevantConcepts = (db, ids, opts) => { lastOpts = opts; return original(db, ids, opts); };
await retrieve('x');
assert.equal(lastOpts?.respectPrivacy, true);
```

---

## 7. Regression test naming convention

Every Critical or High finding fixed must ship with a regression test named:

```
regression_F-{ID}_{short_desc}
```

Examples:
- `regression_F-N1_federation_wired_in_daemon` (in `test/wiring-manifest.test.mjs`)
- `regression_F-N50_retrieve_passes_respectPrivacy` (in `test/memory-injector-privacy-integration.test.mjs`)
- `regression_F-N100_hard_cap_signal_propagated` (in `test/consolidation-cancellation.test.mjs`)

The convention makes it grep-able: `grep -rn "regression_F-" test/` lists every defect we have a regression for. Audits compare this list against `memory-plan/CODE_REVIEW_*.md` to find fixes that lack tests.

---

## 8. CI gate strategy

| Stage | What runs | Where it runs | Block on failure? |
|---|---|---|---|
| Pre-commit | Modified-file unit tests + lint | Developer machine, fast (`<10s`) | Yes |
| Pre-push | Full Tier 1 + Tier 2 + wiring-manifest + symmetry tests | Developer machine (`<2 min`) | Yes |
| PR open | Tier 3 integration + full sweep | GitHub Actions Linux ARM64 (matches deploy target) | Yes |
| PR merge to main | Tier 4 E2E | GitHub Actions, on-demand | Yes |
| Nightly | Tier 5 smoke against last release tag | GitHub Actions | Reports to issue tracker; doesn't block |

**Critical rule:** The pre-push gate must include `wiring-manifest.test.mjs` and `federation-symmetry.test.mjs`. These are cheap and catch the two failure modes that cost us the most this round.

---

## 9. What to do about the existing 68 failing tests

**Apply this plan, in order:**

1. **Step 1 — Unblock the 61 unsigned-fixture failures (TRIVIAL, ~30 min).**
   Add the `before/after` env-flip pattern from section 2 to each of:
   - `test/broadcast-acceptor.test.mjs`
   - `test/broadcast-offerer.test.mjs`
   - `test/broadcast-cross-node.test.mjs`
   - `test/federation-resilience.test.mjs`
   - `test/broadcast-emitter.test.mjs`

2. **Step 2 — Fix the 1 stale-fixture failure (TRIVIAL, ~5 min).**
   `test/block3-validation.test.mjs:73` — pass `{recent: true}` to `readSessions`.

3. **Step 3 — Decide peer-trust bootstrap (BLOCKER, decision needed).**
   The 6 fed-2node/3node BUGs need a product decision (see task #8 in the task list). Either:
   - **Option A — Explicit registration:** add `bootstrapPeerTrust(registry, identityA, identityB)` to each multi-node test setup. Production deployment requires operator to run `bin/openclaw-trust-peer` on every node before it can communicate.
   - **Option B — TOFU default with strict-on-mismatch:** first sig from a node_id is trusted; later mismatches are rejected. Solves F-N3 race only if combined with operator pre-seeding.
   - **Option C — Hybrid:** TOFU for dev, strict for prod, controlled by `OPENCLAW_TRUST_MODE` env var.

   **Recommendation:** Option A. TOFU defaults are a CVE waiting to happen (see F-N3). Make operators do explicit registration via a CLI; the friction is appropriate to the security stakes.

4. **Step 4 — Write the new test scaffolding from sections 4, 5, 6.**
   `wiring-manifest.test.mjs`, `federation-symmetry.test.mjs`, `helpers/sign-fixture.mjs`, `helpers/peer-trust.mjs`. ~half a day. These permanently raise the bar for the next remediation round.

5. **Step 5 — Backfill regression tests for the 9 new CRITICALs.**
   One named `regression_F-N###_*` test per finding, attached to the PR that fixes it.

---

## 10. Coverage goals (not strict gates, but visible)

| Metric | Current (estimated) | Target |
|---|---:|---:|
| Tier 1 unit coverage of `lib/*.mjs` | ~70 % | ≥ 85 % |
| Tier 2 auth-boundary coverage of `lib/node-identity.mjs`, `broadcast-*.mjs` | ~30 % | ≥ 90 % |
| Tier 3 integration coverage of multi-module flows | minimal | ≥ 60 % |
| Tier 5 smoke coverage of "is X actually deployed" | 0 | All Block-9/10 modules covered |
| Regression test coverage of Critical+High findings | partial | 100 % of post-2026-05-26 findings |

Report via `npm run coverage` quarterly. Coverage is not a hard PR gate — focusing only on coverage % led to the gaps that bit us this round.

---

## 11. What NOT to test

This is just as important.

- **Don't test third-party library internals** (Zod, better-sqlite3, NATS client). Test the *integration boundary*.
- **Don't test private implementation details** that aren't observable. Test the contract.
- **Don't write tests that pass when production is broken** (the 61 REORDER_BREAK failures are exactly this — tests for code that no longer exists in that shape).
- **Don't test Ollama's behavior.** Mock its HTTP interface. The `test/helpers/fake-ollama.mjs` should be the single chokepoint.
- **Don't test the timing of timers in seconds.** Use a fake-clock abstraction (e.g. `node:timers/promises` controllers). Real-time tests are flaky.

---

## 12. Decisions still open

These are not part of the protocol yet; they need to be decided before they go in:

1. **Peer-trust bootstrap mode** (section 9 step 3) — Option A, B, or C?
2. **Smoke test execution environment** — local Docker, CI-only, both?
3. **Coverage tool** — `c8`, `nyc`, native `node --experimental-test-coverage`?
4. **E2E mock-Ollama fixture format** — JSON-recorded real responses vs. hand-authored synthetic responses?
5. **Wiring manifest scope** — does it cover only daemons, or also CLIs like `bin/consolidate.mjs`?

These should be answered before the protocol is ratified. They are NOT good things to defer-and-discover-later — the entire reason this protocol exists is because last round's "we'll figure out the testing story later" turned into 70 new findings.

---

## Appendix A — The single-file test-fix patch

If you want to unblock the 61 REORDER_BREAK failures TODAY without yet adopting the full protocol, add this to the top of each of the 5 affected test files:

```js
// At the very top of test/broadcast-acceptor.test.mjs (and 4 others)
process.env.OPENCLAW_REQUIRE_SIGNED = '0';
```

That's the minimum. It works because the env var is read at module-load time, before any test runs. You will lose the auth-boundary coverage those tests pretended to provide, so plan to write proper Tier-2 tests soon.

The protocol above is what to do *correctly*; this appendix is what to do *fast*.
