import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  spawnNode,
  readNodeConfig,
  validateNodeId,
  resolveNodeRoot,
  DEFAULT_PORT,
  DEFAULT_NATS_URL,
  NODE_SUBDIRS,
} from '../bin/spawn-node.mjs';

describe('bin/spawn-node.mjs', () => {
  let tempBase;

  beforeEach(async () => {
    // Use a temp directory with trailing hyphen to mimic ~/.openclaw-
    tempBase = (await mkdtemp(join(tmpdir(), 'spawn-node-test-'))) + '/openclaw-';
  });

  afterEach(async () => {
    // Clean up (remove the parent dir)
    const parentDir = tempBase.replace(/\/openclaw-$/, '');
    await rm(parentDir, { recursive: true, force: true });
  });

  describe('validateNodeId', () => {
    it('accepts valid IDs', () => {
      assert.deepEqual(validateNodeId('alpha'), { valid: true });
      assert.deepEqual(validateNodeId('node-1'), { valid: true });
      assert.deepEqual(validateNodeId('a'), { valid: true });
      assert.deepEqual(validateNodeId('abc123'), { valid: true });
    });

    it('rejects invalid IDs', () => {
      assert.equal(validateNodeId('').valid, false);
      assert.equal(validateNodeId(null).valid, false);
      assert.equal(validateNodeId('Alpha').valid, false); // uppercase
      assert.equal(validateNodeId('-bad').valid, false); // leading hyphen
      assert.equal(validateNodeId('bad-').valid, false); // trailing hyphen
      assert.equal(validateNodeId('a'.repeat(33)).valid, false); // too long
      assert.equal(validateNodeId('has space').valid, false);
      assert.equal(validateNodeId('has_underscore').valid, false);
    });
  });

  describe('resolveNodeRoot', () => {
    it('appends to base ending with hyphen', () => {
      const root = resolveNodeRoot('alpha', { baseDir: '/tmp/openclaw-' });
      assert.equal(root, '/tmp/openclaw-alpha');
    });

    it('joins as subdir when base does not end with hyphen', () => {
      const root = resolveNodeRoot('alpha', { baseDir: '/tmp/nodes' });
      assert.equal(root, '/tmp/nodes/alpha');
    });
  });

  describe('spawnNode', () => {
    it('creates the full directory tree', async () => {
      const result = await spawnNode({ id: 'alpha', baseDir: tempBase });

      assert.equal(result.nodeRoot, `${tempBase}alpha`);
      assert.equal(result.alreadyExisted, false);

      // Verify all subdirs exist
      for (const subdir of NODE_SUBDIRS) {
        const s = await stat(join(result.nodeRoot, subdir));
        assert.ok(s.isDirectory(), `${subdir} should be a directory`);
      }
    });

    it('writes config/node.json with correct fields', async () => {
      const result = await spawnNode({
        id: 'beta',
        port: 7901,
        natsUrl: 'nats://localhost:4223',
        baseDir: tempBase,
      });

      const config = JSON.parse(await readFile(result.configPath, 'utf8'));
      assert.equal(config.id, 'beta');
      assert.equal(config.port, 7901);
      assert.equal(config.nats_url, 'nats://localhost:4223');
      assert.ok(config.created_at);
      assert.equal(config.openclaw_home, result.nodeRoot);
    });

    it('uses default port and nats_url when not specified', async () => {
      const result = await spawnNode({ id: 'gamma', baseDir: tempBase });

      const config = JSON.parse(await readFile(result.configPath, 'utf8'));
      assert.equal(config.port, DEFAULT_PORT);
      assert.equal(config.nats_url, DEFAULT_NATS_URL);
    });

    it('initializes state.db', async () => {
      const result = await spawnNode({ id: 'delta', baseDir: tempBase });

      const s = await stat(result.dbPath);
      assert.ok(s.isFile(), 'state.db should exist');
    });

    it('is idempotent — re-running does not overwrite config', async () => {
      // First spawn
      await spawnNode({ id: 'echo', port: 7901, baseDir: tempBase });

      // Second spawn with different port — config should NOT change
      const result2 = await spawnNode({ id: 'echo', port: 9999, baseDir: tempBase });

      assert.equal(result2.alreadyExisted, true);
      // created should be empty (nothing new)
      assert.equal(result2.created.length, 0);

      // Config still has original port
      const config = JSON.parse(await readFile(result2.configPath, 'utf8'));
      assert.equal(config.port, 7901);
    });

    it('throws on invalid node ID', async () => {
      await assert.rejects(
        () => spawnNode({ id: 'BAD-ID', baseDir: tempBase }),
        /Invalid node ID/
      );
    });

    it('throws on missing node ID', async () => {
      await assert.rejects(
        () => spawnNode({ id: '', baseDir: tempBase }),
        /Invalid node ID/
      );
    });
  });

  describe('readNodeConfig', () => {
    it('returns config for an existing node', async () => {
      await spawnNode({ id: 'foxtrot', port: 8000, baseDir: tempBase });

      const config = await readNodeConfig('foxtrot', { baseDir: tempBase });
      assert.equal(config.id, 'foxtrot');
      assert.equal(config.port, 8000);
    });

    it('returns null for non-existent node', async () => {
      const config = await readNodeConfig('nonexistent', { baseDir: tempBase });
      assert.equal(config, null);
    });
  });
});
