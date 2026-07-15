// Step 3.1 — the mode dispatch seam. One session schema carries all modes;
// createSession validates the mode; the daemon starts a live protocol only for
// implemented modes and refuses declared-but-unbuilt ones (no silent downgrade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSession, COLLAB_MODE, isModeImplemented, IMPLEMENTED_MODES } = require('../lib/mesh-collab');

test('COLLAB_MODE declares all seven modes incl. the F-N20 additions', () => {
  for (const m of ['parallel', 'sequential', 'review', 'circling_strategy', 'cooperative', 'collaborative', 'management']) {
    assert.ok(Object.values(COLLAB_MODE).includes(m), `missing mode ${m}`);
  }
});

test('createSession stores a valid mode on the session', () => {
  for (const mode of Object.values(COLLAB_MODE)) {
    const s = createSession('t-1', { mode });
    assert.equal(s.mode, mode);
  }
});

test('createSession rejects an unknown mode (no silent PARALLEL fallback)', () => {
  assert.throws(() => createSession('t-2', { mode: 'telepathy' }), /unknown mode 'telepathy'/);
});

test('createSession defaults to parallel when no mode given', () => {
  assert.equal(createSession('t-3', {}).mode, COLLAB_MODE.PARALLEL);
});

test('isModeImplemented: legacy + circling + cooperative live; collaborative/management not', () => {
  assert.ok(isModeImplemented(COLLAB_MODE.PARALLEL));
  assert.ok(isModeImplemented(COLLAB_MODE.SEQUENTIAL));
  assert.ok(isModeImplemented(COLLAB_MODE.REVIEW));
  assert.ok(isModeImplemented(COLLAB_MODE.CIRCLING_STRATEGY));
  assert.ok(isModeImplemented(COLLAB_MODE.COOPERATIVE), 'cooperative went live in 3.2');
  assert.ok(!isModeImplemented(COLLAB_MODE.COLLABORATIVE), 'collaborative is 3.3, not yet live');
  assert.ok(!isModeImplemented(COLLAB_MODE.MANAGEMENT), 'management is Block 4, not yet live');
});

test('every implemented mode is a declared COLLAB_MODE (no orphan)', () => {
  for (const m of IMPLEMENTED_MODES) {
    assert.ok(Object.values(COLLAB_MODE).includes(m), `implemented mode ${m} not in COLLAB_MODE`);
  }
});

test('circling sessions still get their circling substructure (adversarial default preserved)', () => {
  const s = createSession('t-4', { mode: COLLAB_MODE.CIRCLING_STRATEGY });
  assert.ok(s.circling, 'circling_strategy session must carry the circling block');
  const p = createSession('t-5', { mode: COLLAB_MODE.PARALLEL });
  assert.equal(p.circling, null, 'non-circling modes carry null circling');
});
