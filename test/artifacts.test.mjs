import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  putArtifact,
  getArtifact,
  hasArtifact,
  validateArtifact,
} from '../lib/artifacts.mjs';

describe('artifacts — content-addressed store', () => {
  let baseDir;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'openclaw-artifacts-test-'));
  });

  after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('put+get roundtrip — bytes match', async () => {
    const content = Buffer.from('hello world');
    const { ref, size } = await putArtifact(content, { baseDir });
    assert.equal(size, content.length);
    assert.equal(ref.length, 64); // sha256 hex

    const retrieved = await getArtifact(ref, { baseDir });
    assert.deepEqual(retrieved, content);
  });

  it('hasArtifact returns true after put, false for unknown ref', async () => {
    const content = Buffer.from('test has artifact');
    const { ref } = await putArtifact(content, { baseDir });

    assert.equal(await hasArtifact(ref, { baseDir }), true);
    assert.equal(await hasArtifact('0'.repeat(64), { baseDir }), false);
  });

  it('validateArtifact returns valid:true for intact artifact', async () => {
    const content = Buffer.from('validate me');
    const { ref } = await putArtifact(content, { baseDir });

    const result = await validateArtifact(ref, { baseDir });
    assert.equal(result.valid, true);
    assert.equal(result.ref, ref);
    assert.equal(result.computedRef, ref);
  });

  it('validateArtifact detects tampering', async () => {
    const content = Buffer.from('original content');
    const { ref, path } = await putArtifact(content, { baseDir });

    // Tamper with the stored bytes
    await writeFile(path, Buffer.from('tampered content'));

    const result = await validateArtifact(ref, { baseDir });
    assert.equal(result.valid, false);
    assert.equal(result.ref, ref);
    assert.notEqual(result.computedRef, ref);
  });

  it('putArtifact is idempotent — same content produces same ref', async () => {
    const content = Buffer.from('idempotent test');
    const first = await putArtifact(content, { baseDir });
    const second = await putArtifact(content, { baseDir });

    assert.equal(first.ref, second.ref);
    assert.equal(first.size, second.size);
    assert.equal(first.path, second.path);
  });

  it('.meta.json sidecar contains expected fields', async () => {
    const content = Buffer.from('meta test');
    const { ref, path } = await putArtifact(content, {
      baseDir,
      mime_type: 'text/plain',
      filename: 'test.txt',
    });

    const metaPath = path + '.meta.json';
    const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

    assert.equal(meta.ref, ref);
    assert.equal(meta.size, content.length);
    assert.equal(meta.mime_type, 'text/plain');
    assert.equal(meta.filename, 'test.txt');
    assert.ok(meta.created_at); // ISO timestamp present
    assert.equal(meta.encoding, null);
  });
});
