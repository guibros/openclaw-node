// Step 3.2 — cooperative protocol: propose-all / integrate-one / rotate-integrator.
// Unit-level: the session schema + the integrator-rotation math. The live
// propose→integrate→rotate flow is verified by a mock-LLM runtime run (AUDIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSession, COLLAB_MODE, isModeImplemented } = require('../lib/mesh-collab.js');

test('cooperative is now an implemented mode (3.2)', () => {
  assert.ok(isModeImplemented(COLLAB_MODE.COOPERATIVE));
});

test('createSession builds the cooperative block only for cooperative mode', () => {
  const coop = createSession('t-1', { mode: COLLAB_MODE.COOPERATIVE });
  assert.ok(coop.cooperative, 'cooperative session must carry the cooperative block');
  assert.equal(coop.cooperative.rounds_target, 3, 'default 3 rounds');
  assert.deepEqual(coop.cooperative.integrations, []);
  assert.equal(coop.cooperative.current_integrator, null, 'integrator assigned at recruiting close');
  assert.equal(coop.circling, null, 'cooperative carries no circling block');

  const circ = createSession('t-2', { mode: COLLAB_MODE.CIRCLING_STRATEGY });
  assert.equal(circ.cooperative, null, 'circling carries no cooperative block');

  const par = createSession('t-3', { mode: COLLAB_MODE.PARALLEL });
  assert.equal(par.cooperative, null);
});

test('rounds_target is configurable, bounded by max_rounds default', () => {
  const s = createSession('t-4', { mode: COLLAB_MODE.COOPERATIVE, rounds: 2 });
  assert.equal(s.cooperative.rounds_target, 2);
  assert.ok(s.max_rounds >= s.cooperative.rounds_target, 'max_rounds must cover rounds_target');
});

// The integrator-rotation math the daemon uses (mirrors evaluateCooperativeRound).
test('integrator rotates through all nodes, wrapping, over N rounds', () => {
  const order = ['alpha', 'bravo', 'charlie'];
  const seen = [];
  let integrator = order[0];
  for (let round = 1; round <= 3; round++) {
    seen.push(integrator);
    const idx = order.indexOf(integrator);
    integrator = order[(idx + 1) % order.length];
  }
  assert.deepEqual(seen, ['alpha', 'bravo', 'charlie'], 'each round a different integrator');
  assert.equal(new Set(seen).size, 3, 'all three nodes integrate exactly once over 3 rounds');
});

test('with 3 nodes and rounds_target 3, every node integrates once (fair rotation)', () => {
  const order = ['n1', 'n2', 'n3'];
  const counts = {};
  let integrator = order[0];
  for (let r = 0; r < 3; r++) {
    counts[integrator] = (counts[integrator] || 0) + 1;
    integrator = order[(order.indexOf(integrator) + 1) % order.length];
  }
  assert.deepEqual(counts, { n1: 1, n2: 1, n3: 1 });
});
