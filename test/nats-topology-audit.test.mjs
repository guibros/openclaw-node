import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNatsTopology, summarizeNatsTopology, observeNatsTopology,
  publicNatsTopologyEvidence } from '../lib/nats-topology-audit.mjs';

const ids = ['A', 'B', 'C'];
const fixture = (clustered) => ids.map((serverId, index) => ({
  routez: { server_id: serverId, routes: clustered[index].routes.map((remote_id) => ({ remote_id })) },
  jsz: { server_id: serverId, meta_cluster: clustered[index].cluster ? { name: 'cluster', leader: 'server-C',
    cluster_size: 3, replicas: index === 2 ? [
      { name: 'server-A', current: true }, { name: 'server-B', current: true },
    ] : [] } : undefined,
    streams: index + 1, consumers: 0 },
  varz: { server_id: serverId, server_name: `server-${serverId}`, port: 4222 + index,
    start: '2026-10-01T00:29:20Z' },
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
    assert.deepEqual(report.members.map((m) => m.clientPort), [4222, 4223, 4224]);
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

  it('does not call a routed but unready Raft group a three-member cluster', () => {
    const responses = fixture([
      { routes: ['B', 'C'], cluster: true },
      { routes: ['A', 'C'], cluster: true },
      { routes: ['A', 'B'], cluster: true },
    ]);
    const variants = [
      (copy) => { for (const item of copy) item.jsz.meta_cluster.cluster_size = 5; },
      (copy) => { for (const item of copy) item.jsz.meta_cluster.leader = ''; },
      (copy) => { copy[2].jsz.meta_cluster.replicas[0].current = false; },
      (copy) => { copy[2].jsz.meta_cluster.replicas[0].offline = true; },
      (copy) => { copy[2].jsz.meta_cluster.replicas[0].name = 'unrouted'; },
    ];
    for (const change of variants) {
      const copy = structuredClone(responses);
      change(copy);
      assert.equal(summarizeNatsTopology(copy).classification, 'other');
    }
  });

  it('refuses mismatched and missing monitor identity', () => {
    const responses = fixture([
      { routes: [], cluster: false },
      { routes: ['C'], cluster: true },
      { routes: ['B'], cluster: true },
    ]);
    responses[1].jsz.server_id = 'different';
    assert.equal(summarizeNatsTopology(responses).classification, 'unobservable');
    responses[1].jsz.server_id = 'B';
    responses[1].varz.port = 4222;
    assert.equal(summarizeNatsTopology(responses).classification, 'unobservable');
    assert.equal(classifyNatsTopology([{ error: 'down' }]), 'unobservable');
  });

  it('retains the offline Raft peer behind a two-route cluster', () => {
    const responses = fixture([
      { routes: [], cluster: false },
      { routes: ['C'], cluster: true },
      { routes: ['B'], cluster: true },
    ]);
    for (const item of responses.slice(1)) item.jsz.meta_cluster.cluster_size = 3;
    responses[2].jsz.meta_cluster.replicas = [
      { name: 'held-member', offline: true, current: false },
      { name: 'active-member', current: true },
    ];
    const report = summarizeNatsTopology(responses);
    assert.equal(report.classification, 'standalone-plus-two');
    assert.equal(report.members[2].clusterSize, 3);
    assert.deepEqual(report.members[2].replicas[0],
      { name: 'held-member', offline: true, current: false });
  });

  it('records a failed endpoint without turning it into a topology claim', async () => {
    const report = await observeNatsTopology(async () => { throw new Error('unreachable'); });
    assert.equal(report.classification, 'unobservable');
    assert.equal(report.members.length, 3);
    assert.ok(report.members.every((member) => member.error === 'unreachable'));
  });

  it('projects reproducible public evidence without monitor server IDs', () => {
    const responses = fixture([
      { routes: [], cluster: false },
      { routes: ['C'], cluster: true },
      { routes: ['B'], cluster: true },
    ]);
    responses[2].jsz.meta_cluster.replicas = [
      { name: 'Server name unknown at this time (peerID: hidden-peer)', offline: true, current: false },
    ];
    const report = summarizeNatsTopology(responses);
    const evidence = publicNatsTopologyEvidence(report);
    assert.deepEqual(evidence.members[1].routePeers, [8224]);
    assert.equal(evidence.members[1].serverName, 'server-B');
    assert.equal(evidence.members[1].metaLeader, 'server-C');
    assert.equal(evidence.members[1].startedAt, '2026-10-01T00:29:20Z');
    assert.equal(evidence.members[1].reportedReplicas, null);
    assert.equal(JSON.stringify(evidence).includes('"serverId"'), false);
    assert.equal(JSON.stringify(evidence).includes('hidden-peer'), false);
    assert.match(evidence.members[2].reportedReplicas[0].peerIdSha256, /^[0-9a-f]{64}$/);
  });
});
