import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_TAIL_COUNT,
  loadCheckpoint,
  saveCheckpoint,
  runExtraction,
} from '../bin/extract-existing-sessions.mjs';

// ─── Helpers ──────────────────────────────────────────────────

function createTestDir() {
  const dir = join(tmpdir(), `extract-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSessionDb(dbPath, sessions) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      start_time TEXT,
      message_count INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      turn_index INTEGER NOT NULL
    );
  `);

  const insertSession = db.prepare(
    'INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, ?, ?, ?)'
  );
  const insertMessage = db.prepare(
    'INSERT INTO messages (session_id, role, content, turn_index) VALUES (?, ?, ?, ?)'
  );

  for (const s of sessions) {
    insertSession.run(s.id, s.source || 'test', s.startTime || new Date().toISOString(), s.messages.length);
    for (let i = 0; i < s.messages.length; i++) {
      insertMessage.run(s.id, s.messages[i].role, s.messages[i].content, i);
    }
  }

  db.close();
}

function createMockLlmClient(results) {
  let callCount = 0;
  return {
    generate: async (messages, opts) => {
      const result = results[callCount] || results[results.length - 1];
      callCount++;
      return { content: JSON.stringify(result), usage: null, finishReason: 'stop' };
    },
    healthCheck: async () => ({ ok: true, model: 'test-model', models: ['test-model'], error: null }),
    getCallCount: () => callCount,
  };
}

const VALID_EXTRACTION = {
  entities: [{ name: 'TestProject', type: 'project', salience: 0.8 }],
  themes: [{ label: 'testing', hierarchy: ['software', 'testing'] }],
  actions: ['implementing'],
  decisions: [{ decision: 'Use mock DB', rationale: 'Simpler testing', confidence: 0.9 }],
  friction_signals: [],
  relationships: [],
};

