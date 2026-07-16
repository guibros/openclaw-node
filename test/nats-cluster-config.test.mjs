/**
 * nats-cluster-config.test.mjs — step 1.5. Proves the multi-machine cluster
 * config + replica logic is correct WITHOUT real machines (the failover itself
 * can only be proven on separate hardware; this proves the config we'd deploy).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePeers, peerToRoute, renderClusterRoutes,
  replicasForPeers, clampReplicas, resolveKvReplicas, CLUSTER_PORT,
} from '../lib/nats-cluster-config.js';

test('parsePeers: comma/space/array → clean tokens', () => {
  assert.deepEqual(parsePeers('100.64.0.2, 100.64.0.3'), ['100.64.0.2', '100.64.0.3']);
  assert.deepEqual(parsePeers('a  b\tc'), ['a', 'b', 'c']);
  assert.deepEqual(parsePeers(['x', 'y']), ['x', 'y']);
  assert.deepEqual(parsePeers(''), []);
  assert.deepEqual(parsePeers(null), []);
});

test('peerToRoute: bare host gets cluster port; explicit port preserved', () => {
  assert.equal(peerToRoute('100.64.0.2'), `nats-route://100.64.0.2:${CLUSTER_PORT}`);
  assert.equal(peerToRoute('100.64.0.2:7000'), 'nats-route://100.64.0.2:7000');
  assert.equal(peerToRoute('nats-route://10.0.1.11'), `nats-route://10.0.1.11:${CLUSTER_PORT}`);
  assert.equal(peerToRoute('[fd00::2]:6222'), 'nats-route://[fd00::2]:6222');
});

test('renderClusterRoutes: two peers → indented route lines (matches template block)', () => {
  const block = renderClusterRoutes('100.64.0.2,100.64.0.3');
  assert.equal(block, '    nats-route://100.64.0.2:6222\n    nats-route://100.64.0.3:6222');
});

test('replicasForPeers: solo→1, 2-node→2, 3-node→3, 5-node capped at 3', () => {
  assert.equal(replicasForPeers(0), 1); // no peers = solo
  assert.equal(replicasForPeers(1), 2); // self + 1
  assert.equal(replicasForPeers(2), 3); // self + 2 = the council
  assert.equal(replicasForPeers(4), 3); // capped at MAX
});

test('clampReplicas: valid range [1,5], junk → 1', () => {
  assert.equal(clampReplicas(3), 3);
  assert.equal(clampReplicas(0), 1);
  assert.equal(clampReplicas(9), 5);
  assert.equal(clampReplicas('nope'), 1);
  assert.equal(clampReplicas(undefined), 1);
});

test('resolveKvReplicas: env-driven; solo box (no env) → 1 (never crashes a lone server)', () => {
  assert.equal(resolveKvReplicas({}), 1);
  assert.equal(resolveKvReplicas({ OPENCLAW_KV_REPLICAS: '3' }), 3);
  assert.equal(resolveKvReplicas({ OPENCLAW_KV_REPLICAS: '1' }), 1);
});
