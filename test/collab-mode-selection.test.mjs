// Step 3.4 — mode-selection contract: the human-facing preferred_mode maps to a
// wire COLLAB_MODE, createSession honors it (and builds the right substructure),
// explicit mode wins, unknown preferred_mode fails loud. Decision table matches
// docs/FEDERATION_SPEC.md §3.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSession, COLLAB_MODE, resolvePreferredMode, PREFERRED_MODE_MAP } = require('../lib/mesh-collab.js');

test('resolvePreferredMode maps the three human-facing modes to wire modes', () => {
  assert.equal(resolvePreferredMode('adversarial'), COLLAB_MODE.CIRCLING_STRATEGY);
  assert.equal(resolvePreferredMode('cooperative'), COLLAB_MODE.COOPERATIVE);
  assert.equal(resolvePreferredMode('collaborative'), COLLAB_MODE.COLLABORATIVE);
  assert.equal(resolvePreferredMode('telepathy'), null);
  assert.equal(resolvePreferredMode(undefined), null);
});

test('PREFERRED_MODE_MAP matches the §3.4 decision-table rows (3 shapes)', () => {
  assert.deepEqual(Object.keys(PREFERRED_MODE_MAP).sort(), ['adversarial', 'collaborative', 'cooperative']);
});

test('createSession honors preferred_mode: adversarial → circling protocol', () => {
  const s = createSession('t-1', { preferred_mode: 'adversarial' });
  assert.equal(s.mode, COLLAB_MODE.CIRCLING_STRATEGY);
  assert.ok(s.circling, 'adversarial builds the circling substructure');
  assert.equal(s.min_nodes, 3, 'circling defaults to 3 nodes');
});

test('createSession honors preferred_mode: cooperative → cooperative protocol', () => {
  const s = createSession('t-2', { preferred_mode: 'cooperative' });
  assert.equal(s.mode, COLLAB_MODE.COOPERATIVE);
  assert.ok(s.cooperative);
  assert.equal(s.circling, null);
});

test('createSession honors preferred_mode: collaborative → collaborative protocol', () => {
  const s = createSession('t-3', { preferred_mode: 'collaborative' });
  assert.equal(s.mode, COLLAB_MODE.COLLABORATIVE);
  assert.ok(s.collaborative);
  assert.equal(s.cooperative, null);
});

test('explicit wire mode wins over preferred_mode', () => {
  const s = createSession('t-4', { mode: COLLAB_MODE.PARALLEL, preferred_mode: 'adversarial' });
  assert.equal(s.mode, COLLAB_MODE.PARALLEL, 'explicit mode takes precedence');
  assert.equal(s.circling, null);
});

test('unknown preferred_mode fails loud (no silent parallel)', () => {
  assert.throws(() => createSession('t-5', { preferred_mode: 'vibes' }), /unknown preferred_mode 'vibes'/);
});

test('no mode + no preferred_mode → parallel default', () => {
  assert.equal(createSession('t-6', {}).mode, COLLAB_MODE.PARALLEL);
});
