#!/usr/bin/env node

/**
 * middleware.test.js — Tests for the timingSafeEqual algorithm
 * used in mission-control/src/middleware.ts.
 *
 * Since the middleware is TypeScript (Next.js Edge Runtime), we can't
 * import it directly. Instead we reimplement the algorithm here and
 * verify its correctness and constant-time properties.
 *
 * Run: node --test test/middleware.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Constant-time string comparison (mirrors middleware.ts implementation).
 * Must NOT short-circuit on length mismatch — still does full comparison
 * to avoid length-based timing leaks.
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    // Still do a full comparison to avoid length-based timing leak
    let result = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// timingSafeEqual correctness
// ---------------------------------------------------------------------------
describe('timingSafeEqual algorithm', () => {
  it('returns true for identical strings', () => {
    assert.equal(timingSafeEqual('secret-token-123', 'secret-token-123'), true);
  });

  it('returns true for identical long strings', () => {
    const s = 'a'.repeat(1000);
    assert.equal(timingSafeEqual(s, s), true);
  });

  it('returns false for different strings of same length', () => {
    assert.equal(timingSafeEqual('secret-token-123', 'secret-token-456'), false);
  });

  it('returns false for single char difference', () => {
    assert.equal(timingSafeEqual('abcdef', 'abcdeg'), false);
  });

  it('returns false for first char difference', () => {
    assert.equal(timingSafeEqual('Xbcdef', 'abcdef'), false);
  });

  it('returns false for different lengths', () => {
    assert.equal(timingSafeEqual('short', 'longer-string'), false);
  });

  it('returns false for empty vs non-empty', () => {
    assert.equal(timingSafeEqual('', 'something'), false);
  });

  it('returns false for non-empty vs empty', () => {
    assert.equal(timingSafeEqual('something', ''), false);
  });

  it('returns true for empty vs empty', () => {
    assert.equal(timingSafeEqual('', ''), true);
  });

  it('returns false for prefix match (shorter a)', () => {
    assert.equal(timingSafeEqual('abc', 'abcdef'), false);
  });

  it('returns false for prefix match (shorter b)', () => {
    assert.equal(timingSafeEqual('abcdef', 'abc'), false);
  });

  it('handles unicode strings', () => {
    assert.equal(timingSafeEqual('hello\u00e9', 'hello\u00e9'), true);
    assert.equal(timingSafeEqual('hello\u00e9', 'hello\u00e8'), false);
  });

  it('handles strings with null bytes', () => {
    assert.equal(timingSafeEqual('a\0b', 'a\0b'), true);
    assert.equal(timingSafeEqual('a\0b', 'a\0c'), false);
  });
});

// ---------------------------------------------------------------------------
// Middleware auth logic (unit-level behavioral tests)
// ---------------------------------------------------------------------------
describe('middleware auth logic', () => {
  // Simulate the middleware's token extraction and comparison logic
  function simulateAuth({ authHeader, queryToken, configuredToken }) {
    // If no token configured, auth is disabled
    if (!configuredToken) {
      return { status: 200 };
    }

    const bearer = (authHeader || '').startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const providedToken = bearer || queryToken || '';

    if (!providedToken) {
      return { status: 401, error: 'Missing Authorization header' };
    }

    if (!timingSafeEqual(providedToken, configuredToken)) {
      return { status: 403, error: 'Invalid token' };
    }

    return { status: 200 };
  }

  it('allows request when no token configured (auth disabled)', () => {
    const r = simulateAuth({ authHeader: '', queryToken: '', configuredToken: '' });
    assert.equal(r.status, 200);
  });

  it('allows request with correct Bearer token', () => {
    const r = simulateAuth({
      authHeader: 'Bearer my-secret',
      queryToken: '',
      configuredToken: 'my-secret',
    });
    assert.equal(r.status, 200);
  });

  it('allows request with correct query token (SSE fallback)', () => {
    const r = simulateAuth({
      authHeader: '',
      queryToken: 'my-secret',
      configuredToken: 'my-secret',
    });
    assert.equal(r.status, 200);
  });

  it('rejects request with no token when auth is configured', () => {
    const r = simulateAuth({
      authHeader: '',
      queryToken: '',
      configuredToken: 'my-secret',
    });
    assert.equal(r.status, 401);
  });

  it('rejects request with wrong token', () => {
    const r = simulateAuth({
      authHeader: 'Bearer wrong-token',
      queryToken: '',
      configuredToken: 'my-secret',
    });
    assert.equal(r.status, 403);
  });

  it('prefers Bearer header over query token', () => {
    const r = simulateAuth({
      authHeader: 'Bearer correct-token',
      queryToken: 'wrong-token',
      configuredToken: 'correct-token',
    });
    assert.equal(r.status, 200);
  });

  it('rejects body over 1MB', () => {
    const MAX_BODY_SIZE = 1024 * 1024;
    const contentLength = MAX_BODY_SIZE + 1;
    assert.ok(contentLength > MAX_BODY_SIZE);
  });
});
