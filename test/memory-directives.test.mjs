import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECTIVE_REGEX,
  DIRECTIVE_TYPES,
  parseMemoryDirective,
  replaceLastUserContent,
} from '../lib/memory-directives.mjs';
import { DEFAULT_TOKEN_BUDGET } from '../lib/memory-injector.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

describe('DIRECTIVE_REGEX', () => {
  it('matches @memory off', () => {
    assert.ok(DIRECTIVE_REGEX.test('@memory off'));
  });

  it('matches @memory deep', () => {
    assert.ok(DIRECTIVE_REGEX.test('@memory deep'));
  });

  it('matches @memory none', () => {
    assert.ok(DIRECTIVE_REGEX.test('@memory none'));
  });

  it('matches @memory only:<theme>', () => {
    assert.ok(DIRECTIVE_REGEX.test('@memory only:nats'));
  });
});

describe('DIRECTIVE_TYPES', () => {
  it('contains all four directive types', () => {
    assert.ok(DIRECTIVE_TYPES.has('off'));
    assert.ok(DIRECTIVE_TYPES.has('deep'));
    assert.ok(DIRECTIVE_TYPES.has('none'));
    assert.ok(DIRECTIVE_TYPES.has('only'));
    assert.equal(DIRECTIVE_TYPES.size, 4);
  });
});

// ─── parseMemoryDirective ────────────────────────────────────────────────────

describe('parseMemoryDirective', () => {
  it('parses @memory off', () => {
    const result = parseMemoryDirective('help me @memory off with this');
    assert.equal(result.type, 'off');
    assert.equal(result.param, null);
    assert.equal(result.cleanedText, 'help me with this');
  });

  it('parses @memory deep', () => {
    const result = parseMemoryDirective('@memory deep tell me about NATS');
    assert.equal(result.type, 'deep');
    assert.equal(result.param, null);
    assert.equal(result.cleanedText, 'tell me about NATS');
  });

  it('parses @memory none', () => {
    const result = parseMemoryDirective('stop remembering @memory none');
    assert.equal(result.type, 'none');
    assert.equal(result.param, null);
    assert.equal(result.cleanedText, 'stop remembering');
  });

  it('parses @memory only:<theme>', () => {
    const result = parseMemoryDirective('@memory only:nats-config help me');
    assert.equal(result.type, 'only');
    assert.equal(result.param, 'nats-config');
    assert.equal(result.cleanedText, 'help me');
  });

  it('returns null type when no directive found', () => {
    const result = parseMemoryDirective('just a normal question');
    assert.equal(result.type, null);
    assert.equal(result.param, null);
    assert.equal(result.cleanedText, 'just a normal question');
  });

  it('handles null input', () => {
    const result = parseMemoryDirective(null);
    assert.equal(result.type, null);
    assert.equal(result.cleanedText, '');
  });

  it('handles empty string', () => {
    const result = parseMemoryDirective('');
    assert.equal(result.type, null);
    assert.equal(result.cleanedText, '');
  });

  it('is case-insensitive', () => {
    const result = parseMemoryDirective('@Memory OFF do something');
    assert.equal(result.type, 'off');
    assert.equal(result.cleanedText, 'do something');
  });

  it('strips directive cleanly from middle of text', () => {
    const result = parseMemoryDirective('before @memory deep after');
    assert.equal(result.type, 'deep');
    assert.equal(result.cleanedText, 'before after');
  });

  it('handles directive at end of text', () => {
    const result = parseMemoryDirective('question here @memory off');
    assert.equal(result.type, 'off');
    assert.equal(result.cleanedText, 'question here');
  });

  it('handles directive as only content', () => {
    const result = parseMemoryDirective('@memory none');
    assert.equal(result.type, 'none');
    assert.equal(result.cleanedText, '');
  });
});

// ─── replaceLastUserContent ──────────────────────────────────────────────────

