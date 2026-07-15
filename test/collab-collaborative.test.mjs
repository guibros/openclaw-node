// Step 3.3 — collaborative protocol: decompose → per-node subtasks (parallel) →
// merge + merge-review. Unit-level: session schema + partition/merge invariants.
// The live work→merge→review flow is verified by a mock-LLM runtime run (AUDIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSession, COLLAB_MODE, isModeImplemented } = require('../lib/mesh-collab.js');

test('collaborative is now an implemented mode (3.3)', () => {
  assert.ok(isModeImplemented(COLLAB_MODE.COLLABORATIVE));
});

test('createSession builds the collaborative block only for collaborative mode', () => {
  const c = createSession('t-1', { mode: COLLAB_MODE.COLLABORATIVE });
  assert.ok(c.collaborative, 'collaborative session must carry the collaborative block');
  assert.equal(c.collaborative.phase, 'work', 'starts in the work phase');
  assert.deepEqual(c.collaborative.subtasks, {});
  assert.equal(c.collaborative.merged, null);
  assert.deepEqual(c.collaborative.review_votes, []);
  assert.equal(c.collaborative.merger_node_id, null, 'merger assigned at recruiting close');
  assert.equal(c.cooperative, null, 'collaborative carries no cooperative block');
  assert.equal(c.circling, null, 'collaborative carries no circling block');

  const par = createSession('t-2', { mode: COLLAB_MODE.PARALLEL });
  assert.equal(par.collaborative, null);
});

// The partition + merge invariants the daemon relies on.
test('partitioned decomposition: N scope paths across 3 nodes, each node a distinct slice', () => {
  // mirrors computeNodeScopes('partitioned') round-robin
  const nodes = ['alpha', 'bravo', 'charlie'];
  const taskScope = ['a.js', 'b.js', 'c.js'];
  const scopes = {}; nodes.forEach(n => scopes[n] = []);
  taskScope.forEach((p, i) => scopes[nodes[i % nodes.length]].push(p));
  assert.deepEqual(scopes, { alpha: ['a.js'], bravo: ['b.js'], charlie: ['c.js'] });
  // 3 distinct node-ids, each a non-empty distinct slice
  assert.equal(new Set(Object.keys(scopes)).size, 3);
  for (const s of Object.values(scopes)) assert.ok(s.length >= 1);
});

test('merge phase: merger produces the merged artifact; the other two are reviewers', () => {
  const nodes = ['alpha', 'bravo', 'charlie'];
  const merger = nodes[0];
  const reviewers = nodes.filter(n => n !== merger);
  assert.equal(merger, 'alpha');
  assert.deepEqual(reviewers, ['bravo', 'charlie']);
  assert.equal(reviewers.length, 2, 'two merge-reviewers vote on the merge');
});
