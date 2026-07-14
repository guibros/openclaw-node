// 2.4 / D11: a grappe worker is a harness-loaded OpenClaw, not a bare LLM call. These
// tests exercise the REAL buildCirclingPrompt (not a reimplementation) and assert the
// circling worker prompt now carries the node's harness context — specifically the
// long-term memory, which it previously injected nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// WORKSPACE is captured at module load, so set MESH_WORKSPACE before requiring.
const ws = mkdtempSync(join(tmpdir(), 'mesh-ws-'));
writeFileSync(join(ws, 'MEMORY.md'), '- [Test memory](t.md) — the node remembers project ACME-42.');
process.env.MESH_WORKSPACE = ws;
process.env.MESH_MEMORY_RECALL = 'off'; // force the deterministic MEMORY.md fallback (this host has a live inject-server)

const require = createRequire(import.meta.url);
const { buildCirclingPrompt } = require('../bin/mesh-agent.js');

test('circling worker prompt injects the node long-term memory', () => {
  const task = { title: 'Harden the spec', scope: [], role: null };
  const prompt = buildCirclingPrompt(task, { circling_phase: 'init', circling_step: 0, my_role: 'worker' });
  assert.match(prompt, /Node memory \(long-term/, 'memory section header present');
  assert.match(prompt, /ACME-42/, 'the actual memory content is injected');
});

test('circling reviewer prompt is also harness-loaded (memory present)', () => {
  const task = { title: 'Harden the spec', scope: [], role: null };
  const prompt = buildCirclingPrompt(task, { circling_phase: 'finalization', circling_step: 0, my_role: 'reviewer' });
  assert.match(prompt, /ACME-42/);
});

test('directed input still follows the injected harness context', () => {
  const task = { title: 'X', scope: [], role: null };
  const prompt = buildCirclingPrompt(task, {
    circling_phase: 'circling', circling_step: 1, circling_subround: 1, my_role: 'reviewer',
    directed_input: 'THE-WORK-ARTIFACT-TO-REVIEW',
  });
  assert.ok(prompt.indexOf('ACME-42') < prompt.indexOf('THE-WORK-ARTIFACT-TO-REVIEW'),
    'harness memory is injected before the directed input material');
});
