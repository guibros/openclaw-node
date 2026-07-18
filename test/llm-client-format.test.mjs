import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useJsonFormat } from '../lib/llm-client.mjs';
import { buildExtractionPrompt, parseWithPrimer } from '../lib/extraction-prompt.mjs';

// Locks the format:"json" decision that killed extraction for 45h
// (audits/extraction_stall): thinking-family models must never get the JSON
// grammar; everything else keeps it unless the operator forces free-form.

test('thinking families never get format:json', () => {
  for (const m of ['qwen3:8b', 'qwen3:14b', 'Qwen3:8B', 'deepseek-r1:7b', 'magistral:latest', 'gpt-oss:20b']) {
    assert.equal(useJsonFormat(m, {}), false, m);
  }
});

test('non-thinking models keep format:json', () => {
  for (const m of ['llama3.1:8b', 'mistral:7b', 'gemma3:4b', 'phi4:latest']) {
    assert.equal(useJsonFormat(m, {}), true, m);
  }
});

test('LLM_FORCE_FREE_FORM=1 disables format:json for every model', () => {
  const env = { LLM_FORCE_FREE_FORM: '1' };
  assert.equal(useJsonFormat('llama3.1:8b', env), false);
  assert.equal(useJsonFormat('qwen3:8b', env), false);
});

test('family match is prefix-anchored, not substring', () => {
  assert.equal(useJsonFormat('my-qwen3-finetune', {}), true);
});

test('jsonPrimer appends a trailing assistant "{" turn; default does not', () => {
  const msgs = [{ role: 'user', content: 'hello' }];
  const plain = buildExtractionPrompt(msgs);
  assert.notEqual(plain[plain.length - 1].role, 'assistant');
  const primed = buildExtractionPrompt(msgs, { jsonPrimer: true });
  assert.deepEqual(primed[primed.length - 1], { role: 'assistant', content: '{' });
});

test('parseWithPrimer restores the consumed brace only when primed', () => {
  const continuation = '"entities": [], "themes": [], "decisions": []}';
  assert.deepEqual(parseWithPrimer(continuation, true), { entities: [], themes: [], decisions: [] });
  assert.throws(() => parseWithPrimer(continuation, false));
  const echoed = '{"entities": []}';
  assert.deepEqual(parseWithPrimer(echoed, true), { entities: [] });
});
