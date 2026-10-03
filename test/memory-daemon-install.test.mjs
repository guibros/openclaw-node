import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(repo, 'workspace-bin/install-daemon');

test('memory-daemon direct install preserves the configured LLM URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-daemon-install-'));
  try {
    const home = path.join(root, 'home');
    const workspace = path.join(root, 'workspace');
    const stubBin = path.join(root, 'bin');
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    fs.mkdirSync(workspace);
    fs.mkdirSync(stubBin);
    fs.writeFileSync(path.join(home, '.openclaw/openclaw.env'),
      'LLM_BASE_URL=http://192.168.64.1:11434\n');
    fs.writeFileSync(path.join(stubBin, 'uname'), '#!/bin/sh\nprintf "Darwin\\n"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(stubBin, 'launchctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env = {
      HOME: home,
      OPENCLAW_WORKSPACE: workspace,
      PATH: [stubBin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    };
    const run = (extra = {}) => spawnSync('/bin/bash', [installer, 'install'], {
      env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000,
    });
    const plist = path.join(home, 'Library/LaunchAgents/ai.openclaw.memory-daemon.plist');

    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(plist, 'utf8'),
      /<key>LLM_BASE_URL<\/key>\s*<string>http:\/\/192\.168\.64\.1:11434<\/string>/);
    assert.equal(fs.readFileSync(path.join(home, '.openclaw/services/ai.openclaw.memory-daemon.plist'), 'utf8'),
      fs.readFileSync(plist, 'utf8'));

    fs.writeFileSync(path.join(home, '.openclaw/openclaw.env'),
      'LLM_BASE_URL="http://192.168.64.1:11434"\r\n');
    const quoted = run();
    assert.equal(quoted.status, 0, quoted.stderr);
    assert.match(fs.readFileSync(plist, 'utf8'),
      /<key>LLM_BASE_URL<\/key>\s*<string>http:\/\/192\.168\.64\.1:11434<\/string>/);
    fs.writeFileSync(path.join(home, '.openclaw/openclaw.env'),
      'LLM_BASE_URL=http://192.168.64.1:11434\n');

    result = run({ LLM_BASE_URL: 'http://override:11434/?a=1&b=2' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(plist, 'utf8'),
      /<key>LLM_BASE_URL<\/key>\s*<string>http:\/\/192\.168\.64\.1:11434<\/string>/);

    fs.rmSync(path.join(home, '.openclaw/openclaw.env'));
    result = run({ LLM_BASE_URL: 'http://override:11434/?a=1&b=2' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(plist, 'utf8'),
      /<key>LLM_BASE_URL<\/key>\s*<string>http:\/\/override:11434\/\?a=1&amp;b=2<\/string>/);
    fs.writeFileSync(path.join(home, '.openclaw/openclaw.env'),
      'LLM_BASE_URL=http://192.168.64.1:11434\n');

    fs.writeFileSync(path.join(stubBin, 'uname'), '#!/bin/sh\nprintf "Linux\\n"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(stubBin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    result = run();
    assert.equal(result.status, 0, result.stderr);
    const unit = path.join(home, '.config/systemd/user/openclaw-memory-daemon.service');
    assert.match(fs.readFileSync(unit, 'utf8'),
      /^Environment=LLM_BASE_URL=http:\/\/192\.168\.64\.1:11434$/m);

    fs.writeFileSync(path.join(stubBin, 'uname'), '#!/bin/sh\nprintf "Other\\n"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(stubBin, 'pm2'),
      '#!/bin/sh\nif [ "$1" = start ]; then printf "%s\\n" "$OPENCLAW_WORKSPACE" "$LLM_BASE_URL" "$TZ" > "$HOME/pm2.env"; fi\n',
      { mode: 0o755 });
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(path.join(home, 'pm2.env'), 'utf8').trim().split('\n'),
      [workspace, 'http://192.168.64.1:11434', 'America/Montreal']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
