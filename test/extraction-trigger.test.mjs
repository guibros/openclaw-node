import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRACT_SUBJECT,
  DEFAULT_IDLE_THRESHOLD_SEC,
  publishExtractRequest,
  createExtractionTrigger,
} from '../lib/extraction-trigger.mjs';

/**
 * Create a mock NATS subscription whose async iterator terminates
 * when unsubscribe() is called. Without this, the for-await loop
 * in createExtractionTrigger would hang the test process.
 */
function createMockSub(messages = []) {
  let unsubscribed = false;
  let pendingResolve = null;
  let msgIndex = 0;

  return {
    unsubscribe() {
      unsubscribed = true;
      if (pendingResolve) {
        pendingResolve({ value: undefined, done: true });
        pendingResolve = null;
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (unsubscribed) return Promise.resolve({ value: undefined, done: true });
          if (msgIndex < messages.length) {
            const msg = messages[msgIndex++];
            return Promise.resolve({ value: msg, done: false });
          }
          // No more messages — wait until unsubscribe or more messages
          return new Promise((resolve) => { pendingResolve = resolve; });
        },
      };
    },
  };
}

// ── Constants ────────────────────────────────────────────

describe('EXTRACT_SUBJECT', () => {
  it('has the correct value', () => {
    assert.strictEqual(EXTRACT_SUBJECT, 'mesh.memory.extract_request');
  });
});

describe('DEFAULT_IDLE_THRESHOLD_SEC', () => {
  it('is 2700 (45 minutes)', () => {
    assert.strictEqual(DEFAULT_IDLE_THRESHOLD_SEC, 2700);
  });
});

// ── publishExtractRequest ────────────────────────────────

describe('publishExtractRequest', () => {
  it('publishes to the correct subject with payload', () => {
    const published = [];
    const mockNc = {
      publish(subject, data) {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      },
    };

    const result = publishExtractRequest(mockNc, 'node-A', { triggeredBy: 'test-hook' });

    assert.strictEqual(result.subject, EXTRACT_SUBJECT);
    assert.strictEqual(result.payload.node_id, 'node-A');
    assert.strictEqual(result.payload.triggered_by, 'test-hook');
    assert.ok(result.payload.timestamp);
    assert.strictEqual(published.length, 1);
    assert.strictEqual(published[0].subject, EXTRACT_SUBJECT);
    assert.strictEqual(published[0].data.node_id, 'node-A');
    assert.strictEqual(published[0].data.triggered_by, 'test-hook');
  });

  it('defaults triggered_by to manual', () => {
    const published = [];
    const mockNc = {
      publish(subject, data) {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      },
    };

    const result = publishExtractRequest(mockNc, 'node-B');

    assert.strictEqual(result.payload.triggered_by, 'manual');
    assert.strictEqual(published[0].data.triggered_by, 'manual');
  });
});

// ── createExtractionTrigger ──────────────────────────────

