import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  getOrCreateIdentity,
  signEvent,
  verifyEvent,
  canonicalizeEvent,
  IDENTITY_KEY_FILE,
  IDENTITY_PUBKEY_FILE,
} from '../lib/node-identity.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-identity-test-'));
}

function makeEvent(overrides = {}) {
  return {
    event_id: crypto.randomUUID(),
    event_type: 'memory.session_started',
    event_version: 1,
    entity_id: crypto.randomUUID(),
    entity_type: 'session',
    timestamp: new Date().toISOString(),
    causation_id: null,
    correlation_id: null,
    actor: { type: 'system', id: 'test-node' },
    node_id: 'test-node-alpha',
    idempotency_key: crypto.randomUUID(),
    data: { session_id: 'sess-001' },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('node-identity', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    // Cleanup all tmp dirs (best effort)
  });

  describe('getOrCreateIdentity', () => {
    it('creates a new keypair when none exists', () => {
      const identity = getOrCreateIdentity(tmpDir);

      assert.ok(identity.privateKey, 'should have privateKey');
      assert.ok(identity.publicKey, 'should have publicKey');
      assert.ok(typeof identity.publicKeyBase64 === 'string', 'should have publicKeyBase64');
      assert.ok(identity.publicKeyBase64.length > 0, 'publicKeyBase64 should be non-empty');

      // Files should exist
      assert.ok(fs.existsSync(path.join(tmpDir, IDENTITY_KEY_FILE)), 'identity.key should exist');
      assert.ok(fs.existsSync(path.join(tmpDir, IDENTITY_PUBKEY_FILE)), 'identity.pub should exist');
    });

    it('returns the same keypair on subsequent calls (idempotent reload)', () => {
      const identity1 = getOrCreateIdentity(tmpDir);
      const identity2 = getOrCreateIdentity(tmpDir);

      assert.equal(identity1.publicKeyBase64, identity2.publicKeyBase64,
        'same public key on reload');
    });

    it('sets restrictive permissions on the private key file', () => {
      getOrCreateIdentity(tmpDir);
      const keyPath = path.join(tmpDir, IDENTITY_KEY_FILE);
      const stat = fs.statSync(keyPath);
      const mode = stat.mode & 0o777;
      assert.equal(mode, 0o600, `private key should be 0600, got ${mode.toString(8)}`);
    });

    it('derives a 32-byte base64 public key (ed25519 raw key)', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const rawBytes = Buffer.from(identity.publicKeyBase64, 'base64');
      assert.equal(rawBytes.length, 32, 'ed25519 public key should be 32 bytes');
    });
  });

  describe('canonicalizeEvent', () => {
    it('sorts keys deterministically and excludes signature/signer_pubkey', () => {
      const event = {
        z_field: 'last',
        a_field: 'first',
        signature: 'should-be-excluded',
        signer_pubkey: 'should-be-excluded',
        data: { b: 2, a: 1 },
      };

      const canonical = canonicalizeEvent(event);
      const parsed = JSON.parse(canonical);

      assert.ok(!('signature' in parsed), 'signature should be excluded');
      assert.ok(!('signer_pubkey' in parsed), 'signer_pubkey should be excluded');

      const keys = Object.keys(parsed);
      assert.deepEqual(keys, ['a_field', 'data', 'z_field'], 'keys should be sorted');

      // Nested data should also be sorted
      const dataKeys = Object.keys(parsed.data);
      assert.deepEqual(dataKeys, ['a', 'b'], 'nested keys should be sorted');
    });

    it('produces identical output for equivalent objects regardless of insertion order', () => {
      const event1 = { b: 2, a: 1, c: 3 };
      const event2 = { c: 3, a: 1, b: 2 };

      assert.equal(canonicalizeEvent(event1), canonicalizeEvent(event2),
        'canonical form should be deterministic');
    });
  });

  describe('signEvent', () => {
    it('adds signature and signer_pubkey fields to the event', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const event = makeEvent();
      const signed = signEvent(event, identity.privateKey);

      assert.ok(signed.signature, 'should have signature field');
      assert.ok(signed.signer_pubkey, 'should have signer_pubkey field');
      assert.equal(signed.signer_pubkey, identity.publicKeyBase64,
        'signer_pubkey should match identity public key');

      // Original fields should be preserved
      assert.equal(signed.event_id, event.event_id);
      assert.equal(signed.event_type, event.event_type);
      assert.equal(signed.node_id, event.node_id);
    });

    it('does not mutate the original event object', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const event = makeEvent();
      const original = { ...event };
      signEvent(event, identity.privateKey);

      assert.deepEqual(event, original, 'original event should not be mutated');
    });
  });

  describe('verifyEvent', () => {
    it('returns true for a correctly signed event', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const event = makeEvent();
      const signed = signEvent(event, identity.privateKey);

      assert.equal(verifyEvent(signed), true, 'valid signature should verify');
    });

    it('returns false for a tampered event (modified field after signing)', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const event = makeEvent();
      const signed = signEvent(event, identity.privateKey);

      // Tamper with a field
      signed.node_id = 'tampered-node';

      assert.equal(verifyEvent(signed), false, 'tampered event should fail verification');
    });

    it('regression_F-P408: rejects unsigned event by default (was the F-N13 bug)', () => {
      const event = makeEvent();
      // No signature or signer_pubkey fields
      // F-P408 fix: legacy 1-arg shape now follows OPENCLAW_REQUIRE_SIGNED
      // (default '1' = true). Previously this returned true unconditionally,
      // which silently trusted unsigned data for any caller using the
      // natural `if (verifyEvent(evt))` API.
      assert.equal(verifyEvent(event), false,
        'unsigned event must be rejected when REQUIRE_SIGNED is on (now the default)');
    });

    it('regression_F-P408: explicit opt-out for tests that exercise pre-sig handler logic', () => {
      const event = makeEvent();
      const result = verifyEvent(event, { requireSigned: false });
      assert.equal(result?.ok, true,
        'callers can still opt out via {requireSigned: false} for handler-only tests');
    });

    it('regression_F-P408: missing signer_pubkey is treated as missing-signature', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const event = makeEvent();
      const signed = signEvent(event, identity.privateKey);
      delete signed.signer_pubkey;
      assert.equal(verifyEvent(signed), false,
        'sig without pubkey is unverifiable — must reject under default-strict');
    });

    it('returns false when signed with a different key', () => {
      const identity1 = getOrCreateIdentity(makeTmpDir());
      const identity2 = getOrCreateIdentity(makeTmpDir());

      const event = makeEvent();
      const signed = signEvent(event, identity1.privateKey);

      // Replace signer_pubkey with identity2's key (signature doesn't match)
      signed.signer_pubkey = identity2.publicKeyBase64;

      assert.equal(verifyEvent(signed), false,
        'event signed by key1 but claiming key2 should fail');
    });

    it('returns false for corrupted signature bytes', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const event = makeEvent();
      const signed = signEvent(event, identity.privateKey);

      // Corrupt the signature
      signed.signature = 'AAAA' + signed.signature.slice(4);

      assert.equal(verifyEvent(signed), false, 'corrupted signature should fail');
    });
  });

  describe('offerer signature verification integration', () => {
    it('offerer rejects broadcast with bad signature via processBroadcast', async () => {
      const { createOfferer } = await import('../lib/broadcast-offerer.mjs');

      const logs = [];
      const mockNc = { jetstream: () => ({}) };
      const offerer = createOfferer(mockNc, 'node-beta', {
        log: (msg) => logs.push(msg),
      });

      const identity = getOrCreateIdentity(tmpDir);
      const broadcast = makeEvent({
        event_type: 'context.broadcast',
        node_id: 'node-alpha',
        data: {
          themes: ['testing'],
          entities: ['ed25519'],
          problem_class: 'debug',
          intensity: 'interested',
          ttl_minutes: 60,
          dedup_key: 'test-dedup',
        },
      });

      // Sign and then tamper
      const signed = signEvent(broadcast, identity.privateKey);
      signed.data.themes = ['tampered'];

      const result = await offerer._processBroadcast(signed);

      assert.equal(result.action, 'skip');
      assert.equal(result.reason, 'bad_signature');
      assert.equal(offerer.stats.signatureRejected, 1);
      assert.ok(logs.some(l => l.includes('STRICT')), 'should log STRICT rejection');
    });
  });

  describe('acceptor signature verification integration', () => {
    it('acceptor rejects offer with bad signature via _processOffer', async () => {
      const { createAcceptor } = await import('../lib/broadcast-acceptor.mjs');

      const logs = [];
      const mockNc = { jetstream: () => ({}) };
      const ownIds = new Set(['broadcast-001']);
      const acceptor = createAcceptor(mockNc, 'node-alpha', {
        log: (msg) => logs.push(msg),
        ownBroadcastIds: ownIds,
      });

      const identity = getOrCreateIdentity(tmpDir);
      // After F-H2 (schema validation at boundary), test fixture must conform
      // to ContextOfferSchema — responding_to/causation_id must be UUID format.
      const respondingTo = '00000000-0000-4000-8000-000000000001';
      ownIds.add(respondingTo);
      const offer = makeEvent({
        event_type: 'context.offer',
        node_id: 'node-beta',
        causation_id: respondingTo,
        data: {
          responding_to: respondingTo,
          offerer_node_id: 'node-beta',
          artifacts: [{ artifact_ref: 'session:s1:chunk:0', relevance_score: 0.8, provenance: { source_node: 'node-beta', source_type: 'local_retrieval' }, summary: 'test' }],
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      });

      // Sign and then tamper
      const signed = signEvent(offer, identity.privateKey);
      signed.data.offerer_node_id = 'tampered-node';

      const result = await acceptor._processOffer(signed);

      assert.equal(result.action, 'skip');
      assert.equal(result.reason, 'bad_signature');
      assert.equal(acceptor.stats.signatureRejected, 1);
      assert.ok(logs.some(l => l.includes('STRICT')), 'should log STRICT rejection');
    });
  });

  // ─── Tests for new STRICT-mode features (F-C2, F-C3, F-C4, F-L1) ───────────

  describe('verifyEvent — STRICT mode requireSigned', () => {
    it('rejects unsigned event when requireSigned:true', () => {
      const event = { event_id: '1', timestamp: new Date().toISOString(), data: {} };
      const result = verifyEvent(event, { requireSigned: true });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'missing-signature');
    });

    it('accepts unsigned event when requireSigned:false', () => {
      const event = { event_id: '1', timestamp: new Date().toISOString(), data: {} };
      const result = verifyEvent(event, { requireSigned: false });
      assert.equal(result.ok, true);
    });
  });

  describe('verifyEvent — identity registry binding', () => {
    it('rejects when signer_pubkey does not match registered key for node_id', async () => {
      const { createIdentityRegistry } = await import('../lib/node-identity.mjs');
      const reg = createIdentityRegistry({ path: tmpDir + '/test-reg.json', mode: 'strict' });
      const idAlice = getOrCreateIdentity(tmpDir + '/alice');
      const idBob = getOrCreateIdentity(tmpDir + '/bob');
      reg.trust('alice', idAlice.publicKeyBase64, 'seed');

      // Bob signs an event claiming to be alice
      const event = makeEvent({ node_id: 'alice', data: { themes: ['t'] } });
      const signed = signEvent(event, idBob.privateKey);

      const result = verifyEvent(signed, { requireSigned: true, registry: reg, checkFreshness: false });
      assert.equal(result.ok, false);
      assert.match(result.reason, /registry/);
    });

    it('accepts when signer_pubkey matches registered key', async () => {
      const { createIdentityRegistry } = await import('../lib/node-identity.mjs');
      const reg = createIdentityRegistry({ path: tmpDir + '/test-reg2.json', mode: 'strict' });
      const idAlice = getOrCreateIdentity(tmpDir + '/alice2');
      reg.trust('alice', idAlice.publicKeyBase64, 'seed');

      const event = makeEvent({ node_id: 'alice', data: { themes: ['t'] } });
      const signed = signEvent(event, idAlice.privateKey);

      const result = verifyEvent(signed, { requireSigned: true, registry: reg, checkFreshness: false });
      assert.equal(result.ok, true);
    });

    it('TOFU mode records unknown nodeId on first sight', async () => {
      const { createIdentityRegistry } = await import('../lib/node-identity.mjs');
      const reg = createIdentityRegistry({ path: tmpDir + '/test-reg3.json', mode: 'tofu' });
      const id = getOrCreateIdentity(tmpDir + '/tofu');

      const event = makeEvent({ node_id: 'newnode', data: {} });
      const signed = signEvent(event, id.privateKey);

      const result = verifyEvent(signed, { requireSigned: true, registry: reg, checkFreshness: false });
      assert.equal(result.ok, true);
      assert.equal(reg.get('newnode').pubkey, id.publicKeyBase64);
    });
  });

  describe('verifyEvent — replay protection (seenIds)', () => {
    it('rejects exact replay of a previously-seen event_id', async () => {
      const { createSeenEventCache } = await import('../lib/node-identity.mjs');
      const cache = createSeenEventCache(100);
      const id = getOrCreateIdentity(tmpDir + '/replay');

      const event = makeEvent({ data: {} });
      const signed = signEvent(event, id.privateKey);

      const first = verifyEvent(signed, { requireSigned: true, seenIds: cache, checkFreshness: false });
      assert.equal(first.ok, true);

      const second = verifyEvent(signed, { requireSigned: true, seenIds: cache, checkFreshness: false });
      assert.equal(second.ok, false);
      assert.equal(second.reason, 'replay');
    });
  });

  describe('verifyEvent — freshness window', () => {
    it('rejects event with timestamp older than maxAgeMs', async () => {
      const id = getOrCreateIdentity(tmpDir + '/freshness');
      const event = makeEvent({ timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), data: {} });
      const signed = signEvent(event, id.privateKey);

      const result = verifyEvent(signed, { requireSigned: true, checkFreshness: true });
      assert.equal(result.ok, false);
      assert.match(result.reason, /freshness:too-old/);
    });

    it('rejects event with timestamp too far in the future', async () => {
      const id = getOrCreateIdentity(tmpDir + '/freshness2');
      const event = makeEvent({ timestamp: new Date(Date.now() + 60 * 60 * 1000).toISOString(), data: {} });
      const signed = signEvent(event, id.privateKey);

      const result = verifyEvent(signed, { requireSigned: true, checkFreshness: true });
      assert.equal(result.ok, false);
      assert.match(result.reason, /freshness:too-far-future/);
    });

    it('accepts event within freshness window', async () => {
      const id = getOrCreateIdentity(tmpDir + '/freshness3');
      const event = makeEvent({ timestamp: new Date().toISOString(), data: {} });
      const signed = signEvent(event, id.privateKey);

      const result = verifyEvent(signed, { requireSigned: true, checkFreshness: true });
      assert.equal(result.ok, true);
    });
  });

  describe('createSeenEventCache LRU eviction', () => {
    it('evicts oldest entries when cap exceeded', async () => {
      const { createSeenEventCache } = await import('../lib/node-identity.mjs');
      const cache = createSeenEventCache(3);
      cache.add('a');
      cache.add('b');
      cache.add('c');
      assert.equal(cache.has('a'), true);
      cache.add('d');  // evicts something
      assert.equal(cache.size(), 3);
    });
  });

  describe('getOrCreateIdentity — concurrent creation race (F-L1)', () => {
    it('does not error when two getOrCreateIdentity calls race', async () => {
      // Two concurrent calls into the same fresh dir should both produce
      // identical keys (winner of the EEXIST race is loaded by the loser).
      const fs = await import('node:fs');
      const path = await import('node:path');
      const raceDir = path.join(tmpDir, 'race-' + Date.now());
      fs.mkdirSync(raceDir, { recursive: true });
      const a = getOrCreateIdentity(raceDir);
      const b = getOrCreateIdentity(raceDir);
      assert.equal(a.publicKeyBase64, b.publicKeyBase64);
    });
  });
});
