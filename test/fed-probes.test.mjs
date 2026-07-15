// Step 6.3 — federation probe graders. Pure verdict logic (honesty rules):
// WORKING only on evidence, BROKEN on observed failure, OFF when inactive,
// UNKNOWN when unobservable. Never green without evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeClusterQuorum, gradeGrappeMembers, gradeSessionLiveness, gradeCoordinator, FED_STATUS } from '../lib/fed-probes.mjs';

test('cluster quorum: bus down → BROKEN (never green without evidence)', () => {
  assert.equal(gradeClusterQuorum({ jszReachable: false }).status, FED_STATUS.BROKEN);
});
test('cluster quorum: single-node bus up → WORKING with R=3 note', () => {
  const v = gradeClusterQuorum({ jszReachable: true, clusterSize: 1 });
  assert.equal(v.status, FED_STATUS.WORKING);
  assert.match(v.detail, /single-node/);
});
test('cluster quorum: R=3 with 2/3 up → WORKING; 1/3 up → BROKEN', () => {
  assert.equal(gradeClusterQuorum({ jszReachable: true, clusterSize: 3, membersUp: 2 }).status, FED_STATUS.WORKING);
  assert.equal(gradeClusterQuorum({ jszReachable: true, clusterSize: 3, membersUp: 1 }).status, FED_STATUS.BROKEN);
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
