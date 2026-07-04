import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getVaultPath, DEFAULT_VAULT_PATH, _resetVaultPathCache } from '../lib/obsidian-vault.mjs';

let tmp, savedEnv;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-fusion-'));
  savedEnv = { ...process.env };
  delete process.env.OBSIDIAN_VAULT_PATH;
  process.env.OPENCLAW_OBSIDIAN_SYNC_CONFIG = path.join(tmp, 'obsidian-sync.json');
  process.env.OPENCLAW_WORKSPACE = path.join(tmp, 'workspace');
  _resetVaultPathCache();
});
afterEach(() => {
  process.env = savedEnv;
  _resetVaultPathCache();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const writeConfig = (obj) =>
  fs.writeFileSync(process.env.OPENCLAW_OBSIDIAN_SYNC_CONFIG, JSON.stringify(obj));

describe('getVaultPath — fused-vault resolution', () => {
  it('no config → legacy obsidian-local default', () => {
    assert.equal(getVaultPath(), DEFAULT_VAULT_PATH);
  });
  it('memoryVaultPath (workspace-relative) resolves under the workspace', () => {
    writeConfig({ memoryVaultPath: 'projects/arcane-vault/nodes/daedalus/memory' });
    assert.equal(getVaultPath(), path.join(tmp, 'workspace', 'projects/arcane-vault/nodes/daedalus/memory'));
  });
  it('absolute memoryVaultPath wins as-is', () => {
    writeConfig({ memoryVaultPath: '/abs/vault/memory' });
    assert.equal(getVaultPath(), '/abs/vault/memory');
  });
  it('empty memoryVaultPath falls back to legacy default (fresh-node template)', () => {
    writeConfig({ memoryVaultPath: '' });
    assert.equal(getVaultPath(), DEFAULT_VAULT_PATH);
  });
  it('env override beats config; explicit opts beat everything', () => {
    writeConfig({ memoryVaultPath: '/abs/from-config' });
    process.env.OBSIDIAN_VAULT_PATH = '/abs/from-env';
    _resetVaultPathCache();
    assert.equal(getVaultPath(), '/abs/from-env');
    assert.equal(getVaultPath({ vaultPath: '/abs/from-opts' }), '/abs/from-opts');
  });
  it('config is cached per process; _resetVaultPathCache re-reads', () => {
    writeConfig({ memoryVaultPath: '/abs/first' });
    assert.equal(getVaultPath(), '/abs/first');
    writeConfig({ memoryVaultPath: '/abs/second' });
    assert.equal(getVaultPath(), '/abs/first');
    _resetVaultPathCache();
    assert.equal(getVaultPath(), '/abs/second');
  });
});