describe('replaceLastUserContent', () => {
  it('replaces the last user message content', () => {
    const messages = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello @memory off' },
    ];
    const result = replaceLastUserContent(messages, 'hello');
    assert.equal(result[1].content, 'hello');
    assert.equal(result[0].content, 'you are helpful');
  });

  it('replaces only the last user message when multiple exist', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'response' },
      { role: 'user', content: 'second @memory deep' },
    ];
    const result = replaceLastUserContent(messages, 'second');
    assert.equal(result[0].content, 'first'); // unchanged
    assert.equal(result[2].content, 'second');
  });

  it('returns original array when no user messages', () => {
    const messages = [{ role: 'system', content: 'sys' }];
    const result = replaceLastUserContent(messages, 'replacement');
    assert.equal(result[0].content, 'sys');
  });

  it('is non-mutating', () => {
    const original = [{ role: 'user', content: 'original' }];
    const result = replaceLastUserContent(original, 'replaced');
    assert.equal(original[0].content, 'original');
    assert.equal(result[0].content, 'replaced');
  });

  it('handles null input', () => {
    const result = replaceLastUserContent(null, 'text');
    assert.deepEqual(result, []);
  });
});

// ─── Wrapper directive behavior (using OpenAI wrapper as reference) ──────────

describe('wrapOpenAI with directives', () => {
  function createMockClient() {
    return {
      chat: {
        completions: {
          create: async (params) => ({ choices: [{ message: { content: 'response' } }], _params: params }),
        },
      },
    };
  }

  function createMockPublisher() {
    return { publish: async () => {} };
  }

  function createMockInjector(returnData = null) {
    const data = returnData || {
      concepts: [{ name: 'NATS', type: 'tool' }],
      decisions: [],
      snippets: [],
    };
    return {
      retrieve: async (query, opts) => {
        return { ...data, _query: query, _opts: opts };
      },
    };
  }

  it('skips injection when @memory off is present', async () => {
    const { wrapOpenAI } = await import('../lib/publishers/openai-wrapper.mjs');
    let retrieveCalled = false;
    const injector = {
      retrieve: async () => { retrieveCalled = true; return { concepts: [], decisions: [], snippets: [] }; },
    };
    const client = createMockClient();
    wrapOpenAI(client, createMockPublisher(), { injector });
    const result = await client.chat.completions.create({
      messages: [{ role: 'user', content: 'help me @memory off' }],
    });
    assert.equal(retrieveCalled, false);
    // Directive should be stripped from the message sent to LLM
    assert.equal(result._params.messages[0].content, 'help me');
  });

  it('doubles token budget when @memory deep is present', async () => {
    const { wrapOpenAI } = await import('../lib/publishers/openai-wrapper.mjs');
    let capturedOpts = null;
    const injector = {
      retrieve: async (query, opts) => {
        capturedOpts = opts;
        return { concepts: [], decisions: [], snippets: [] };
      },
    };
    const client = createMockClient();
    wrapOpenAI(client, createMockPublisher(), { injector });
    await client.chat.completions.create({
      messages: [{ role: 'user', content: 'tell me about NATS @memory deep' }],
    });
    assert.equal(capturedOpts.tokenBudget, DEFAULT_TOKEN_BUDGET * 2);
  });

  it('regression_F-P301: @memory none is per-turn only, no cross-call state', async () => {
    // F-P301 fix: previous behavior of "kill memory for the session" was a
    // process-wide closure variable that leaked across users when the SDK
    // client was shared. F-H21 specifies per-turn semantics. `none` is now
    // equivalent to `off` (skip injection for THIS call only).
    const { wrapOpenAI } = await import('../lib/publishers/openai-wrapper.mjs');
    let retrieveCount = 0;
    const injector = {
      retrieve: async () => { retrieveCount++; return { concepts: [], decisions: [], snippets: [] }; },
    };
    const client = createMockClient();
    wrapOpenAI(client, createMockPublisher(), { injector });

    // First call with @memory none — skips injection
    await client.chat.completions.create({
      messages: [{ role: 'user', content: '@memory none' }],
    });
    assert.equal(retrieveCount, 0, 'first call (with @memory none) skips retrieve');

    // Second call without any directive — should NOT remain disabled (per-turn semantics)
    await client.chat.completions.create({
      messages: [{ role: 'user', content: 'another question' }],
    });
    assert.equal(retrieveCount, 1,
      'second call (no directive) MUST re-enable retrieve — @memory none is per-turn only');
  });

  it('regression_F-P302: @memory only:X uses cleanedText as query + themeFilter', async () => {
    // F-P302/F-N70 fix: previously the wrapper used the bare theme as the
    // retrieval query (semantic search on a single token), divergent from
    // the inject-server which uses cleanedText as query + themeFilter for
    // post-retrieval filter. Now both paths produce identical injection.
    const { wrapOpenAI } = await import('../lib/publishers/openai-wrapper.mjs');
    let capturedQuery = null;
    let capturedOpts = null;
    const injector = {
      retrieve: async (query, opts) => {
        capturedQuery = query;
        capturedOpts = opts;
        return { concepts: [], decisions: [], snippets: [] };
      },
    };
    const client = createMockClient();
    wrapOpenAI(client, createMockPublisher(), { injector });
    await client.chat.completions.create({
      messages: [{ role: 'user', content: '@memory only:federation help me' }],
    });
    assert.equal(capturedQuery, 'help me',
      'query is the directive-stripped prompt, not the bare theme');
    assert.equal(capturedOpts?.themeFilter, 'federation',
      'theme passes through as a themeFilter option for post-retrieval filter');
  });

  it('strips directive from messages sent to LLM', async () => {
    const { wrapOpenAI } = await import('../lib/publishers/openai-wrapper.mjs');
    const injector = {
      retrieve: async () => ({ concepts: [], decisions: [], snippets: [] }),
    };
    const client = createMockClient();
    wrapOpenAI(client, createMockPublisher(), { injector });
    const result = await client.chat.completions.create({
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'explain NATS @memory deep please' },
      ],
    });
    // The user message should not contain @memory deep
    const userMsg = result._params.messages.find(m => m.role === 'user');
    assert.ok(!userMsg.content.includes('@memory'));
    assert.equal(userMsg.content, 'explain NATS please');
  });
});

