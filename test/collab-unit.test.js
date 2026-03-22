#!/usr/bin/env node

/**
 * collab-unit.test.js — Pure unit tests for mesh-collab.js.
 *
 * No NATS required. Mocks the 'nats' module, uses a mock KV to test
 * CollabStore logic directly. Covers bugs that existed before patching:
 *
 *   Bug 1: isRoundComplete() must exclude dead nodes
 *   Bug 2: advanceTurn() must work, sequential mode must not deadlock
 *   Convergence: quorum, parse failures, majority, unanimous
 *
 * Run: node --test test/collab-unit.test.js
 */

// ── Mock 'nats' module before any require that depends on it ──
// nats may not be installed locally (lives in ~/openclaw/node_modules).
// We mock it so these unit tests run without external deps.
const Module = require('module');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const mockNats = {
  StringCodec: () => ({
    encode: (str) => encoder.encode(str),
    decode: (buf) => decoder.decode(buf),
  }),
  connect: async () => ({}),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'nats') return 'nats'; // fake path
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['nats'] = {
  id: 'nats', filename: 'nats', loaded: true, exports: mockNats,
};

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSession,
  CollabStore,
  COLLAB_STATUS,
  COLLAB_MODE,
} = require('../lib/mesh-collab');

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() {
    const iter = this.store.keys();
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            const r = iter.next();
            return Promise.resolve(r);
          },
        };
      },
    };
  }
}

function makeStore() {
  return new CollabStore(new MockKV());
}

// Helper: create a session, add nodes, start round 1
async function setupActiveSession(store, opts = {}) {
  const mode = opts.mode || 'parallel';
  const session = createSession('task-1', {
    mode,
    min_nodes: opts.min_nodes || 2,
    max_nodes: opts.max_nodes || 2,
    join_window_s: 60,
    max_rounds: opts.max_rounds || 3,
    convergence: {
      type: opts.convergence_type || 'unanimous',
      threshold: opts.threshold || 0.66,
      min_quorum: opts.min_quorum || opts.min_nodes || 2,
    },
    scope_strategy: 'shared',
  });
  await store.put(session);
  const nodeIds = opts.nodes || ['node-A', 'node-B'];
  for (const nid of nodeIds) {
    await store.addNode(session.session_id, nid);
  }
  await store.startRound(session.session_id);
  return session.session_id;
}

// ════════════════════════════════════════════════════
// BUG 1: isRoundComplete() with dead nodes
// ════════════════════════════════════════════════════

describe('isRoundComplete — dead node exclusion', () => {
  it('returns false when live nodes have not all reflected', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    const session = await store.get(sid);
    assert.equal(store.isRoundComplete(session), false);
  });

  it('returns true when all live nodes have reflected', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'node-B', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    const session = await store.get(sid);
    assert.equal(store.isRoundComplete(session), true);
  });

  it('returns true when dead node is excluded and remaining nodes reflected', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, { nodes: ['node-A', 'node-B', 'node-C'], min_nodes: 2, max_nodes: 3 });

    // Mark node-C as dead (simulates stall detection)
    await store.setNodeStatus(sid, 'node-C', 'dead');

    // Only A and B reflect
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'node-B', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });

    const session = await store.get(sid);
    assert.equal(store.isRoundComplete(session), true, 'Round should be complete: dead node excluded');
  });

  it('returns false when dead node excluded but remaining nodes have NOT all reflected', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, { nodes: ['node-A', 'node-B', 'node-C'], min_nodes: 2, max_nodes: 3 });
    await store.setNodeStatus(sid, 'node-C', 'dead');
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    // node-B has NOT reflected
    const session = await store.get(sid);
    assert.equal(store.isRoundComplete(session), false);
  });

  it('all nodes dead → round complete (0 active = 0 reflections needed)', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.setNodeStatus(sid, 'node-A', 'dead');
    await store.setNodeStatus(sid, 'node-B', 'dead');
    const session = await store.get(sid);
    // 0 reflections >= 0 active nodes = true (degenerate case, daemon should abort)
    assert.equal(store.isRoundComplete(session), true);
  });
});

