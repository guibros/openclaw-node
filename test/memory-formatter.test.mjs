import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatConceptList,
  formatDecisionList,
  formatSnippetSummaries,
  formatMemoryBlock,
  injectIntoSystemMessage,
  extractLastUserPrompt,
  injectIntoMessages,
} from '../lib/memory-formatter.mjs';

// Also verify wrapper injection support via mock injectors
import { wrapOpenAI } from '../lib/publishers/openai-wrapper.mjs';
import { wrapAnthropic } from '../lib/publishers/anthropic-wrapper.mjs';
import { wrapGemini } from '../lib/publishers/gemini-wrapper.mjs';
import { wrapMiniMax } from '../lib/publishers/minimax-wrapper.mjs';

// ─── formatConceptList ───────────────────────────────────────────────────────

describe('formatConceptList', () => {
  it('formats concepts as comma-separated Name (type) entries', () => {
    const concepts = [
      { name: 'NATS', type: 'tool' },
      { name: 'Mesh Coordination', type: 'concept' },
    ];
    const result = formatConceptList(concepts);
    assert.equal(result, 'NATS (tool), Mesh Coordination (concept)');
  });

  it('returns empty string for empty array', () => {
    assert.equal(formatConceptList([]), '');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(formatConceptList(null), '');
    assert.equal(formatConceptList(undefined), '');
  });
});

// ─── formatDecisionList ──────────────────────────────────────────────────────

describe('formatDecisionList', () => {
  it('formats decisions as bullet list with date and confidence', () => {
    const decisions = [
      { decision: 'Use NATS over RabbitMQ', confidence: 0.95, date: '2026-02-15T10:00:00Z' },
      { decision: 'BGE-M3 for embeddings', confidence: 0.9, date: '2026-05-22T14:30:00Z' },
    ];
    const result = formatDecisionList(decisions);
    assert.ok(result.includes('- 2026-02-15: Use NATS over RabbitMQ (0.95)'));
    assert.ok(result.includes('- 2026-05-22: BGE-M3 for embeddings (0.9)'));
  });

  it('uses "unknown" for missing date', () => {
    const decisions = [{ decision: 'No date decision', confidence: 0.8, date: null }];
    const result = formatDecisionList(decisions);
    assert.ok(result.includes('unknown'));
  });

  it('returns empty string for empty array', () => {
    assert.equal(formatDecisionList([]), '');
  });
});

// ─── formatSnippetSummaries ──────────────────────────────────────────────────

describe('formatSnippetSummaries', () => {
  it('formats snippets with session ID and truncated text', () => {
    const snippets = [
      { sessionId: 'sess-1', snippet: 'Discussed NATS configuration' },
      { sessionId: 'sess-2', snippet: 'Reviewed embedding model choices' },
    ];
    const result = formatSnippetSummaries(snippets);
    assert.ok(result.includes('[sess-1]: Discussed NATS configuration'));
    assert.ok(result.includes('[sess-2]: Reviewed embedding model choices'));
  });

  it('deduplicates by sessionId', () => {
    const snippets = [
      { sessionId: 'sess-1', snippet: 'First chunk' },
      { sessionId: 'sess-1', snippet: 'Second chunk' },
      { sessionId: 'sess-2', snippet: 'Other session' },
    ];
    const result = formatSnippetSummaries(snippets);
    const lines = result.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(result.includes('[sess-1]: First chunk'));
    assert.ok(result.includes('[sess-2]: Other session'));
  });

  it('returns empty string for empty array', () => {
    assert.equal(formatSnippetSummaries([]), '');
  });
});

// ─── formatMemoryBlock ───────────────────────────────────────────────────────

