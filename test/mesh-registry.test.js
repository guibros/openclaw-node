#!/usr/bin/env node

/**
 * mesh-registry.test.js — Unit tests for lib/mesh-registry.js
 *
 * Tests MeshRegistry: tool registration, KV storage, heartbeat, remote calls,
 * listing, and shutdown.
 *
 * Run: node --test test/mesh-registry.test.js
 */

// ── Mock 'nats' before any require ──
const Module = require('module');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() {
    const iter = this.store.keys();
    return {
      [Symbol.asyncIterator]() {
        return { next() { return Promise.resolve(iter.next()); } };
      },
    };
  }
}

class MockSubscription {
  constructor() {
    this.messages = [];
    this._resolve = null;
    this.unsubscribed = false;
  }
  push(msg) {
    if (this._resolve) { this._resolve({ value: msg, done: false }); this._resolve = null; }
    else this.messages.push(msg);
  }
  unsubscribe() { this.unsubscribed = true; }
  [Symbol.asyncIterator]() {
    const self = this;
    return {
      next() {
        if (self.messages.length > 0) return Promise.resolve({ value: self.messages.shift(), done: false });
        if (self.unsubscribed) return Promise.resolve({ done: true });
        return new Promise(resolve => { self._resolve = resolve; });
      },
    };
  }
}

const mockKV = new MockKV();
const mockSubs = [];

const mockNats = {
  StringCodec: () => ({
    encode: (str) => encoder.encode(str),
    decode: (buf) => decoder.decode(buf),
  }),
  connect: async () => ({
    jetstream: () => ({
      views: {
        kv: async () => mockKV,
      },
    }),
    subscribe: (subject) => {
      const sub = new MockSubscription();
      sub.subject = subject;
      mockSubs.push(sub);
      return sub;
    },
    request: async (subject, data, opts) => {
      return { data: encoder.encode(JSON.stringify({ data: 'mock-response' })) };
    },
  }),
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'nats') return 'nats';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['nats'] = {
  id: 'nats', filename: 'nats', loaded: true, exports: mockNats,
};

// Mock nats-resolve
const natsResolvePath = require.resolve('../lib/nats-resolve');
require.cache[natsResolvePath] = {
  id: natsResolvePath, filename: natsResolvePath, loaded: true,
  exports: {
    NATS_URL: 'nats://test:4222',
    NATS_TOKEN: null,
    natsConnectOpts: (extra) => ({ servers: 'nats://test:4222', ...extra }),
  },
};

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MeshRegistry } = require('../lib/mesh-registry');

describe('MeshRegistry', () => {
  let registry;

  beforeEach(async () => {
    mockKV.store.clear();
    mockSubs.length = 0;
    const nc = await mockNats.connect();
    registry = new MeshRegistry(nc, 'test-node');
    await registry.init();
  });

  it('initializes with node ID', () => {
    assert.equal(registry.nodeId, 'test-node');
  });

  it('registers a tool manifest to KV', async () => {
    const manifest = {
      name: 'discord-reader',
      methods: [{ name: 'readMessages' }],
    };
    const entry = await registry.register(manifest);
    assert.equal(entry.name, 'discord-reader');
    assert.equal(entry.node_id, 'test-node');
    assert.ok(entry.registered_at);

    // Check KV
    const kvEntry = await mockKV.get('test-node.discord-reader');
    assert.ok(kvEntry);
    const parsed = JSON.parse(decoder.decode(kvEntry.value));
    assert.equal(parsed.name, 'discord-reader');
  });

  it('subscribes to NATS subjects for each method with handler', async () => {
    const manifest = {
      name: 'my-tool',
      methods: [{ name: 'doThing' }, { name: 'otherThing' }],
    };
    await registry.register(manifest, {
      doThing: async (args) => ({ result: 'ok' }),
    });

    // Only doThing has a handler, so only 1 subscription
    assert.equal(mockSubs.length, 1);
    assert.equal(mockSubs[0].subject, 'mesh.tool.test-node.my-tool.doThing');
  });

  it('listTools returns all registered manifests', async () => {
    await registry.register({ name: 'tool-a', methods: [] });
    await registry.register({ name: 'tool-b', methods: [] });
    const tools = await registry.listTools();
    assert.equal(tools.length, 2);
    const names = tools.map(t => t.name).sort();
    assert.deepEqual(names, ['tool-a', 'tool-b']);
  });

  it('shutdown cleans up KV entries', async () => {
    await registry.register({ name: 'cleanup-tool', methods: [] });
    assert.ok(await mockKV.get('test-node.cleanup-tool'));

    await registry.shutdown();
    assert.equal(await mockKV.get('test-node.cleanup-tool'), null);
  });

  it('shutdown unsubscribes all subscriptions', async () => {
    await registry.register({
      name: 'sub-tool',
      methods: [{ name: 'act' }],
    }, { act: async () => 'ok' });

    await registry.shutdown();
    assert.ok(mockSubs[0].unsubscribed);
  });

  it('call sends NATS request and returns data', async () => {
    const result = await registry.call('remote-node', 'tool', 'method', { foo: 1 });
    assert.equal(result, 'mock-response');
  });

  it('stores manifests in internal map', async () => {
    await registry.register({ name: 'tracked', methods: [] });
    assert.ok(registry.manifests.has('tracked'));
  });

  it('heartbeat refreshes KV entries', async () => {
    await registry.register({ name: 'hb-tool', methods: [] });

    // Start heartbeat (uses setInterval)
    registry.startHeartbeat();

    // Verify timer was created
    assert.ok(registry.heartbeatTimer);

    // Cleanup
    await registry.shutdown();
  });
});