describe('createExtractionTrigger', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env.EXTRACTION_IDLE_THRESHOLD_SEC;
    delete process.env.EXTRACTION_IDLE_THRESHOLD_SEC;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.EXTRACTION_IDLE_THRESHOLD_SEC = savedEnv;
    } else {
      delete process.env.EXTRACTION_IDLE_THRESHOLD_SEC;
    }
  });

  it('subscribes to the correct subject on start', async () => {
    const subscribed = [];
    const mockNc = {
      subscribe(subject) {
        subscribed.push(subject);
        return createMockSub();
      },
      publish() {},
    };

    const trigger = createExtractionTrigger(mockNc, 'node-A', {
      onExtract: () => {},
      idleThresholdSec: 99999,
    });
    await trigger.start();

    assert.strictEqual(subscribed.length, 1);
    assert.strictEqual(subscribed[0], EXTRACT_SUBJECT);

    trigger.stop();
  });

  it('calls onExtract when a message is received', async () => {
    const extracted = [];
    const payload = { node_id: 'sender', triggered_by: 'test' };
    const mockMsg = { data: new TextEncoder().encode(JSON.stringify(payload)) };

    const mockNc = {
      subscribe() { return createMockSub([mockMsg]); },
      publish() {},
    };

    const trigger = createExtractionTrigger(mockNc, 'node-A', {
      onExtract: (p) => { extracted.push(p); },
      idleThresholdSec: 99999,
    });
    await trigger.start();

    // Give the async iterator time to process
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(extracted.length, 1);
    assert.strictEqual(extracted[0].node_id, 'sender');
    assert.strictEqual(extracted[0].triggered_by, 'test');

    trigger.stop();
  });

  it('fires idle timer after threshold elapses', async () => {
    const published = [];
    const mockNc = {
      subscribe() { return createMockSub(); },
      publish(subject, data) {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      },
    };

    const trigger = createExtractionTrigger(mockNc, 'node-A', {
      onExtract: () => {},
      idleThresholdSec: 0.1,
    });
    await trigger.start();

    // Wait for the idle timer to fire
    await new Promise(r => setTimeout(r, 200));

    trigger.stop();

    assert.ok(published.length >= 1, 'idle timer should have published at least once');
    assert.strictEqual(published[0].subject, EXTRACT_SUBJECT);
    assert.strictEqual(published[0].data.triggered_by, 'idle-timer');
    assert.strictEqual(published[0].data.node_id, 'node-A');
  });

  it('respects EXTRACTION_IDLE_THRESHOLD_SEC env var', async () => {
    process.env.EXTRACTION_IDLE_THRESHOLD_SEC = '0.1';
    const published = [];
    const mockNc = {
      subscribe() { return createMockSub(); },
      publish(subject, data) {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      },
    };

    const trigger = createExtractionTrigger(mockNc, 'node-A', {
      onExtract: () => {},
      idleThresholdSec: 99999, // should be overridden by env
    });
    await trigger.start();

    await new Promise(r => setTimeout(r, 200));

    trigger.stop();

    assert.ok(published.length >= 1, 'env var threshold should override opts');
    assert.strictEqual(published[0].data.triggered_by, 'idle-timer');
  });

  it('stop prevents further idle timer fires', async () => {
    const published = [];
    const mockNc = {
      subscribe() { return createMockSub(); },
      publish(subject, data) {
        published.push({ subject });
      },
    };

    const trigger = createExtractionTrigger(mockNc, 'node-A', {
      onExtract: () => {},
      idleThresholdSec: 0.15,
    });
    await trigger.start();
    trigger.stop();

    await new Promise(r => setTimeout(r, 250));

    assert.strictEqual(published.length, 0, 'no publishes after stop');
  });
});

describe('R40 (repair 4.5): idle-timer self-loop', () => {
  it('an idle-timer ping does not re-arm the timer — fires once, not forever', async () => {
    // Loopback mock: published messages are delivered back to the
    // subscription, exactly like the real shared NATS subject — the
    // mechanism that made the old code a permanent 45-min publish loop.
    let pendingResolve = null;
    let unsubscribed = false;
    const queue = [];
    const sub = {
      unsubscribe() {
        unsubscribed = true;
        if (pendingResolve) { pendingResolve({ value: undefined, done: true }); pendingResolve = null; }
      },
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (unsubscribed) return Promise.resolve({ value: undefined, done: true });
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            return new Promise((resolve) => { pendingResolve = resolve; });
          },
        };
      },
    };
    const published = [];
    const mockNc = {
      subscribe() { return sub; },
      publish(subject, data) {
        published.push(JSON.parse(new TextDecoder().decode(data)));
        const msg = { data };
        if (pendingResolve) { pendingResolve({ value: msg, done: false }); pendingResolve = null; }
        else queue.push(msg);
      },
    };

    const trigger = createExtractionTrigger(mockNc, 'node-A', {
      onExtract: () => {},
      idleThresholdSec: 0.05,
    });
    await trigger.start();

    // Old behavior: fire → loopback → re-arm → fire → … (8 cycles in 400ms).
    // Fixed behavior: the initial arm fires exactly once.
    await new Promise(r => setTimeout(r, 400));
    trigger.stop();

    assert.strictEqual(published.length, 1,
      `idle timer must fire once and stay quiet until real activity (got ${published.length} fires)`);
  });
});
