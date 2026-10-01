import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNatsTopology, summarizeNatsTopology, observeNatsTopology } from '../lib/nats-topology-audit.mjs';

const ids = ['A', 'B', 'C'];
const fixture = (clustered) => ids.map((serverId, index) => ({
  routez: { server_id: serverId, routes: clustered[index].routes.map((remote_id) => ({ remote_id })) },
  jsz: { server_id: serverId, meta_cluster: clustered[index].cluster ? { name: 'cluster', leader: 'C' } : undefined,
    streams: index + 1, consumers: 0 },
}));

describe('NATS topology audit', () => {
  it('distinguishes a standalone writer from a separate two-member cluster', () => {
    const responses = fixture([
      { routes: [], cluster: false },
      { routes: ['C', 'C'], cluster: true },
      { routes: ['B', 'B'], cluster: true },
    ]);
    const report = summarizeNatsTopology(responses);
    assert.equal(report.classification, 'standalone-plus-two');
    assert.deepEqual(report.members.map((m) => m.routeIds), [[], ['C'], ['B']]);
    assert.deepEqual(report.members.map((m) => m.streams), [1, 2, 3]);
  });

  it('recognizes a three-member cluster only when each member routes to both others', () => {
    const responses = fixture([
      { routes: ['B', 'C'], cluster: true },
      { routes: ['A', 'C'], cluster: true },
      { routes: ['A', 'B'], cluster: true },
    ]);
    assert.equal(summarizeNatsTopology(responses).classification, 'three-member-cluster');
    responses[0].routez.routes.pop();
    assert.equal(summarizeNatsTopology(responses).classification, 'other');
  });

  it('refuses mismatched and missing monitor identity', () => {
    const responses = fixture([
      { routes: [], cluster: false },
      { routes: ['C'], cluster: true },
      { routes: ['B'], cluster: true },
    ]);
    responses[1].jsz.server_id = 'different';
    assert.equal(summarizeNatsTopology(responses).classification, 'unobservable');
    assert.equal(classifyNatsTopology([{ error: 'down' }]), 'unobservable');
  });

  it('records a failed endpoint without turning it into a topology claim', async () => {
    const report = await observeNatsTopology(async () => { throw new Error('unreachable'); });
    assert.equal(report.classification, 'unobservable');
    assert.equal(report.members.length, 3);
    assert.ok(report.members.every((member) => member.error === 'unreachable'));
  });
});
