// Step 6.3 — federation probe graders. Pure verdict logic (honesty rules):
// WORKING only on evidence, BROKEN on observed failure, OFF when inactive,
// UNKNOWN when unobservable. Never green without evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeClusterQuorum, gradeGrappeMembers, gradeSessionLiveness, gradeCoordinator, toMemberHealth, FED_STATUS } from '../lib/fed-probes.mjs';

// Real `jsz.meta_cluster`, captured verbatim from the live 3-node cluster
// (curl :8222/jsz, 2026-07-16T11:21Z). Tests feed the SHAPE production emits —
// the previous tests fed the grader synthetic {clusterSize, membersUp} numbers,
// so they stayed green while the varz parse that produced them lied.
const META_HEALTHY = Object.freeze({
  name: 'openclaw-cluster', leader: 'openclaw-nats-3', peer: 'h6jWRkW8',
  cluster_size: 3, pending: 0,
});
// The same cluster with quorum lost: raft cannot elect a leader without a majority,
// so `leader` goes empty. THIS is the case the old connect_urls math could not see.
const META_NO_LEADER = Object.freeze({
  name: 'openclaw-cluster', leader: '', peer: 'h6jWRkW8', cluster_size: 3, pending: 0,
});

test('cluster quorum: bus down → BROKEN (never green without evidence)', () => {
  assert.equal(gradeClusterQuorum({ jszReachable: false }).status, FED_STATUS.BROKEN);
});
test('cluster quorum: no raft cluster (no meta_cluster) → WORKING single-node', () => {
  const v = gradeClusterQuorum({ jszReachable: true, metaCluster: null });
  assert.equal(v.status, FED_STATUS.WORKING);
  assert.match(v.detail, /single-node/);
});
test('cluster quorum: live 3-node meta_cluster with elected leader → WORKING', () => {
  const v = gradeClusterQuorum({ jszReachable: true, metaCluster: META_HEALTHY });
  assert.equal(v.status, FED_STATUS.WORKING);
  assert.match(v.detail, /R=3 quorum held/);
  assert.match(v.detail, /openclaw-nats-3/);
});
test('REGRESSION: R=3 with NO raft leader → BROKEN (quorum loss must be detectable)', () => {
  // The bug this replaces: membersUp = 1 + min(routes, connect_urls.length) counted
  // self twice, so both-peers-dead graded WORKING "quorum held 2/3". Never again.
  const v = gradeClusterQuorum({ jszReachable: true, metaCluster: META_NO_LEADER });
  assert.equal(v.status, FED_STATUS.BROKEN, 'no leader on an R=3 group MUST grade BROKEN');
  assert.match(v.detail, /quorum LOST/i);
});
test('cluster quorum: jsz answered but unparseable → UNKNOWN, never green', () => {
  assert.equal(gradeClusterQuorum({ jszReachable: true, jszParsed: false }).status, FED_STATUS.UNKNOWN);
});

// A real MESH_NODE_HEALTH row, captured verbatim from the live bucket
// (2026-07-16T11:21Z). The publisher writes `nodeId` + `reportedAt` — NOT
// `node_id`/`timestamp`/`updated_at`, which is what the probe used to read.
const REAL_HEALTH_ROW = Object.freeze({
  key: 'moltymacs-virtual-machine',
  value: Object.freeze({
    nodeId: 'moltymacs-virtual-machine', platform: 'darwin', role: 'lead',
    reportedAt: '2026-07-16T11:21:12.758Z',
  }),
});

test('REGRESSION: toMemberHealth reads the REAL heartbeat shape (nodeId/reportedAt)', () => {
  const m = toMemberHealth([REAL_HEALTH_ROW]);
  // The bug: reading timestamp/updated_at yielded {} — every member "never seen"
  // ⇒ stale ⇒ BROKEN was the only reachable verdict for a live grappe.
  assert.deepEqual(Object.keys(m), ['moltymacs-virtual-machine']);
  assert.equal(m['moltymacs-virtual-machine'], Date.parse('2026-07-16T11:21:12.758Z'));
});

test('REGRESSION: a live grappe whose members are heartbeating grades WORKING', () => {
  // Proves the WORKING branch is REACHABLE against production data (it was not).
  const now = Date.parse('2026-07-16T11:21:30.000Z');
  const memberHealth = toMemberHealth([REAL_HEALTH_ROW]);
  const grappes = [{ id: 'wg-alpha', members: ['moltymacs-virtual-machine'] }];
  const v = gradeGrappeMembers({ grappes, memberHealth, now, freshMs: 90_000 });
  assert.equal(v.status, FED_STATUS.WORKING);
});

test('toMemberHealth: tolerant fallbacks + junk timestamps dropped', () => {
  assert.deepEqual(toMemberHealth([{ key: 'x', value: { node_id: 'x', timestamp: '2026-07-16T11:00:00Z' } }]), { x: Date.parse('2026-07-16T11:00:00Z') });
  assert.deepEqual(toMemberHealth([{ key: 'y', value: { nodeId: 'y', reportedAt: 'not-a-date' } }]), {});
  assert.deepEqual(toMemberHealth([]), {});
});

test('grappe members: no grappe → OFF (intentionally inactive, not green)', () => {
  assert.equal(gradeGrappeMembers({ grappes: [], now: Date.now() }).status, FED_STATUS.OFF);
});
test('grappe members: registry unreadable → UNKNOWN', () => {
  assert.equal(gradeGrappeMembers({ grappes: null, now: Date.now() }).status, FED_STATUS.UNKNOWN);
});
test('grappe members: all fresh → WORKING; stale member → BROKEN', () => {
  const now = 1_000_000;
  const grappes = [{ id: 'wg-alpha', members: ['a', 'b', 'c'] }];
  const fresh = { a: now - 1000, b: now - 2000, c: now - 3000 };
  assert.equal(gradeGrappeMembers({ grappes, memberHealth: fresh, now, freshMs: 90000 }).status, FED_STATUS.WORKING);
  const stale = { a: now - 1000, b: now - 200000, c: now - 3000 };
  const v = gradeGrappeMembers({ grappes, memberHealth: stale, now, freshMs: 90000 });
  assert.equal(v.status, FED_STATUS.BROKEN);
  assert.match(v.detail, /wg-alpha\/b/);
});

test('session liveness: none active → OFF; active advancing → WORKING; stalled → BROKEN', () => {
  const now = 10_000_000;
  assert.equal(gradeSessionLiveness({ sessions: [{ status: 'completed' }], now }).status, FED_STATUS.OFF);
  assert.equal(gradeSessionLiveness({ sessions: [{ status: 'active', lastActivityMs: now - 1000 }], now }).status, FED_STATUS.WORKING);
  assert.equal(gradeSessionLiveness({ sessions: [{ status: 'active', lastActivityMs: now - 20 * 60000 }], now }).status, FED_STATUS.BROKEN);
});
test('session liveness: KV unreadable → UNKNOWN', () => {
  assert.equal(gradeSessionLiveness({ sessions: null, now: Date.now() }).status, FED_STATUS.UNKNOWN);
});

test('coordinator: loaded → WORKING; absent → OFF', () => {
  assert.equal(gradeCoordinator({ loaded: true }).status, FED_STATUS.WORKING);
  assert.equal(gradeCoordinator({ loaded: false }).status, FED_STATUS.OFF);
});
