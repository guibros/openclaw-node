import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { deriveNodeId, resolveNodeId } from '../lib/node-id.js';

describe('node-id — one derivation everywhere (review I13/P10)', () => {
  it('derives the way env.sh does: short hostname, lowercase, non-alnum stripped', () => {
    assert.equal(deriveNodeId("Guillaume's MacBook Pro.local"), 'guillaumesmacbookpro');
    assert.equal(deriveNodeId('box.local'), 'box');
    assert.equal(deriveNodeId('MoltyMacs-Virtual-Machine.local'), 'moltymacs-virtual-machine');
    assert.equal(deriveNodeId('worker-2.tail1234.ts.net'), 'worker-2');
  });

  it('matches the shell rule byte-for-byte on a hostile hostname', () => {
    const host = "Guillaume's MacBook Pro";
    const shell = execFileSync('bash', ['-c', `printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-'`, '_', host], { encoding: 'utf8' });
    assert.equal(deriveNodeId(host), shell);
  });

  it('explicit env wins, in the same order the daemons used', () => {
    assert.equal(resolveNodeId({ OPENCLAW_NODE_ID: 'lead-a', MESH_NODE_ID: 'legacy' }, 'Other.local'), 'lead-a');
    assert.equal(resolveNodeId({ MESH_NODE_ID: 'legacy' }, 'Other.local'), 'legacy');
    assert.equal(resolveNodeId({}, 'Other.local'), 'other');
  });

  it('is never empty', () => {
    assert.equal(resolveNodeId({}, "'''"), 'node');
    assert.equal(resolveNodeId({ OPENCLAW_NODE_ID: '   ' }, ''), 'node');
  });
});
