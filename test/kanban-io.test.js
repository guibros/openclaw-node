#!/usr/bin/env node

/**
 * kanban-io.test.js — Unit tests for kanban-io parseTasks mesh routing fields.
 * Uses node:test (no external deps). Run: node test/kanban-io.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseTasks } = require('../lib/kanban-io');

function mkContent(taskBlock) {
  return `## Live Tasks\n${taskBlock}`;
}

describe('parseTasks — mesh routing fields', () => {
  it('parses llm_provider field', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t1\n  title: Test\n  status: queued\n  llm_provider: openai\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].llm_provider, 'openai');
  });

  it('parses provider as alias for llm_provider', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t2\n  title: Test\n  status: queued\n  provider: shell\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_provider, 'shell');
  });

  it('parses llm_model field', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t3\n  title: Test\n  status: queued\n  llm_model: gpt-4.1\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_model, 'gpt-4.1');
  });

  it('parses model as alias for llm_model', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t4\n  title: Test\n  status: queued\n  model: sonnet\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_model, 'sonnet');
  });

  it('parses preferred_nodes array', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t5\n  title: Test\n  status: queued\n  preferred_nodes:\n    - moltymac\n    - calos\n  updated_at: 2026-01-01'
    ));
    assert.deepEqual(tasks[0].preferred_nodes, ['moltymac', 'calos']);
  });

  it('parses exclude_nodes array', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t6\n  title: Test\n  status: queued\n  exclude_nodes:\n    - bad-node\n  updated_at: 2026-01-01'
    ));
    assert.deepEqual(tasks[0].exclude_nodes, ['bad-node']);
  });

  it('parses inline JSON collaboration spec', () => {
    const collab = JSON.stringify({ mode: 'parallel', min_nodes: 2, max_nodes: 3 });
    const tasks = parseTasks(mkContent(
      `- task_id: t7\n  title: Test\n  status: queued\n  collaboration: ${collab}\n  updated_at: 2026-01-01`
    ));
    assert.equal(tasks[0].collaboration.mode, 'parallel');
    assert.equal(tasks[0].collaboration.min_nodes, 2);
    assert.equal(tasks[0].collaboration.max_nodes, 3);
  });

  it('handles invalid JSON in collaboration gracefully', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t8\n  title: Test\n  status: queued\n  collaboration: {invalid json\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].collaboration, null);
  });

  it('defaults missing routing fields to null/empty', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t9\n  title: Test\n  status: queued\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_provider, null);
    assert.equal(tasks[0].llm_model, null);
    assert.deepEqual(tasks[0].preferred_nodes, []);
    assert.deepEqual(tasks[0].exclude_nodes, []);
    assert.equal(tasks[0].collaboration, null);
  });

  it('parses all routing fields together on one task', () => {
    const collab = JSON.stringify({ mode: 'parallel', min_nodes: 2 });
    const tasks = parseTasks(mkContent(
      `- task_id: t10\n  title: Full routing\n  status: queued\n  llm_provider: shell\n  llm_model: custom\n  preferred_nodes:\n    - node-a\n    - node-b\n  exclude_nodes:\n    - node-c\n  collaboration: ${collab}\n  updated_at: 2026-01-01`
    ));
    assert.equal(tasks[0].llm_provider, 'shell');
    assert.equal(tasks[0].llm_model, 'custom');
    assert.deepEqual(tasks[0].preferred_nodes, ['node-a', 'node-b']);
    assert.deepEqual(tasks[0].exclude_nodes, ['node-c']);
    assert.equal(tasks[0].collaboration.mode, 'parallel');
  });
});
