import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../workspace-bin/archive-transcripts.sh');

test('real archive filters transcripts, updates existing copies and retains removed sources', t => {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-archive-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = join(home, '.claude/projects/project with spaces/nested');
  const sessions = join(home, '.openclaw/agents/main/sessions');
  mkdirSync(project, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const claude = join(project, 'conversation.jsonl');
  const gateway = join(sessions, 'session.jsonl');
  const unrelated = join(project, 'settings.json');
  writeFileSync(claude, '{"text":"bonjour"}\n');
  writeFileSync(gateway, '{"text":"gateway"}\n');
  writeFileSync(unrelated, '{"retain":"source only"}\n');
  const run = () => {
    const result = spawnSync('/bin/sh', [script], {
      env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/local/bin' },
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  run();
  const archive = join(home, '.openclaw/transcript-archive');
  const savedClaude = join(archive, 'claude-projects/project with spaces/nested/conversation.jsonl');
  const savedGateway = join(archive, 'gateway-sessions/session.jsonl');
  assert.equal(readFileSync(savedClaude, 'utf8'), readFileSync(claude, 'utf8'));
  assert.equal(readFileSync(savedGateway, 'utf8'), readFileSync(gateway, 'utf8'));
  assert.equal(existsSync(join(archive, 'claude-projects/project with spaces/nested/settings.json')), false);
  assert.equal(readFileSync(unrelated, 'utf8'), '{"retain":"source only"}\n');
  writeFileSync(claude, '{"text":"bonjour"}\n{"text":"updated transcript"}\n');
  run();
  assert.equal(readFileSync(savedClaude, 'utf8'), readFileSync(claude, 'utf8'));
  unlinkSync(claude);
  unlinkSync(gateway);
  run();
  assert.equal(readFileSync(savedClaude, 'utf8'), '{"text":"bonjour"}\n{"text":"updated transcript"}\n');
  assert.equal(readFileSync(savedGateway, 'utf8'), '{"text":"gateway"}\n');
  const lines = readFileSync(join(archive, 'archive.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) assert.match(line, /archived ok — 2 transcripts,/);
});