describe('wrapAnthropic with directives', () => {
  it('skips injection when @memory off is present', async () => {
    const { wrapAnthropic } = await import('../lib/publishers/anthropic-wrapper.mjs');
    let retrieveCalled = false;
    const injector = {
      retrieve: async () => { retrieveCalled = true; return { concepts: [], decisions: [], snippets: [] }; },
    };
    const client = {
      messages: {
        create: async (params) => ({ content: [{ text: 'response' }], _params: params }),
      },
    };
    wrapAnthropic(client, { publish: async () => {} }, { injector });
    await client.messages.create({
      messages: [{ role: 'user', content: 'test @memory off' }],
    });
    assert.equal(retrieveCalled, false);
  });
});

describe('wrapGemini with directives', () => {
  it('skips injection when @memory off with string content', async () => {
    const { wrapGemini } = await import('../lib/publishers/gemini-wrapper.mjs');
    let retrieveCalled = false;
    const injector = {
      retrieve: async () => { retrieveCalled = true; return { concepts: [], decisions: [], snippets: [] }; },
    };
    const model = {
      generateContent: async (content) => ({ response: { text: () => 'ok' }, _content: content }),
    };
    wrapGemini(model, { publish: async () => {} }, { injector });
    const result = await model.generateContent('test @memory off');
    assert.equal(retrieveCalled, false);
    // Directive stripped from content
    assert.equal(result._content, 'test');
  });
});

describe('wrapMiniMax with directives', () => {
  it('skips injection when @memory off is present', async () => {
    const { wrapMiniMax } = await import('../lib/publishers/minimax-wrapper.mjs');
    let retrieveCalled = false;
    const injector = {
      retrieve: async () => { retrieveCalled = true; return { concepts: [], decisions: [], snippets: [] }; },
    };
    const client = {
      chat: {
        completions: {
          create: async (params) => ({ choices: [{ message: { content: 'response' } }], _params: params }),
        },
      },
    };
    wrapMiniMax(client, { publish: async () => {} }, { injector });
    await client.chat.completions.create({
      messages: [{ role: 'user', content: 'test @memory off' }],
    });
    assert.equal(retrieveCalled, false);
  });
});
