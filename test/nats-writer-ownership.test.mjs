import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLegacyNatsWriterAllowed, PROTECTED_NATS_HANDOFF } from '../lib/nats-writer-ownership.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

it('protected handoff blocks the legacy path, including an invalid or linked marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-writer-ownership-'));
  const state = path.join(root, 'writer-handoff.json');
  try {
    assert.doesNotThrow(() => assertLegacyNatsWriterAllowed(state));
    fs.writeFileSync(state, '{broken');
    assert.throws(() => assertLegacyNatsWriterAllowed(state), /protected NATS writer handoff active/);
    fs.rmSync(state);
    fs.symlinkSync(path.join(root, 'missing'), state);
    assert.throws(() => assertLegacyNatsWriterAllowed(state), /protected NATS writer handoff active/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('auth sync refuses before trust changes the registry or writes auth', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-writer-sync-'));
  const preload = path.join(root, 'committed.cjs');
  fs.writeFileSync(preload, `const fs = require('node:fs');
const original = fs.lstatSync;
fs.lstatSync = (name, ...args) => String(name) === ${JSON.stringify(PROTECTED_NATS_HANDOFF)} ? {} : original(name, ...args);
`);
  const env = { ...process.env, HOME: root, OPENCLAW_IDENTITY_DIR: root, NODE_OPTIONS: `--require=${preload}` };
  try {
    const trust = spawnSync(process.execPath, [path.join(repo, 'bin/openclaw-trust-peer.mjs'), 'peer', 'A'.repeat(44), '--sync-nats'], { encoding: 'utf8', env });
    assert.equal(trust.status, 1);
    assert.match(trust.stderr, /protected NATS writer handoff active/);
    assert.equal(fs.existsSync(path.join(root, 'identity-registry.json')), false);

    const out = path.join(root, 'nats-auth.conf');
    const render = spawnSync(process.execPath, [path.join(repo, 'bin/nats-auth-render.mjs'), '--out', out, '--mode', 'token'], { encoding: 'utf8', env });
    assert.equal(render.status, 1);
    assert.match(render.stderr, /protected NATS writer handoff active/);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
