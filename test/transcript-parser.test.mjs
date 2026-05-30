/**
 * transcript-parser.test.mjs — Unit tests for lib/transcript-parser.mjs
 *
 * Covers: extractContent (string + array-of-blocks), detectFormat (claude-code
 * vs openclaw-gateway), parseLine for each format (with auto-detect),
 * parseJsonlFile (auto-detect, explicit format, tail option, malformed lines),
 * estimateFileTokens, listFormats, registerFormat (custom adapter).
 *
 * Run: node --test test/transcript-parser.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractContent,
  detectFormat,
  parseLine,
  parseJsonlFile,
  estimateFileTokens,
  listFormats,
  registerFormat,
} from '../lib/transcript-parser.mjs';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'transcript-parser-test-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

function writeJsonl(name, entries) {
  const path = join(TMP, name);
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return path;
}

// ─── extractContent ─────────────────────────────────────────────────────────

describe('extractContent', () => {
  it('returns empty string for null / undefined message', () => {
    assert.equal(extractContent(null), '');
    assert.equal(extractContent(undefined), '');
  });

  it('returns string content as-is', () => {
    assert.equal(extractContent({ content: 'hello' }), 'hello');
  });

  it('joins text blocks from array content', () => {
    const message = {
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
        { type: 'tool_use', name: 'X' },     // should be skipped
        { type: 'text', text: 'third' },
      ],
    };
    assert.equal(extractContent(message), 'first\nsecond\nthird');
  });

  it('handles missing text field in array blocks', () => {
    const message = { content: [{ type: 'text' }, { type: 'text', text: 'real' }] };
    assert.equal(extractContent(message), '\nreal');
  });

  it('returns empty string for unsupported content shape', () => {
    assert.equal(extractContent({ content: 42 }), '');
    assert.equal(extractContent({ content: { obj: 'shape' } }), '');
  });
});

// ─── detectFormat ───────────────────────────────────────────────────────────

describe('detectFormat', () => {
  it('returns "auto" for missing files', async () => {
    assert.equal(await detectFormat(join(TMP, 'does-not-exist.jsonl')), 'auto');
  });

  it('detects claude-code format from type:user/assistant entries', async () => {
    const path = writeJsonl('cc.jsonl', [
      { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'hello' }, usage: { input_tokens: 1 } },
    ]);
    assert.equal(await detectFormat(path), 'claude-code');
  });

  it('detects openclaw-gateway format from type:message + metadata entries', async () => {
    const path = writeJsonl('og.jsonl', [
      { type: 'session', meta: 'start' },
      { type: 'message', message: { role: 'user', content: 'hi' } },
      { type: 'model_change', model: 'qwen3:8b' },
      { type: 'message', message: { role: 'assistant', content: 'hello' } },
    ]);
    assert.equal(await detectFormat(path), 'openclaw-gateway');
  });

  it('returns "auto" when format is ambiguous (no signals)', async () => {
    const path = writeJsonl('amb.jsonl', [{ random: 'data' }, { other: 'shape' }]);
    assert.equal(await detectFormat(path), 'auto');
  });
});

// ─── parseLine ──────────────────────────────────────────────────────────────

describe('parseLine', () => {
  it('parses claude-code format user entry', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      timestamp: '2026-01-01T00:00:00Z',
    });
    const msg = parseLine(line, { format: 'claude-code' });
    assert.ok(msg);
    assert.equal(msg.role, 'user');
    assert.equal(msg.content, 'hello');
    assert.equal(msg.timestamp, '2026-01-01T00:00:00Z');
  });

  it('parses claude-code assistant with metadata', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'reply' }] },
      usage: { input_tokens: 5, output_tokens: 3 },
      model: 'claude-opus',
    });
    const msg = parseLine(line, { format: 'claude-code' });
    assert.equal(msg.role, 'assistant');
    assert.equal(msg.content, 'reply');
    assert.deepEqual(msg.metadata.usage, { input_tokens: 5, output_tokens: 3 });
    assert.equal(msg.metadata.model, 'claude-opus');
  });

  it('parses openclaw-gateway message', () => {
    const line = JSON.stringify({
      type: 'message',
      message: { role: 'user', content: 'hi' },
    });
    const msg = parseLine(line, { format: 'openclaw-gateway' });
    assert.ok(msg);
    assert.equal(msg.role, 'user');
    assert.equal(msg.content, 'hi');
  });

  it('strips gateway date-header noise from content', () => {
    const line = JSON.stringify({
      type: 'message',
      message: { role: 'user', content: '[Mon 2026-03-22 14:30 GMT-5] real content' },
    });
    const msg = parseLine(line, { format: 'openclaw-gateway' });
    assert.equal(msg.content, 'real content');
  });

  it('returns null for openclaw-gateway metadata types (session, model_change)', () => {
    for (const skipType of ['session', 'model_change', 'thinking_level_change']) {
      const line = JSON.stringify({ type: skipType, message: { role: 'user', content: 'x' } });
      const msg = parseLine(line, { format: 'openclaw-gateway' });
      assert.equal(msg, null, `${skipType} should be skipped`);
    }
  });

  it('parses gateway toolResult entry as role "tool" with metadata', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2026-02-08T10:43:48.733Z',
      message: {
        role: 'toolResult',
        toolCallId: 'read_123',
        toolName: 'read',
        content: [{ type: 'text', text: 'file contents here' }],
        isError: false,
      },
    });
    const msg = parseLine(line, { format: 'openclaw-gateway' });
    assert.ok(msg);
    assert.equal(msg.role, 'tool');
    assert.equal(msg.content, 'file contents here');
    assert.equal(msg.metadata.toolName, 'read');
    assert.equal(msg.metadata.toolCallId, 'read_123');
    assert.equal(msg.metadata.isError, false);
  });

  it('parses gateway assistant message with toolCall content blocks', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2026-02-08T10:43:12.071Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'toolCall', name: 'read', arguments: { file_path: '/tmp/test.md' } },
        ],
      },
    });
    const msg = parseLine(line, { format: 'openclaw-gateway' });
    assert.ok(msg);
    assert.equal(msg.role, 'assistant');
    assert.ok(msg.content.includes('Let me read that file.'));
    assert.ok(msg.content.includes('[tool_call: read('));
    assert.ok(msg.content.includes('/tmp/test.md'));
  });

  it('preserves gateway assistant message with ONLY toolCall content (no text)', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2026-02-08T10:43:12.071Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', name: 'exec', arguments: { command: 'ls' } },
        ],
      },
    });
    const msg = parseLine(line, { format: 'openclaw-gateway' });
    assert.ok(msg, 'tool-call-only assistant message should not be dropped');
    assert.equal(msg.role, 'assistant');
    assert.ok(msg.content.includes('[tool_call: exec('));
  });

  it('returns null for unparseable JSON', () => {
    assert.equal(parseLine('not valid json', { format: 'claude-code' }), null);
  });

  it('auto format handles either input shape', () => {
    const cc = JSON.stringify({ type: 'user', message: { content: 'a' } });
    const og = JSON.stringify({ type: 'message', message: { role: 'user', content: 'b' } });
    assert.ok(parseLine(cc, { format: 'auto' }));
    assert.ok(parseLine(og, { format: 'auto' }));
  });
});

// ─── parseJsonlFile ─────────────────────────────────────────────────────────

describe('parseJsonlFile', () => {
  it('returns empty array for missing file', async () => {
    assert.deepEqual(await parseJsonlFile(join(TMP, 'nope.jsonl')), []);
  });

  it('parses a full session with auto-detected format', async () => {
    const path = writeJsonl('full.jsonl', [
      { type: 'user', message: { content: 'q1' } },
      { type: 'assistant', message: { content: 'a1' } },
      { type: 'user', message: { content: 'q2' } },
    ]);
    const msgs = await parseJsonlFile(path);
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].content, 'q1');
    assert.equal(msgs[2].content, 'q2');
  });

  it('returns only the tail when opts.tail is set', async () => {
    const path = writeJsonl('long.jsonl', [
      { type: 'user', message: { content: 'a' } },
      { type: 'assistant', message: { content: 'b' } },
      { type: 'user', message: { content: 'c' } },
      { type: 'assistant', message: { content: 'd' } },
      { type: 'user', message: { content: 'e' } },
    ]);
    const msgs = await parseJsonlFile(path, { tail: 2 });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].content, 'd');
    assert.equal(msgs[1].content, 'e');
  });

  it('skips malformed lines and continues', async () => {
    const path = join(TMP, 'malformed.jsonl');
    writeFileSync(path,
      JSON.stringify({ type: 'user', message: { content: 'first' } }) + '\n' +
      'BROKEN LINE\n' +
      JSON.stringify({ type: 'user', message: { content: 'second' } }) + '\n'
    );
    const msgs = await parseJsonlFile(path);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].content, 'first');
    assert.equal(msgs[1].content, 'second');
  });

  it('honors explicit format option (overrides auto-detect)', async () => {
    // File looks like gateway but force claude-code parsing → entries don't match → empty result
    const path = writeJsonl('og-style.jsonl', [
      { type: 'message', message: { role: 'user', content: 'hi' } },
    ]);
    const msgs = await parseJsonlFile(path, { format: 'claude-code' });
    assert.equal(msgs.length, 0);
  });
});

// ─── estimateFileTokens ─────────────────────────────────────────────────────

describe('estimateFileTokens', () => {
  it('counts messages and estimates tokens', async () => {
    const path = writeJsonl('est.jsonl', [
      { type: 'user', message: { content: 'hello world' } },        // 11 chars
      { type: 'assistant', message: { content: 'a response' } },    // 10 chars
    ]);
    const result = await estimateFileTokens(path);
    assert.equal(result.messageCount, 2);
    assert.equal(result.totalChars, 21);
    assert.equal(result.estimatedTokens, Math.ceil(21 / 4));
  });

  it('honors custom charsPerToken', async () => {
    const path = writeJsonl('est2.jsonl', [
      { type: 'user', message: { content: 'eight!!!' } },  // 8 chars
    ]);
    const result = await estimateFileTokens(path, { charsPerToken: 2 });
    assert.equal(result.estimatedTokens, 4);
  });
});

// ─── listFormats + registerFormat ───────────────────────────────────────────

describe('format registry', () => {
  it('listFormats includes built-in formats', () => {
    const formats = listFormats();
    assert.ok(formats.includes('claude-code'));
    assert.ok(formats.includes('openclaw-gateway'));
    assert.ok(formats.includes('auto'));
  });

  it('registerFormat adds a custom adapter', () => {
    registerFormat('test-format', {
      isMessage: (entry) => entry.kind === 'msg',
      extractMessage: (entry) => ({ role: 'user', content: entry.txt, timestamp: null }),
    });
    assert.ok(listFormats().includes('test-format'));
    const line = JSON.stringify({ kind: 'msg', txt: 'hi from custom' });
    const msg = parseLine(line, { format: 'test-format' });
    assert.equal(msg.content, 'hi from custom');
  });
});