// ════════════════════════════════════════════════════
// BUG 2: Sequential mode — advanceTurn
// ════════════════════════════════════════════════════

describe('advanceTurn — sequential mode', () => {
  it('advances from first to second node', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, { mode: 'sequential', nodes: ['node-A', 'node-B', 'node-C'], min_nodes: 3, max_nodes: 3 });

    const session = await store.get(sid);
    assert.equal(session.current_turn, 'node-A', 'First turn should be node-A');

    const next = await store.advanceTurn(sid);
    assert.equal(next, 'node-B');

    const updated = await store.get(sid);
    assert.equal(updated.current_turn, 'node-B');
  });

  it('advances through all nodes then returns null', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, { mode: 'sequential', nodes: ['node-A', 'node-B'], min_nodes: 2, max_nodes: 2 });

    const second = await store.advanceTurn(sid);
    assert.equal(second, 'node-B');

    const done = await store.advanceTurn(sid);
    assert.equal(done, null, 'Should return null after all turns');

    const session = await store.get(sid);
    assert.equal(session.current_turn, null);
  });

  it('returns null for parallel mode', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, { mode: 'parallel' });
    const result = await store.advanceTurn(sid);
    assert.equal(result, null, 'advanceTurn should return null for parallel mode');
  });

  it('single-node sequential: first turn then null', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, { mode: 'sequential', nodes: ['solo-node'], min_nodes: 1, max_nodes: 1 });

    const session = await store.get(sid);
    assert.equal(session.current_turn, 'solo-node');

    const done = await store.advanceTurn(sid);
    assert.equal(done, null);
  });
});

// ════════════════════════════════════════════════════
// BUG 2 continued: Sequential mode — full turn cycle
// ════════════════════════════════════════════════════

describe('Sequential mode — full round lifecycle', () => {
  it('each node reflects in turn order, round completes after all turns', async () => {
    const store = makeStore();
    const nodes = ['seq-A', 'seq-B', 'seq-C'];
    const sid = await setupActiveSession(store, {
      mode: 'sequential',
      nodes,
      min_nodes: 3,
      max_nodes: 3,
    });

    let session = await store.get(sid);
    assert.equal(session.current_turn, 'seq-A');

    // seq-A reflects
    await store.submitReflection(sid, { node_id: 'seq-A', summary: 'A done', vote: 'converged', confidence: 0.9, artifacts: [] });
    const nextB = await store.advanceTurn(sid);
    assert.equal(nextB, 'seq-B');

    // seq-B reflects
    await store.submitReflection(sid, { node_id: 'seq-B', summary: 'B done', vote: 'converged', confidence: 0.8, artifacts: [] });
    const nextC = await store.advanceTurn(sid);
    assert.equal(nextC, 'seq-C');

    // seq-C reflects
    await store.submitReflection(sid, { node_id: 'seq-C', summary: 'C done', vote: 'converged', confidence: 0.85, artifacts: [] });
    const done = await store.advanceTurn(sid);
    assert.equal(done, null, 'All turns done');

    // Now isRoundComplete should be true (all 3 reflected)
    session = await store.get(sid);
    assert.equal(store.isRoundComplete(session), true);
    assert.equal(store.checkConvergence(session), true, 'All voted converged → unanimous');
  });

  it('sequential mode with dead node: dead node turn is skipped via turn_order pruning on next round', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, {
      mode: 'sequential',
      nodes: ['seq-A', 'seq-B', 'seq-C'],
      min_nodes: 2,
      max_nodes: 3,
    });

    // Mark seq-B as dead before it gets its turn
    await store.setNodeStatus(sid, 'seq-B', 'dead');

    // seq-A reflects
    await store.submitReflection(sid, { node_id: 'seq-A', summary: 'A done', vote: 'continue', confidence: 0.5, artifacts: [] });

    // advanceTurn goes to seq-B (still in turn_order — dead nodes pruned at startRound, not mid-round)
    const nextB = await store.advanceTurn(sid);
    assert.equal(nextB, 'seq-B', 'Dead node still in turn order mid-round');

    // But seq-B can't reflect (it's dead). In the daemon, this would be handled by
    // stall detection marking it dead and re-evaluating. For the next round,
    // startRound prunes dead nodes from turn_order.

    // Simulate: skip to seq-C
    const nextC = await store.advanceTurn(sid);
    assert.equal(nextC, 'seq-C');

    // seq-C reflects
    await store.submitReflection(sid, { node_id: 'seq-C', summary: 'C done', vote: 'continue', confidence: 0.5, artifacts: [] });
    const roundDone = await store.advanceTurn(sid);
    assert.equal(roundDone, null);

    // Start round 2 — dead nodes should be pruned
    const round2 = await store.startRound(sid);
    assert.ok(round2, 'Round 2 should start (2 alive >= min_nodes 2)');

    const session = await store.get(sid);
    assert.equal(session.nodes.length, 2, 'Dead node pruned');
    assert.equal(session.turn_order.length, 2);
    assert.ok(!session.turn_order.includes('seq-B'), 'seq-B should be removed from turn order');
    assert.equal(session.current_turn, 'seq-A', 'First turn should be seq-A again');
  });
});

