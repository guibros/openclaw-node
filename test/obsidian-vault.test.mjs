import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

import {
  DEFAULT_VAULT_PATH,
  VAULT_SUBDIRS,
  getVaultPath,
  ensureVaultStructure,
  _resetVaultPathCache,
} from '../lib/obsidian-vault.mjs';

// Isolate from the node's real fused-vault config (memoryVaultPath) — these
// tests assert the pre-config resolution tiers. Fusion behavior is covered in
// obsidian-vault-fusion.test.mjs.
process.env.OPENCLAW_OBSIDIAN_SYNC_CONFIG = '/nonexistent/obsidian-sync.json';
_resetVaultPathCache();

describe('DEFAULT_VAULT_PATH', () => {
  it('resolves under ~/.openclaw/obsidian-local/', () => {
    assert.equal(
      DEFAULT_VAULT_PATH,
      join(homedir(), '.openclaw', 'obsidian-local'),
    );
  });
});

describe('VAULT_SUBDIRS', () => {
  it('contains exactly 5 subdirectories', () => {
    assert.equal(VAULT_SUBDIRS.length, 5);
  });

  it('includes all required directories', () => {
    const expected = ['concepts', 'decisions', 'sessions', 'themes', 'daily'];
    for (const dir of expected) {
      assert.ok(VAULT_SUBDIRS.includes(dir), `missing: ${dir}`);
    }
  });
});

describe('getVaultPath', () => {
  it('returns default when no opts or env', () => {
    const saved = process.env.OBSIDIAN_VAULT_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;
    try {
      assert.equal(getVaultPath(), DEFAULT_VAULT_PATH);
    } finally {
      if (saved !== undefined) process.env.OBSIDIAN_VAULT_PATH = saved;
    }
  });

  it('respects OBSIDIAN_VAULT_PATH env var', () => {
    const saved = process.env.OBSIDIAN_VAULT_PATH;
    process.env.OBSIDIAN_VAULT_PATH = '/tmp/custom-vault';
    try {
      assert.equal(getVaultPath(), '/tmp/custom-vault');
    } finally {
      if (saved !== undefined) {
        process.env.OBSIDIAN_VAULT_PATH = saved;
      } else {
        delete process.env.OBSIDIAN_VAULT_PATH;
      }
    }
  });

  it('opts.vaultPath takes precedence over env', () => {
    const saved = process.env.OBSIDIAN_VAULT_PATH;
    process.env.OBSIDIAN_VAULT_PATH = '/tmp/env-vault';
    try {
      assert.equal(getVaultPath({ vaultPath: '/tmp/opts-vault' }), '/tmp/opts-vault');
    } finally {
      if (saved !== undefined) {
        process.env.OBSIDIAN_VAULT_PATH = saved;
      } else {
        delete process.env.OBSIDIAN_VAULT_PATH;
      }
    }
  });
});

describe('ensureVaultStructure', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'obsidian-vault-test-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates vault root and all subdirectories', async () => {
    const vaultPath = join(tempDir, 'vault');
    const result = await ensureVaultStructure(vaultPath);

    assert.equal(result.vaultPath, vaultPath);
    assert.ok(result.created.length > 0, 'should report created dirs');

    // Verify root exists
    const rootStat = await stat(vaultPath);
    assert.ok(rootStat.isDirectory());

    // Verify all subdirs exist
    for (const subdir of VAULT_SUBDIRS) {
      const subdirStat = await stat(join(vaultPath, subdir));
      assert.ok(subdirStat.isDirectory(), `missing subdir: ${subdir}`);
    }
  });

  it('is idempotent — second call creates nothing new', async () => {
    const vaultPath = join(tempDir, 'vault-idem');
    await ensureVaultStructure(vaultPath);
    const result2 = await ensureVaultStructure(vaultPath);
    assert.deepEqual(result2.created, [], 'second call should create nothing');
  });
});