function createMockExtractionStore() {
  const stored = [];
  return {
    storeExtractionResult: (sessionId, result) => {
      stored.push({ sessionId, result });
    },
    close: () => {},
    getStored: () => stored,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe('DEFAULT_TAIL_COUNT', () => {
  it('should be 20 per Block 3 carry-forward', () => {
    assert.equal(DEFAULT_TAIL_COUNT, 20);
  });
});

describe('loadCheckpoint', () => {
  it('returns empty state for missing file', () => {
    const cp = loadCheckpoint('/nonexistent/path.json');
    assert.deepEqual(cp.completed, []);
    assert.deepEqual(cp.failed, []);
    assert.equal(cp.startedAt, null);
  });
});

describe('runExtraction', () => {
  let testDir;

  beforeEach(() => {
    testDir = createTestDir();
  });

  it('extracts 2 sessions with mock LLM', async () => {
    const sessionDbPath = join(testDir, 'sessions.db');
    const extractionDbPath = join(testDir, 'extraction.db');
    const checkpointPath = join(testDir, 'checkpoint.json');

    createSessionDb(sessionDbPath, [
      {
        id: 'session-1',
        messages: [
          { role: 'user', content: 'How do I set up NATS JetStream?' },
          { role: 'assistant', content: 'You can configure JetStream with a simple config file.' },
        ],
      },
      {
        id: 'session-2',
        messages: [
          { role: 'user', content: 'What embedding model should we use?' },
          { role: 'assistant', content: 'BGE-M3 is a good choice for multilingual content.' },
        ],
      },
    ]);

    const mockClient = createMockLlmClient([VALID_EXTRACTION]);
    const mockStore = createMockExtractionStore();

    const result = await runExtraction({
      sessionDbPath,
      extractionDbPath,
      checkpointPath,
      llmClient: mockClient,
      extractionStore: mockStore,
      extractFn: async (client, messages) => {
        const res = await client.generate(messages, { jsonMode: true });
        return JSON.parse(res.content);
      },
      skipNotes: true,
      skipGraph: true,
    });

    assert.equal(result.processed, 2);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.total, 2);
    assert.equal(mockStore.getStored().length, 2);
    assert.equal(mockStore.getStored()[0].sessionId, 'session-1');
    assert.equal(mockStore.getStored()[1].sessionId, 'session-2');
  });

  it('resumes from checkpoint (skips completed sessions)', async () => {
    const sessionDbPath = join(testDir, 'sessions.db');
    const extractionDbPath = join(testDir, 'extraction.db');
    const checkpointPath = join(testDir, 'checkpoint.json');

    createSessionDb(sessionDbPath, [
      {
        id: 'session-1',
        messages: [{ role: 'user', content: 'First session' }],
      },
      {
        id: 'session-2',
        messages: [{ role: 'user', content: 'Second session' }],
      },
    ]);

    // Pre-populate checkpoint with session-1 already completed
    saveCheckpoint(checkpointPath, {
      completed: ['session-1'],
      failed: [],
      startedAt: new Date().toISOString(),
    });

    const mockClient = createMockLlmClient([VALID_EXTRACTION]);
    const mockStore = createMockExtractionStore();

    const result = await runExtraction({
      sessionDbPath,
      extractionDbPath,
      checkpointPath,
      llmClient: mockClient,
      extractionStore: mockStore,
      extractFn: async (client, messages) => {
        const res = await client.generate(messages, { jsonMode: true });
        return JSON.parse(res.content);
      },
      skipNotes: true,
      skipGraph: true,
    });

    assert.equal(result.processed, 1, 'should only process session-2');
    assert.equal(result.skipped, 1, 'should skip session-1');
    assert.equal(mockStore.getStored().length, 1);
    assert.equal(mockStore.getStored()[0].sessionId, 'session-2');
  });

  it('handles empty session store', async () => {
    const sessionDbPath = join(testDir, 'sessions.db');
    const extractionDbPath = join(testDir, 'extraction.db');
    const checkpointPath = join(testDir, 'checkpoint.json');

    createSessionDb(sessionDbPath, []);

    const mockClient = createMockLlmClient([VALID_EXTRACTION]);
    const mockStore = createMockExtractionStore();

    const result = await runExtraction({
      sessionDbPath,
      extractionDbPath,
      checkpointPath,
      llmClient: mockClient,
      extractionStore: mockStore,
      extractFn: async () => VALID_EXTRACTION,
      skipNotes: true,
      skipGraph: true,
    });

    assert.equal(result.total, 0);
    assert.equal(result.processed, 0);
  });

  it('skips sessions with zero messages', async () => {
    const sessionDbPath = join(testDir, 'sessions.db');
    const extractionDbPath = join(testDir, 'extraction.db');
    const checkpointPath = join(testDir, 'checkpoint.json');

    createSessionDb(sessionDbPath, [
      { id: 'empty-session', messages: [] },
      {
        id: 'real-session',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    ]);

    const mockClient = createMockLlmClient([VALID_EXTRACTION]);
    const mockStore = createMockExtractionStore();

    const result = await runExtraction({
      sessionDbPath,
      extractionDbPath,
      checkpointPath,
      llmClient: mockClient,
      extractionStore: mockStore,
      extractFn: async () => VALID_EXTRACTION,
      skipNotes: true,
      skipGraph: true,
    });

    assert.equal(result.processed, 1, 'should process real-session');
    assert.equal(result.skipped, 1, 'should skip empty-session');
    assert.equal(mockStore.getStored().length, 1);
    assert.equal(mockStore.getStored()[0].sessionId, 'real-session');
  });

  it('continues on LLM failure for individual session (does not abort)', async () => {
    const sessionDbPath = join(testDir, 'sessions.db');
    const extractionDbPath = join(testDir, 'extraction.db');
    const checkpointPath = join(testDir, 'checkpoint.json');

    createSessionDb(sessionDbPath, [
      {
        id: 'fail-session',
        messages: [{ role: 'user', content: 'This will fail' }],
      },
      {
        id: 'ok-session',
        messages: [{ role: 'user', content: 'This will succeed' }],
      },
    ]);

    let callIdx = 0;
    const extractFn = async (client, messages) => {
      callIdx++;
      if (callIdx === 1) throw new Error('LLM timeout');
      return VALID_EXTRACTION;
    };

    const mockClient = createMockLlmClient([VALID_EXTRACTION]);
    const mockStore = createMockExtractionStore();

    const result = await runExtraction({
      sessionDbPath,
      extractionDbPath,
      checkpointPath,
      llmClient: mockClient,
      extractionStore: mockStore,
      extractFn,
      skipNotes: true,
      skipGraph: true,
    });

    assert.equal(result.processed, 1, 'second session should succeed');
    assert.equal(result.failed, 1, 'first session should be recorded as failed');
    assert.equal(result.total, 2);

    // Check checkpoint recorded the failure
    const cp = loadCheckpoint(checkpointPath);
    assert.ok(cp.failed.includes('fail-session'));
    assert.ok(cp.completed.includes('ok-session'));
  });

  it('returns zero results when session DB does not exist', async () => {
    const result = await runExtraction({
      sessionDbPath: join(testDir, 'nonexistent.db'),
      extractionDbPath: join(testDir, 'extraction.db'),
      checkpointPath: join(testDir, 'checkpoint.json'),
      llmClient: createMockLlmClient([VALID_EXTRACTION]),
      skipNotes: true,
      skipGraph: true,
    });

    assert.equal(result.total, 0);
    assert.equal(result.processed, 0);
  });

  it('uses tail of correct length', async () => {
    const sessionDbPath = join(testDir, 'sessions.db');
    const extractionDbPath = join(testDir, 'extraction.db');
    const checkpointPath = join(testDir, 'checkpoint.json');

    // Create a session with 30 messages
    const messages = [];
    for (let i = 0; i < 30; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
    }
    createSessionDb(sessionDbPath, [{ id: 'long-session', messages }]);

    let capturedTail = null;
    const extractFn = async (client, tail) => {
      capturedTail = tail;
      return VALID_EXTRACTION;
    };

    const mockStore = createMockExtractionStore();

    await runExtraction({
      sessionDbPath,
      extractionDbPath,
      checkpointPath,
      tailCount: 10,
      llmClient: createMockLlmClient([VALID_EXTRACTION]),
      extractionStore: mockStore,
      extractFn,
      skipNotes: true,
      skipGraph: true,
    });

    assert.equal(capturedTail.length, 10, 'should only pass last 10 messages');
    assert.equal(capturedTail[0].content, 'Message 20', 'first tail message should be Message 20');
    assert.equal(capturedTail[9].content, 'Message 29', 'last tail message should be Message 29');
  });
});