describe('formatMemoryBlock', () => {
  it('formats full block with all sections', () => {
    const data = {
      concepts: [{ name: 'NATS', type: 'tool' }],
      decisions: [{ decision: 'Use NATS', confidence: 0.95, date: '2026-02-15T00:00:00Z' }],
      snippets: [{ sessionId: 'sess-1', snippet: 'NATS discussion' }],
    };
    const result = formatMemoryBlock(data);
    assert.ok(result.startsWith('[memory: recent relevant context]'));
    assert.ok(result.endsWith('[end memory]'));
    assert.ok(result.includes('Active concepts'));
    assert.ok(result.includes('NATS (tool)'));
    assert.ok(result.includes('Recent decisions:'));
    assert.ok(result.includes('2026-02-15: Use NATS (0.95)'));
    assert.ok(result.includes('Related sessions:'));
    assert.ok(result.includes('[sess-1]: NATS discussion'));
  });

  it('omits sections with empty arrays', () => {
    const data = {
      concepts: [{ name: 'NATS', type: 'tool' }],
      decisions: [],
      snippets: [],
    };
    const result = formatMemoryBlock(data);
    assert.ok(result.includes('Active concepts'));
    assert.ok(!result.includes('Recent decisions:'));
    assert.ok(!result.includes('Related sessions:'));
  });

  it('returns empty string when all arrays are empty', () => {
    assert.equal(formatMemoryBlock({ concepts: [], decisions: [], snippets: [] }), '');
  });

  it('returns empty string for empty object', () => {
    assert.equal(formatMemoryBlock({}), '');
  });

  it('returns empty string for no args', () => {
    assert.equal(formatMemoryBlock(), '');
  });
});

// ─── injectIntoSystemMessage ─────────────────────────────────────────────────

describe('injectIntoSystemMessage', () => {
  it('prepends memory block to existing system content', () => {
    const result = injectIntoSystemMessage('You are a helpful assistant.', '[memory: test]\n[end memory]');
    assert.ok(result.startsWith('[memory: test]'));
    assert.ok(result.includes('You are a helpful assistant.'));
  });

  it('returns memory block when system content is empty', () => {
    const result = injectIntoSystemMessage('', '[memory: test]\n[end memory]');
    assert.equal(result, '[memory: test]\n[end memory]');
  });

  it('returns memory block when system content is null', () => {
    const result = injectIntoSystemMessage(null, '[memory: test]\n[end memory]');
    assert.equal(result, '[memory: test]\n[end memory]');
  });

  it('returns system content unchanged when memory block is empty', () => {
    assert.equal(injectIntoSystemMessage('System prompt', ''), 'System prompt');
  });
});

// ─── extractLastUserPrompt ───────────────────────────────────────────────────

describe('extractLastUserPrompt', () => {
  it('extracts the last user message from messages array', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ];
    assert.equal(extractLastUserPrompt(messages), 'Second question');
  });

  it('returns empty string for no user messages', () => {
    const messages = [{ role: 'system', content: 'System' }];
    assert.equal(extractLastUserPrompt(messages), '');
  });

  it('returns empty string for empty array', () => {
    assert.equal(extractLastUserPrompt([]), '');
  });

  it('returns empty string for null', () => {
    assert.equal(extractLastUserPrompt(null), '');
  });
});

// ─── injectIntoMessages ──────────────────────────────────────────────────────

describe('injectIntoMessages', () => {
  it('prepends to existing system message', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ];
    const result = injectIntoMessages(messages, '[memory: test]\n[end memory]');
    assert.equal(result.length, 2);
    assert.ok(result[0].content.startsWith('[memory: test]'));
    assert.ok(result[0].content.includes('You are helpful.'));
  });

  it('inserts new system message when none exists', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
    ];
    const result = injectIntoMessages(messages, '[memory: test]\n[end memory]');
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[0].content, '[memory: test]\n[end memory]');
    assert.equal(result[1].role, 'user');
  });

  it('returns original messages when memory block is empty', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const result = injectIntoMessages(messages, '');
    assert.deepEqual(result, messages);
  });

  it('does not mutate original messages array', () => {
    const original = [
      { role: 'system', content: 'Original system' },
      { role: 'user', content: 'Hello' },
    ];
    const copy = JSON.parse(JSON.stringify(original));
    injectIntoMessages(original, '[memory: test]\n[end memory]');
    assert.deepEqual(original, copy);
  });
});

// ─── Wrapper injection integration ──────────────────────────────────────────

