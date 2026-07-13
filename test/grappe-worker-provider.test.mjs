// D11: a grappe/cluster worker is the node's OpenClaw agent on an ADVANCED LLM —
// never a raw local model, and never a silent fallback. These tests pin the
// mechanical guard in lib/llm-providers.js (enforced by mesh-agent executeCollabTask).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import llm from '../lib/llm-providers.js';

const { isOpenClawWorkerProvider, resolveProvider, LOCAL_MODEL_PROVIDERS } = llm;

test('D11: local model providers are NOT valid grappe workers', () => {
  assert.equal(isOpenClawWorkerProvider('ollama'), false, 'ollama (local model) must be refused as a grappe worker');
  assert.ok(LOCAL_MODEL_PROVIDERS.has('ollama'));
});

test('D11: advanced-LLM OpenClaw frontends ARE valid grappe workers', () => {
  for (const p of ['claude', 'openai', 'gemini', 'deepseek', 'kimi', 'minimax', 'aider']) {
    assert.equal(isOpenClawWorkerProvider(p), true, `${p} should be an allowed grappe-worker provider`);
  }
});

test('D11: empty/undefined provider is refused (no silent fallback)', () => {
  assert.equal(isOpenClawWorkerProvider(''), false);
  assert.equal(isOpenClawWorkerProvider(undefined), false);
  assert.equal(isOpenClawWorkerProvider(null), false);
});

test('D11: MESH_LLM_PROVIDER=ollama resolves to ollama and is caught by the guard', () => {
  const provider = resolveProvider(null, null, 'ollama'); // env wins over cli/default
  assert.equal(provider.name, 'ollama');
  assert.equal(isOpenClawWorkerProvider(provider.name), false, 'the ollama silent-fallback case must be refused');
});

test('D11: default resolution (nothing set) is the claude OpenClaw frontend', () => {
  const provider = resolveProvider(null, null, null);
  assert.equal(provider.name, 'claude');
  assert.equal(isOpenClawWorkerProvider(provider.name), true);
});
