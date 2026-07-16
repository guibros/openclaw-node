/**
 * fed-acceptance.test.mjs — step 6.4. The NODE_ACCEPTANCE `federation` axis:
 * two substrate-fitness probes (coordinator presence, bus quorum) reusing the
 * 6.3 pure graders. Verified with a mock ctx — no live node touched.
 *
 * Invariant under test: federation is on-demand, so its probes never FAIL a
 * standalone/single-node deploy — they PASS (substrate fit) or SKIP (inactive /
 * unobservable / owned by the required network axis). Only a genuinely broken
 * substrate that was expected to work (R=3 quorum LOST) survives as FAIL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildProbes, VERDICT } from '../lib/node-acceptance-probes.mjs';
import { resolveNodeConfig } from '../lib/node-acceptance.mjs';

const IS_DARWIN = process.platform === 'darwin';

// Real `jsz.meta_cluster` captured from the live 3-node cluster (2026-07-16T11:21Z),
// and the same group with quorum lost (raft can't elect a leader without a majority).
const META_HEALTHY = Object.freeze({
  name: 'openclaw-cluster', leader: 'openclaw-nats-3', peer: 'h6jWRkW8', cluster_size: 3, pending: 0,
});
const META_NO_LEADER = Object.freeze({
  name: 'openclaw-cluster', leader: '', peer: 'h6jWRkW8', cluster_size: 3, pending: 0,
});

function ctxWith(over = {}) {
  const config = resolveNodeConfig({ OPENCLAW_HOME: '/tmp/acc-fed-home', OPENCLAW_NODE_ID: 'testnode' });
  return Object.assign({
    config, runId: 'fedrun', options: { mutate: false, deep: false }, teardown: [], path,
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    httpGet: async () => ({ status: 0 }),
  }, over);
}

function fedProbe(id, over) {
  return buildProbes(ctxWith(over)).find((p) => p.id === id);
}

describe('node-acceptance federation axis (step 6.4)', () => {
  it('exposes exactly the two substrate-fitness probes on the federation axis', () => {
    const fed = buildProbes(ctxWith()).filter((p) => p.axis === 'federation');
    assert.deepEqual(fed.map((p) => p.id).sort(), ['FED-L2-COORD', 'FED-L2-QUORUM']);
    assert.ok(fed.every((p) => p.required === false), 'federation probes must be non-required (on-demand)');
  });

  it('FED-L2-COORD: coordinator loaded → PASS; absent → SKIP (worker/standalone still ACCEPTED)', async () => {
    if (!IS_DARWIN) {
      const r = await fedProbe('FED-L2-COORD').run();
      assert.equal(r.status, VERDICT.SKIP);
      assert.match(r.detail, /darwin-only/);
      return;
    }
    const loaded = await fedProbe('FED-L2-COORD', {
      exec: async () => ({ code: 0, stdout: '123\t0\tai.openclaw.mesh-task-daemon\n', stderr: '' }),
    }).run();
    assert.equal(loaded.status, VERDICT.PASS);

    const absent = await fedProbe('FED-L2-COORD', {
      exec: async () => ({ code: 0, stdout: '456\t0\tsome.other.daemon\n', stderr: '' }),
    }).run();
    assert.equal(absent.status, VERDICT.SKIP);
  });

  // These drive the probe's PARSE (jsz.json → meta_cluster) as well as the grade —
  // the combination that shipped broken. The old versions fed varz connect_urls
  // fixtures, so they passed while the live path could not see quorum loss at all.
  const jszOnly = (json) => async (url) =>
    url.includes('/jsz') ? { status: 200, json } : { status: 200, json: {} };

  it('FED-L2-QUORUM: no raft cluster (no meta_cluster) → PASS (single-node)', async () => {
    const r = await fedProbe('FED-L2-QUORUM', { httpGet: jszOnly({ streams: 1 }) }).run();
    assert.equal(r.status, VERDICT.PASS);
    assert.match(r.detail, /single-node/);
  });

  it('FED-L2-QUORUM: live 3-node meta_cluster with elected leader → PASS', async () => {
    const r = await fedProbe('FED-L2-QUORUM', { httpGet: jszOnly({ meta_cluster: META_HEALTHY }) }).run();
    assert.equal(r.status, VERDICT.PASS);
    assert.match(r.detail, /R=3 quorum held/);
  });

  it('REGRESSION FED-L2-QUORUM: R=3 with NO raft leader → FAIL (quorum loss detectable)', async () => {
    const r = await fedProbe('FED-L2-QUORUM', { httpGet: jszOnly({ meta_cluster: META_NO_LEADER }) }).run();
    assert.equal(r.status, VERDICT.FAIL, 'a leaderless R=3 group MUST fail the gate');
    assert.match(r.detail, /quorum LOST/i);
  });

  it('FED-L2-QUORUM: bus unreachable → SKIP (network axis owns bus liveness, no double-reject)', async () => {
    const r = await fedProbe('FED-L2-QUORUM', {
      httpGet: async () => ({ status: 0, error: 'ECONNREFUSED' }),
    }).run();
    assert.equal(r.status, VERDICT.SKIP);
    assert.match(r.detail, /network axis owns/);
  });

  it('FED-L2-QUORUM: jsz answers but body unparseable → SKIP (unobservable), never PASS', async () => {
    const r = await fedProbe('FED-L2-QUORUM', {
      httpGet: async (url) => (url.includes('/jsz') ? { status: 200, json: null } : { status: 200, json: {} }),
    }).run();
    assert.equal(r.status, VERDICT.SKIP);
    assert.notEqual(r.status, VERDICT.PASS);
  });
});