describe('wrapOpenAI with injector', () => {
  it('injects memory into system message before API call', async () => {
    let capturedMessages = null;
    const mockClient = {
      chat: {
        completions: {
          create: async (opts) => {
            capturedMessages = opts.messages;
            return { choices: [{ message: { content: 'response' } }] };
          },
        },
      },
    };
    const mockPublisher = { publish: async () => {} };
    const mockInjector = {
      retrieve: async () => ({
        concepts: [{ name: 'TestConcept', type: 'tool' }],
        decisions: [],
        snippets: [],
      }),
    };

    const wrapped = wrapOpenAI(mockClient, mockPublisher, { injector: mockInjector });
    await wrapped.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test prompt' }],
    });

    assert.ok(capturedMessages);
    assert.equal(capturedMessages[0].role, 'system');
    assert.ok(capturedMessages[0].content.includes('[memory: recent relevant context]'));
    assert.ok(capturedMessages[0].content.includes('TestConcept (tool)'));
    assert.ok(capturedMessages[0].content.includes('[end memory]'));
  });

  it('skips injection when injector is not provided', async () => {
    let capturedMessages = null;
    const mockClient = {
      chat: {
        completions: {
          create: async (opts) => {
            capturedMessages = opts.messages;
            return { choices: [{ message: { content: 'response' } }] };
          },
        },
      },
    };
    const mockPublisher = { publish: async () => {} };

    const wrapped = wrapOpenAI(mockClient, mockPublisher);
    await wrapped.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.equal(capturedMessages.length, 1);
    assert.equal(capturedMessages[0].role, 'user');
  });

  it('still returns result when injection fails', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: 'ok' } }] }),
        },
      },
    };
    const mockPublisher = { publish: async () => {} };
    const failingInjector = {
      retrieve: async () => { throw new Error('injection failure'); },
    };

    const wrapped = wrapOpenAI(mockClient, mockPublisher, { injector: failingInjector });
    const result = await wrapped.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    });

    assert.equal(result.choices[0].message.content, 'ok');
  });
});

describe('wrapAnthropic with injector', () => {
  it('injects memory into system param before API call', async () => {
    let capturedArgs = null;
    const mockClient = {
      messages: {
        create: async (opts) => {
          capturedArgs = opts;
          return { content: [{ text: 'response' }] };
        },
      },
    };
    const mockPublisher = { publish: async () => {} };
    const mockInjector = {
      retrieve: async () => ({
        concepts: [{ name: 'AnthropicConcept', type: 'concept' }],
        decisions: [],
        snippets: [],
      }),
    };

    const wrapped = wrapAnthropic(mockClient, mockPublisher, { injector: mockInjector });
    await wrapped.messages.create({
      model: 'claude-opus-4',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'test prompt' }],
    });

    assert.ok(capturedArgs.system.includes('[memory: recent relevant context]'));
    assert.ok(capturedArgs.system.includes('AnthropicConcept (concept)'));
    assert.ok(capturedArgs.system.includes('You are helpful.'));
  });
});

describe('wrapGemini with injector', () => {
  it('injects memory into string content before API call', async () => {
    let capturedContent = null;
    const mockModel = {
      generateContent: async (content) => {
        capturedContent = content;
        return { response: { text: () => 'response' } };
      },
    };
    const mockPublisher = { publish: async () => {} };
    const mockInjector = {
      retrieve: async () => ({
        concepts: [{ name: 'GeminiConcept', type: 'tool' }],
        decisions: [],
        snippets: [],
      }),
    };

    const wrapped = wrapGemini(mockModel, mockPublisher, { injector: mockInjector });
    await wrapped.generateContent('test prompt');

    assert.ok(typeof capturedContent === 'string');
    assert.ok(capturedContent.includes('[memory: recent relevant context]'));
    assert.ok(capturedContent.includes('GeminiConcept (tool)'));
    assert.ok(capturedContent.includes('test prompt'));
  });
});

describe('wrapMiniMax with injector', () => {
  it('injects memory into system message (OpenAI-compatible)', async () => {
    let capturedMessages = null;
    const mockClient = {
      chat: {
        completions: {
          create: async (opts) => {
            capturedMessages = opts.messages;
            return { choices: [{ message: { content: 'response' } }] };
          },
        },
      },
    };
    const mockPublisher = { publish: async () => {} };
    const mockInjector = {
      retrieve: async () => ({
        concepts: [{ name: 'MiniMaxConcept', type: 'concept' }],
        decisions: [],
        snippets: [],
      }),
    };

    const wrapped = wrapMiniMax(mockClient, mockPublisher, { injector: mockInjector });
    await wrapped.chat.completions.create({
      model: 'minimax',
      messages: [{ role: 'user', content: 'test prompt' }],
    });

    assert.ok(capturedMessages);
    assert.equal(capturedMessages[0].role, 'system');
    assert.ok(capturedMessages[0].content.includes('MiniMaxConcept (concept)'));
  });
});
