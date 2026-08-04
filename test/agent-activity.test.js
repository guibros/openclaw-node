#!/usr/bin/env node

/**
 * agent-activity.test.js — Unit tests for lib/agent-activity.js
 *
 * Tests path encoding, JSONL parsing, activity state detection, cost extraction.
 *
 * Run: node --test test/agent-activity.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  toClaudeProjectPath,
  getActivityState,
  getSessionInfo,
  findLatestSessionFile,
} = require('../lib/agent-activity');

describe('toClaudeProjectPath', () => {
  it('encodes standard Unix path', () => {
    assert.equal(toClaudeProjectPath('/tmp/mesh-agent-work'), '-tmp-mesh-agent-work');
  });

  it('encodes path with dots', () => {
    assert.equal(toClaudeProjectPath('/Users/dev/.worktrees/ao'), '-Users-dev--worktrees-ao');
  });

  it('strips colons (Windows-style paths)', () => {
    assert.equal(toClaudeProjectPath('C:/Users/dev/project'), 'C-Users-dev-project');
  });

  it('handles backslash normalization', () => {
    assert.equal(toClaudeProjectPath('C:\\Users\\dev\\project'), 'C-Users-dev-project');
  });

  it('encodes consecutive dots and slashes', () => {
    const encoded = toClaudeProjectPath('/home/user/../project');
    assert.ok(!encoded.includes('/'));
    assert.ok(!encoded.includes('.'));
  });
});

describe('findLatestSessionFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-activity-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for empty directory', async () => {
    assert.equal(await findLatestSessionFile(tmpDir), null);
  });

  it('returns null for nonexistent directory', async () => {
    assert.equal(await findLatestSessionFile('/nonexistent/path'), null);
  });

  it('finds .jsonl file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'session.jsonl'), '{"type":"user"}\n');
    const result = await findLatestSessionFile(tmpDir);
    assert.ok(result.endsWith('session.jsonl'));
  });

  it('excludes agent-*.jsonl files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'agent-internal.jsonl'), '{"type":"system"}\n');
    assert.equal(await findLatestSessionFile(tmpDir), null);
  });

  it('returns most recently modified file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'old.jsonl'), '{"type":"user"}\n');
    // Force different mtime
    const oldTime = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(tmpDir, 'old.jsonl'), oldTime, oldTime);
    fs.writeFileSync(path.join(tmpDir, 'new.jsonl'), '{"type":"assistant"}\n');
    const result = await findLatestSessionFile(tmpDir);
    assert.ok(result.endsWith('new.jsonl'));
  });
});

describe('getActivityState', () => {
  let tmpDir, projectDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-state-test-'));
    // Create a fake Claude project dir structure
    projectDir = path.join(tmpDir, '.claude', 'projects', '-fake-workspace');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns starting when no JSONL exists', async () => {
    // Override HOME to empty dir so no project dir found
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const state = await getActivityState('/nonexistent/workspace');
    process.env.HOME = origHome;
    assert.equal(state.state, 'starting');
  });
});

describe('getSessionInfo', () => {
  let tmpDir, projectDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-info-test-'));
    projectDir = path.join(tmpDir, '.claude', 'projects', '-fake-workspace');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns nulls when no session file exists', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const info = await getSessionInfo('/nonexistent/workspace');
    process.env.HOME = origHome;
    assert.equal(info.summary, null);
    assert.equal(info.cost, null);
  });

  it('extracts summary from JSONL', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const sessionFile = path.join(projectDir, 'test-session.jsonl');
    const lines = [
      '{"type":"user","message":{"content":"Fix the auth bug"}}',
      '{"type":"assistant","message":{"content":"Done"}}',
      '{"type":"summary","summary":"Fixed authentication issue in login flow"}',
    ];
    fs.writeFileSync(sessionFile, lines.join('\n') + '\n');
    const info = await getSessionInfo('/fake/workspace');
    process.env.HOME = origHome;
    assert.equal(info.summary, 'Fixed authentication issue in login flow');
  });

  it('extracts cost from usage data', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const sessionFile = path.join(projectDir, 'cost-session.jsonl');
    const lines = [
      '{"type":"user","message":{"content":"test"}}',
      '{"type":"assistant","usage":{"input_tokens":1000,"output_tokens":500},"model":"claude-sonnet-4"}',
    ];
    fs.writeFileSync(sessionFile, lines.join('\n') + '\n');
    const info = await getSessionInfo('/fake/workspace');
    process.env.HOME = origHome;
    assert.ok(info.cost);
    assert.equal(info.cost.inputTokens, 1000);
    assert.equal(info.cost.outputTokens, 500);
    assert.ok(info.cost.estimatedCostUsd > 0);
  });

  it('extracts cost from the real nested shape — message.usage + message.model (D14 regression: flat-only reads summed to zero and every task reported cost:null)', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const sessionFile = path.join(projectDir, 'nested-session.jsonl');
    const lines = [
      '{"type":"user","message":{"content":"test"}}',
      '{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10,"output_tokens":200,"cache_read_input_tokens":100000,"cache_creation_input_tokens":5000}}}',
      '{"type":"assistant","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":5,"output_tokens":100,"cache_read_input_tokens":50000,"cache_creation_input_tokens":0}}}',
    ];
    fs.writeFileSync(sessionFile, lines.join('\n') + '\n');
    const info = await getSessionInfo('/fake/workspace');
    process.env.HOME = origHome;
    assert.ok(info.cost, 'nested usage must produce a cost record');
    assert.equal(info.cost.inputTokens, 10 + 5 + 100000 + 50000 + 5000);
    assert.equal(info.cost.outputTokens, 300);
    // Cache-aware estimate: fresh 15 @ $3/M + reads 150k @ $0.30/M + creation
    // 5k @ $3.75/M + out 300 @ $15/M — cache reads must NOT bill at full rate.
    const expected = (15 / 1e6) * 3.0 + (150000 / 1e6) * 0.30 + (5000 / 1e6) * 3.75 + (300 / 1e6) * 15.0;
    assert.ok(Math.abs(info.cost.estimatedCostUsd - expected) < 1e-9,
      `estimated ${info.cost.estimatedCostUsd} != expected ${expected}`);
  });

  it('extracts cost from costUSD field', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const sessionFile = path.join(projectDir, 'direct-cost.jsonl');
    const lines = [
      '{"type":"user","message":{"content":"test"}}',
      '{"type":"assistant","costUSD":0.05,"usage":{"input_tokens":500,"output_tokens":200}}',
    ];
    fs.writeFileSync(sessionFile, lines.join('\n') + '\n');
    const info = await getSessionInfo('/fake/workspace');
    process.env.HOME = origHome;
    assert.equal(info.cost.estimatedCostUsd, 0.05);
  });

  it('falls back to user message for summary', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const sessionFile = path.join(projectDir, 'fallback.jsonl');
    const lines = [
      '{"type":"user","message":{"content":"Fix the login page CSS"}}',
      '{"type":"assistant","message":{"content":"Done"}}',
    ];
    fs.writeFileSync(sessionFile, lines.join('\n') + '\n');
    const info = await getSessionInfo('/fake/workspace');
    process.env.HOME = origHome;
    assert.equal(info.summary, 'Fix the login page CSS');
  });
});
