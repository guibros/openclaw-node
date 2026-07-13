// 2.4 findings 6+7: thinking-stream contamination of the artifact pipeline.
// Guards: (a) ollama thinking families generate with --think=false,
// (b) captured output is sanitized before parsing, (c) unterminated thinking
// blocks yield '' so the parse-failure path fires instead of a thinking trace
// masquerading as a deliverable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripLlmOutput, buildOllamaArgs } = require('../lib/llm-providers');

test('strip removes CSI/OSC control sequences, preserves bracketed text', () => {
  const dirty = '[?25l[2K[1Ganswer with [brackets] and array[0] kept[K';
  assert.equal(stripLlmOutput(dirty), 'answer with [brackets] and array[0] kept');
});

test('strip removes a terminated thinking block, keeps the answer', () => {
  const out = stripLlmOutput('Thinking...\nlong reasoning here\nmore\n...done thinking.\n\n# Real Artifact\ncontent');
  assert.equal(out, '# Real Artifact\ncontent');
  assert.ok(!/Thinking/.test(out));
});

test('strip removes multiple thinking blocks', () => {
  const out = stripLlmOutput('Thinking...\na\n...done thinking.\nkeep1\nThinking...\nb\n...done thinking.\nkeep2');
  assert.equal(out, 'keep1\n\nkeep2');
});

test('unterminated thinking block yields empty string (forces parse-failure path)', () => {
  assert.equal(stripLlmOutput('Thinking...\ncut off mid-reasoning with no done marker'), '');
});

test('plain output passes through untouched', () => {
  assert.equal(stripLlmOutput('## Findings\n- F1 fixed\n- F2 fixed'), '## Findings\n- F1 fixed\n- F2 fixed');
});

test('empty/nullish input is returned as-is', () => {
  assert.equal(stripLlmOutput(''), '');
  assert.equal(stripLlmOutput(null), null);
});

test('buildOllamaArgs adds --think=false for thinking families only', () => {
  assert.deepEqual(buildOllamaArgs('P', 'qwen3:8b').slice(0, 2), ['run', '--think=false']);
  assert.deepEqual(buildOllamaArgs('P', 'deepseek-r1:7b').slice(0, 2), ['run', '--think=false']);
  assert.deepEqual(buildOllamaArgs('P', 'llama3'), ['run', 'llama3', 'P']);
  assert.deepEqual(buildOllamaArgs('P', null), ['run', 'llama3', 'P']);
});

test('MESH_OLLAMA_THINK=true opts back into thinking', () => {
  process.env.MESH_OLLAMA_THINK = 'true';
  try {
    assert.deepEqual(buildOllamaArgs('P', 'qwen3:8b'), ['run', 'qwen3:8b', 'P']);
  } finally {
    delete process.env.MESH_OLLAMA_THINK;
  }
});
