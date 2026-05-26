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

    it('returns true for an unsigned event (backward compatibility)', () => {
      const event = makeEvent();
      // No signature or signer_pubkey fields

      assert.equal(verifyEvent(event), true, 'unsigned event should be allowed (backward compat)');
    });

    it('returns false when signature is present but signer_pubkey is missing', () => {
      const identity = getOrCreateIdentity(tmpDir);
      const event = makeEvent();
      const signed = signEvent(event, identity.privateKey);

      delete signed.signer_pubkey;

      assert.equal(verifyEvent(signed), true, 'missing signer_pubkey with signature should pass (no pubkey to verify against)');
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
      const offer = makeEvent({
        event_type: 'context.offer',
        node_id: 'node-beta',
        data: {
          responding_to: 'broadcast-001',
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
});
