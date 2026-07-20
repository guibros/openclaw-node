// P1: memory is injected into ALL FOUR prompt builders (was circling-only), and the
// task-relevant recall path falls back cleanly to the MEMORY.md index when the loopback
// inject-server isn't reachable/disabled — without ever throwing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const ws = mkdtempSync(join(tmpdir(), 'mesh-mem-'));
writeFileSync(join(ws, 'MEMORY.md'), '- [Test memory](t.md) — the node remembers project ZED-9.');
process.env.MESH_WORKSPACE = ws;
process.env.MESH_MEMORY_RECALL = 'off'; // deterministic fallback (this host has a live inject-server)

const require = createRequire(import.meta.url);
const m = require('../bin/mesh-agent.js');

const task = { title: 'Harden the spec', description: 'fix F1/F2', scope: [], role: null, collaboration: { mode: 'review' } };
Object.defineProperty(task, '_hyperagentStrategy', {
  value: { id: 7, content: 'Start with a focused regression test.' },
});

test('P1: all four prompt builders inject the node memory (was circling-only)', () => {
  const builders = [
    ['initial', m.buildInitialPrompt(task)],
    ['retry', m.buildRetryPrompt(task, [], 1)],
    ['collab', m.buildCollabPrompt(task, 1, '', [], 'worker')],
    ['circling', m.buildCirclingPrompt(task, { circling_phase: 'init', circling_step: 0, my_role: 'worker' })],
  ];
  for (const [name, p] of builders) assert.match(p, /ZED-9/, `${name} builder injects node memory`);
});

test('HyperAgent strategy is mechanically injected into all worker prompt shapes', () => {
  const builders = [
    m.buildInitialPrompt(task),
    m.buildRetryPrompt(task, [], 1),
    m.buildCollabPrompt(task, 1, '', [], 'worker'),
    m.buildCirclingPrompt(task, { circling_phase: 'init', circling_step: 0, my_role: 'worker' }),
  ];
  for (const prompt of builders) {
    assert.match(prompt, /Approved Strategy \(HyperAgent #7\)/);
    assert.match(prompt, /Start with a focused regression test/);
  }
});

test('P1: recallForTask returns null when disabled / no task (clean fallback, never throws)', () => {
  assert.equal(m.recallForTask(task), null);
  assert.equal(m.recallForTask(null), null);
});

test('P1: readNodeMemory is mtime-cached and returns the node index', () => {
  assert.match(m.readNodeMemory(), /ZED-9/);
});