// ════════════════════════════════════════════════════
// CONVERGENCE — quorum, parse failures, edge cases
// ════════════════════════════════════════════════════

describe('checkConvergence — edge cases', () => {
  it('unanimous: all converged → true', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'node-B', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    const session = await store.get(sid);
    assert.equal(store.checkConvergence(session), true);
  });

  it('unanimous: one continue → false', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'node-B', summary: 'not yet', vote: 'continue', confidence: 0.3, artifacts: [] });
    const session = await store.get(sid);
    assert.equal(store.checkConvergence(session), false);
  });

  it('unanimous: parse_failed blocks convergence', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'node-B', summary: 'garbled', vote: 'converged', confidence: 0.5, artifacts: [], parse_failed: true });
    const session = await store.get(sid);
    assert.equal(store.checkConvergence(session), false, 'Parse failure should block unanimous');
  });

  it('majority: 2/3 converged at 0.66 threshold → true', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, {
      nodes: ['A', 'B', 'C'],
      min_nodes: 3,
      max_nodes: 3,
      convergence_type: 'majority',
      threshold: 0.66,
      min_quorum: 2,
    });
    await store.submitReflection(sid, { node_id: 'A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'B', summary: 'done', vote: 'converged', confidence: 0.8, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'C', summary: 'nah', vote: 'continue', confidence: 0.3, artifacts: [] });
    const session = await store.get(sid);
    assert.equal(store.checkConvergence(session), true);
  });

  it('majority: below quorum → false even if 100% of votes are converged', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, {
      nodes: ['A', 'B', 'C'],
      min_nodes: 3,
      max_nodes: 3,
      convergence_type: 'majority',
      threshold: 0.66,
      min_quorum: 3,
    });
    // Only 1 reflection submitted (quorum is 3)
    await store.submitReflection(sid, { node_id: 'A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    const session = await store.get(sid);
    assert.equal(store.checkConvergence(session), false, 'Below min_quorum');
  });

  it('no reflections → false', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    const session = await store.get(sid);
    assert.equal(store.checkConvergence(session), false);
  });
});

// ════════════════════════════════════════════════════
// createSession — validates default construction
// ════════════════════════════════════════════════════

