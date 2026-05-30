import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryEvent } from '../lib/local-event-log.mjs';
import { toWatcherRecord } from '../lib/memory-watcher.mjs';

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
  });
});
