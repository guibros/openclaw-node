// P2b: recallScore recency must apply to items whose only timestamp is created_at
// (decisions). Before: lastTouchIso = last_recalled || last_seen, so an un-recalled
// decision (created_at only) scored recency=1 forever and never aged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallScore } from '../lib/memory-injector.mjs';

const iso = ( msAgo) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

test('P2b: decisions age by created_at', () => {
  const fresh = { created_at: iso(0), mention_count: 1, salience: 0.5 };
  const old = { created_at: iso(60 * DAY), mention_count: 1, salience: 0.5 };
  assert.ok(recallScore(old) < recallScore(fresh), 'older created_at scores lower');
});

test('P2b: last_recalled still dominates created_at', () => {
  const old = { created_at: iso(60 * DAY), mention_count: 1, salience: 0.5 };
  const recalled = { created_at: iso(60 * DAY), last_recalled: iso(0), mention_count: 1, salience: 0.5 };
  assert.ok(recallScore(recalled) > recallScore(old), 'recent last_recalled beats old created_at');
});

test('P2b: an item with no timestamp still defaults to recency=1 (unchanged)', () => {
  const noTime = { mention_count: 1, salience: 0.5 };
  // frequency=log1p(1)=~0.693, salience=0.5, recency=1 -> score ~0.3466
  assert.ok(recallScore(noTime) > 0, 'no-timestamp item still scores');
});