describe('createSession — defaults and structure', () => {
  it('creates session with correct defaults', () => {
    const session = createSession('task-42', {
      mode: 'parallel',
      min_nodes: 2,
      max_nodes: 4,
      join_window_s: 30,
      max_rounds: 5,
      convergence: { type: 'unanimous' },
      scope_strategy: 'partitioned',
    });
    assert.ok(session.session_id.startsWith('collab-task-42-'));
    assert.equal(session.task_id, 'task-42');
    assert.equal(session.mode, 'parallel');
    assert.equal(session.status, 'recruiting');
    assert.equal(session.min_nodes, 2);
    assert.equal(session.max_nodes, 4);
    assert.equal(session.max_rounds, 5);
    assert.equal(session.convergence.type, 'unanimous');
    assert.equal(session.scope_strategy, 'partitioned');
    assert.equal(session.current_round, 0);
    assert.deepEqual(session.nodes, []);
    assert.deepEqual(session.turn_order, []);
    assert.equal(session.current_turn, null);
  });

  it('sequential mode builds turn_order on addNode', async () => {
    const store = makeStore();
    const session = createSession('task-seq', { mode: 'sequential', min_nodes: 2, max_nodes: 2 });
    await store.put(session);
    await store.addNode(session.session_id, 'first');
    await store.addNode(session.session_id, 'second');
    const updated = await store.get(session.session_id);
    assert.deepEqual(updated.turn_order, ['first', 'second']);
  });

  it('parallel mode does NOT build turn_order', async () => {
    const store = makeStore();
    const session = createSession('task-par', { mode: 'parallel', min_nodes: 2, max_nodes: 2 });
    await store.put(session);
    await store.addNode(session.session_id, 'first');
    await store.addNode(session.session_id, 'second');
    const updated = await store.get(session.session_id);
    assert.deepEqual(updated.turn_order, []);
  });
});

// ════════════════════════════════════════════════════
// startRound — dead node pruning
// ════════════════════════════════════════════════════

describe('startRound — dead node pruning', () => {
  it('prunes dead nodes before starting new round', async () => {
    const store = makeStore();
    const session = createSession('task-prune', {
      mode: 'parallel', min_nodes: 2, max_nodes: 3,
      convergence: { type: 'unanimous' },
    });
    await store.put(session);
    await store.addNode(session.session_id, 'alive-A');
    await store.addNode(session.session_id, 'alive-B');
    await store.addNode(session.session_id, 'dead-C');
    await store.setNodeStatus(session.session_id, 'dead-C', 'dead');

    const round = await store.startRound(session.session_id);
    assert.ok(round);
    const updated = await store.get(session.session_id);
    assert.equal(updated.nodes.length, 2);
    assert.ok(!updated.nodes.find(n => n.node_id === 'dead-C'));
  });

  it('aborts if not enough nodes after pruning', async () => {
    const store = makeStore();
    const session = createSession('task-abort', {
      mode: 'parallel', min_nodes: 2, max_nodes: 3,
      convergence: { type: 'unanimous' },
    });
    await store.put(session);
    await store.addNode(session.session_id, 'alive-A');
    await store.addNode(session.session_id, 'dead-B');
    await store.addNode(session.session_id, 'dead-C');
    await store.setNodeStatus(session.session_id, 'dead-B', 'dead');
    await store.setNodeStatus(session.session_id, 'dead-C', 'dead');

    const round = await store.startRound(session.session_id);
    assert.equal(round, null, 'Should return null (aborted)');
    const updated = await store.get(session.session_id);
    assert.equal(updated.status, 'aborted');
  });

  it('snapshots recruited_count on first round only', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store, { nodes: ['A', 'B', 'C'], min_nodes: 2, max_nodes: 3 });

    let session = await store.get(sid);
    assert.equal(session.recruited_count, 3, 'recruited_count should be 3 after first round');

    // Mark one dead and start round 2
    await store.setNodeStatus(sid, 'C', 'dead');
    // Submit reflections to complete round 1
    await store.submitReflection(sid, { node_id: 'A', summary: '', vote: 'continue', confidence: 0.5, artifacts: [] });
    await store.submitReflection(sid, { node_id: 'B', summary: '', vote: 'continue', confidence: 0.5, artifacts: [] });
    await store.startRound(sid);

    session = await store.get(sid);
    assert.equal(session.recruited_count, 3, 'recruited_count should NOT change after first round');
    assert.equal(session.nodes.length, 2, 'But active nodes should be 2');
  });
});

// ════════════════════════════════════════════════════
// submitReflection — duplicate prevention
// ════════════════════════════════════════════════════

