#!/usr/bin/env node

/**
 * llm-providers.test.js — Unit tests for LLM provider resolution.
 * Uses node:test (no external deps). Run: node test/llm-providers.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveProvider, resolveModel, PROVIDERS } = require('../lib/llm-providers');

describe('resolveProvider', () => {
  it('task.llm_provider takes priority over env and CLI', () => {
    const provider = resolveProvider({ llm_provider: 'shell' }, 'openai', 'gemini');
    assert.equal(provider.name, 'shell');
  });

  it('env takes priority over CLI when task has no provider', () => {
    const provider = resolveProvider(null, 'openai', 'shell');
    assert.equal(provider.name, 'shell');
  });

  it('env takes priority over CLI when task.llm_provider is null', () => {
    const provider = resolveProvider({ llm_provider: null }, 'openai', 'shell');
    assert.equal(provider.name, 'shell');
  });

  it('CLI takes priority over default when task and env are null', () => {
    const provider = resolveProvider(null, 'openai', null);
    assert.equal(provider.name, 'openai');
  });

  it('defaults to claude when everything is null', () => {
    const provider = resolveProvider(null, null, null);
    assert.equal(provider.name, 'claude');
  });

  it('defaults to claude with empty task object', () => {
    const provider = resolveProvider({}, null, null);
    assert.equal(provider.name, 'claude');
  });

  it('throws on unknown provider', () => {
    assert.throws(
      () => resolveProvider({ llm_provider: 'nonexistent' }, null, null),
      /Unknown LLM provider.*nonexistent/,
    );
  });

  it('resolves all built-in providers', () => {
    for (const name of ['claude', 'openai', 'gemini', 'deepseek', 'shell', 'ollama', 'aider']) {
      const provider = resolveProvider({ llm_provider: name }, null, null);
      assert.equal(provider.name, name);
    }
  });
});

describe('resolveModel', () => {
  it('task.llm_model takes priority over CLI and default', () => {
    const provider = PROVIDERS.claude;
    const model = resolveModel({ llm_model: 'opus' }, 'sonnet', provider);
    assert.equal(model, 'opus');
  });

  it('CLI model takes priority over default when task has no model', () => {
    const provider = PROVIDERS.claude;
    const model = resolveModel(null, 'haiku', provider);
    assert.equal(model, 'haiku');
  });

  it('falls back to provider default when no model specified', () => {
    const provider = PROVIDERS.claude;
    const model = resolveModel(null, null, provider);
    assert.equal(model, 'sonnet');
  });

  it('shell provider has null default model', () => {
    const provider = PROVIDERS.shell;
    const model = resolveModel(null, null, provider);
    assert.equal(model, null);
  });

  it('task model override works with shell provider', () => {
    const provider = PROVIDERS.shell;
    const model = resolveModel({ llm_model: 'custom' }, null, provider);
    assert.equal(model, 'custom');
  });
});

describe('shell provider buildArgs', () => {
  it('uses task.description as command, not prompt', () => {
    const provider = PROVIDERS.shell;
    const task = { description: 'uname -a' };
    const args = provider.buildArgs('some prompt', null, task);
    assert.deepEqual(args, ['-c', 'uname -a']);
  });

  it('falls back to prompt when task.description is empty', () => {
    const provider = PROVIDERS.shell;
    const args = provider.buildArgs('echo hello', null, {});
    assert.deepEqual(args, ['-c', 'echo hello']);
  });
});
