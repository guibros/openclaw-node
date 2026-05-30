import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryEvent } from '../lib/local-event-log.mjs';
import { toWatcherRecord, classifyStatus } from '../lib/memory-watcher.mjs';

describe('toWatcherRecord', () => {
  it('extracts flat record from memory.ingested event', () => {
    const event = buildMemoryEvent('memory.ingested', 'sess-abc', 'memory', {
      session_id: 'sess-abc',
      source: 'claude-code',
      messages_added: 12,
      total_messages: 12,
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.ts, event.timestamp);
    assert.equal(record.op, 'memory.ingested');
    assert.equal(record.actor, 'daemon-daedalus');
    assert.equal(record.session, 'sess-abc');
    assert.equal(record.duration_ms, null);
    assert.equal(record.status, 'ok');
  });

  it('extracts duration_ms from memory.extracted event', () => {
    const event = buildMemoryEvent('memory.extracted', 'sess-xyz', 'memory', {
      session_id: 'sess-xyz',
      entities_count: 5,
      themes_count: 2,
      mentions_count: 8,
      decisions_count: 1,
      model: 'qwen3:8b',
      duration_ms: 4200,
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.op, 'memory.extracted');
    assert.equal(record.session, 'sess-xyz');
    assert.equal(record.duration_ms, 4200);
    assert.equal(record.status, 'ok');
  });

  it('handles memory.error with missing session_id', () => {
    const event = buildMemoryEvent('memory.error', 'unknown', 'memory', {
      boundary: 'ingest',
      error_code: 'TypeError',
      error_message: 'something broke',
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.op, 'memory.error');
    assert.equal(record.session, null);
    assert.equal(record.duration_ms, null);
    assert.equal(record.status, 'error');
  });

  it('handles memory.retrieved with duration_ms', () => {
    const event = buildMemoryEvent('memory.retrieved', 'req-123', 'memory', {
      query_hash: 'abc',
      channels_hit: ['fts', 'vec'],
      results_count: 7,
      duration_ms: 150,
    }, 'daedalus');
    const record = toWatcherRecord(event);
    assert.equal(record.op, 'memory.retrieved');
    assert.equal(record.session, null);
    assert.equal(record.duration_ms, 150);
    assert.equal(record.status, 'ok');
  });
});

describe('classifyStatus', () => {
  it('classifies memory.error as error', () => {
    const event = buildMemoryEvent('memory.error', 'x', 'memory', {
      boundary: 'extract',
      error_code: 'Zod',
      error_message: 'validation failed',
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'error');
  });

  it('classifies memory.ingested with messages_added=0 as noop', () => {
    const event = buildMemoryEvent('memory.ingested', 's1', 'memory', {
      session_id: 's1',
      source: 'claude-code',
      messages_added: 0,
      total_messages: 50,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.ingested with messages_added>0 as ok', () => {
    const event = buildMemoryEvent('memory.ingested', 's1', 'memory', {
      session_id: 's1',
      source: 'claude-code',
      messages_added: 5,
      total_messages: 55,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.extracted with all counts=0 as noop', () => {
    const event = buildMemoryEvent('memory.extracted', 's2', 'memory', {
      session_id: 's2',
      entities_count: 0,
      themes_count: 0,
      mentions_count: 0,
      decisions_count: 0,
      model: 'qwen3:8b',
      duration_ms: 3000,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.extracted with some counts>0 as ok', () => {
    const event = buildMemoryEvent('memory.extracted', 's2', 'memory', {
      session_id: 's2',
      entities_count: 0,
      themes_count: 1,
      mentions_count: 0,
      decisions_count: 0,
      model: 'qwen3:8b',
      duration_ms: 3000,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.retrieved with results_count=0 as noop', () => {
    const event = buildMemoryEvent('memory.retrieved', 'r1', 'memory', {
      query_hash: 'abc',
      channels_hit: 0,
      results_count: 0,
      duration_ms: 50,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.injected with blocks_count=0 as noop', () => {
    const event = buildMemoryEvent('memory.injected', 'r1', 'memory', {
      request_id: 'req-1',
      token_count: 0,
      blocks_count: 0,
      duration_ms: 10,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.injected with blocks_count>0 as ok', () => {
    const event = buildMemoryEvent('memory.injected', 'r1', 'memory', {
      request_id: 'req-1',
      token_count: 500,
      blocks_count: 3,
      duration_ms: 80,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.synthesized with empty artifacts as noop', () => {
    const event = buildMemoryEvent('memory.synthesized', 'syn1', 'memory', {
      trigger: 'session_end',
      artifacts_written: [],
      duration_ms: 200,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.synthesized with artifacts as ok', () => {
    const event = buildMemoryEvent('memory.synthesized', 'syn1', 'memory', {
      trigger: 'session_end',
      artifacts_written: ['MEMORY.md', 'sessions/2026-05-29.md'],
      duration_ms: 200,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('classifies memory.decayed with entities_decayed=0 as noop', () => {
    const event = buildMemoryEvent('memory.decayed', 'd1', 'memory', {
      entities_decayed: 0,
      duration_ms: 100,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'noop');
  });

  it('classifies memory.promoted with entities_promoted>0 as ok', () => {
    const event = buildMemoryEvent('memory.promoted', 'p1', 'memory', {
      entities_promoted: 3,
      duration_ms: 150,
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });

  it('defaults to ok for unknown event types', () => {
    const event = buildMemoryEvent('memory.session_started', 'sess', 'memory', {
      session_id: 'sess',
      start_time: new Date().toISOString(),
    }, 'daedalus');
    assert.equal(classifyStatus(event), 'ok');
  });
});