describe('submitReflection — dedup and structure', () => {
  it('rejects duplicate reflection from same node', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    const r1 = await store.submitReflection(sid, { node_id: 'node-A', summary: 'first', vote: 'converged', confidence: 0.9, artifacts: [] });
    assert.ok(r1, 'First reflection should succeed');

    const r2 = await store.submitReflection(sid, { node_id: 'node-A', summary: 'dup', vote: 'continue', confidence: 0.5, artifacts: [] });
    assert.equal(r2, null, 'Duplicate reflection should return null');
  });

  it('sets node status to reflecting after submission', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [] });
    const session = await store.get(sid);
    const nodeA = session.nodes.find(n => n.node_id === 'node-A');
    assert.equal(nodeA.status, 'reflecting');
  });
});

// ════════════════════════════════════════════════════
// compileSharedIntel — intel format
// ════════════════════════════════════════════════════

describe('compileSharedIntel', () => {
  it('returns empty string for first round (no prior reflections)', () => {
    const store = makeStore();
    const session = createSession('task-intel', { mode: 'parallel', min_nodes: 2 });
    assert.equal(store.compileSharedIntel(session), '');
  });

  it('includes node summaries, learnings, and votes from prior round', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'Found a bug', learnings: 'Edge case in parser', vote: 'continue', confidence: 0.4, artifacts: ['fix.js'] });
    await store.submitReflection(sid, { node_id: 'node-B', summary: 'All good', learnings: 'Nothing new', vote: 'converged', confidence: 0.9, artifacts: [] });

    const session = await store.get(sid);
    const intel = store.compileSharedIntel(session);

    assert.ok(intel.includes('ROUND 1'));
    assert.ok(intel.includes('node-A'));
    assert.ok(intel.includes('Found a bug'));
    assert.ok(intel.includes('Edge case in parser'));
    assert.ok(intel.includes('fix.js'));
    assert.ok(intel.includes('node-B'));
    assert.ok(intel.includes('All good'));
    assert.ok(intel.includes('1/2 voted converged'));
  });

  it('marks parse_failed reflections in intel', async () => {
    const store = makeStore();
    const sid = await setupActiveSession(store);
    await store.submitReflection(sid, { node_id: 'node-A', summary: 'garbled', vote: 'continue', confidence: 0.5, artifacts: [], parse_failed: true });
    await store.submitReflection(sid, { node_id: 'node-B', summary: 'ok', vote: 'converged', confidence: 0.9, artifacts: [] });

    const session = await store.get(sid);
    const intel = store.compileSharedIntel(session);
    assert.ok(intel.includes('PARSE FAILED'));
  });
});

// ════════════════════════════════════════════════════
// findActiveSessionsByNode — reverse lookup
// ════════════════════════════════════════════════════

describe('findActiveSessionsByNode', () => {
  it('returns only active sessions containing the target node', async () => {
    const store = makeStore();

    // Session 1: active, has node-X
    const s1 = createSession('task-find-1', { mode: 'parallel', min_nodes: 2 });
    await store.put(s1);
    await store.addNode(s1.session_id, 'node-X');
    await store.addNode(s1.session_id, 'node-Y');
    // Manually set status to active
    const s1up = await store.get(s1.session_id);
    s1up.status = COLLAB_STATUS.ACTIVE;
    await store.put(s1up);

    // Session 2: active, does NOT have node-X
    const s2 = createSession('task-find-2', { mode: 'parallel', min_nodes: 2 });
    await store.put(s2);
    await store.addNode(s2.session_id, 'node-Y');
    await store.addNode(s2.session_id, 'node-Z');
    const s2up = await store.get(s2.session_id);
    s2up.status = COLLAB_STATUS.ACTIVE;
    await store.put(s2up);

    // Session 3: completed (not active), has node-X
    const s3 = createSession('task-find-3', { mode: 'parallel', min_nodes: 2 });
    await store.put(s3);
    await store.addNode(s3.session_id, 'node-X');
    const s3up = await store.get(s3.session_id);
    s3up.status = COLLAB_STATUS.COMPLETED;
    await store.put(s3up);

    const results = await store.findActiveSessionsByNode('node-X');
    assert.equal(results.length, 1);
    assert.equal(results[0].session_id, s1.session_id);
  });

  it('returns empty array when node is in no active sessions', async () => {
    const store = makeStore();
    const results = await store.findActiveSessionsByNode('ghost-node');
    assert.deepEqual(results, []);
  });
});
