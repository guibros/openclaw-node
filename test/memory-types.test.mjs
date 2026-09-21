/**
 * test/memory-types.test.mjs — declared memory kinds + per-field merge ops
 * (openviking-adopt Block 3). Pure module; no database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_TYPES, MERGE_OPS, mergeFields, newAliases, canonicalAlias, ALIAS_CAP } from '../lib/memory-types.mjs';

describe('registry', () => {
  it('declares the three kinds with their identity keys', () => {
    assert.deepEqual(Object.keys(MEMORY_TYPES).sort(), ['decision', 'entity', 'theme']);
    assert.deepEqual(MEMORY_TYPES.entity.identity, ['canonical_name']);
    assert.deepEqual(MEMORY_TYPES.decision.identity, ['session_id', 'decision']);
  });
  it('entity type and name are immutable, aliases union; decision superseded_by immutable', () => {
    assert.equal(MEMORY_TYPES.entity.fields.type, MERGE_OPS.IMMUTABLE);
    assert.equal(MEMORY_TYPES.entity.fields.name, MERGE_OPS.IMMUTABLE);
    assert.equal(MEMORY_TYPES.entity.fields.aliases, MERGE_OPS.UNION);
    assert.equal(MEMORY_TYPES.decision.fields.superseded_by, MERGE_OPS.IMMUTABLE);
    assert.equal(MEMORY_TYPES.theme.fields.mention_count, MERGE_OPS.SUM);
  });
});

describe('mergeFields', () => {
  it('entity: first classification and spelling win, last_seen replaces, aliases union', () => {
    const existing = { id: 1, name: 'NATS JetStream', type: 'technology', first_seen: 't0', last_seen: 't0', aliases: ['jetstream'], salience: 0.9 };
    const { merged, changed } = mergeFields('entity', existing, { name: 'jetstream', type: 'concept', last_seen: 't1', aliases: ['JS', 'JetStream'] });
    assert.equal(merged.name, 'NATS JetStream');
    assert.equal(merged.type, 'technology');
    assert.equal(merged.first_seen, 't0');
    assert.equal(merged.last_seen, 't1');
    assert.deepEqual(merged.aliases, ['jetstream', 'JS'], 'JetStream ≡ jetstream, deduped case-insensitively');
    assert.equal(merged.salience, 0.9, 'store-owned recall state is untouched');
    assert.deepEqual(changed.sort(), ['aliases', 'last_seen']);
  });
  it('takes incoming values for a new record', () => {
    const { merged } = mergeFields('entity', null, { name: 'X', type: 'person', last_seen: 't' });
    assert.equal(merged.name, 'X');
    assert.equal(merged.type, 'person');
  });
  it('decision: rationale/confidence replace, superseded_by never clears', () => {
    const { merged } = mergeFields('decision', { rationale: 'old', confidence: 0.4, superseded_by: 9 }, { rationale: 'new', confidence: 0.8, superseded_by: null });
    assert.equal(merged.rationale, 'new');
    assert.equal(merged.confidence, 0.8);
    assert.equal(merged.superseded_by, 9);
  });
  it('theme: mention_count sums, hierarchy replaces', () => {
    const { merged } = mergeFields('theme', { mention_count: 3, hierarchy_path: '["a"]' }, { mention_count: 1, hierarchy_path: '["a","b"]' });
    assert.equal(merged.mention_count, 4);
    assert.equal(merged.hierarchy_path, '["a","b"]');
  });
  it('union is case-insensitive and bounded', () => {
    const many = Array.from({ length: ALIAS_CAP + 5 }, (_, i) => `alias ${i}`);
    const { merged } = mergeFields('entity', { aliases: ['Alias 0'] }, { aliases: many });
    assert.equal(merged.aliases.length, ALIAS_CAP);
    assert.equal(merged.aliases[0], 'Alias 0');
  });
  it('rejects an unknown kind', () => {
    assert.throws(() => mergeFields('nope', null, {}), /unknown memory kind/);
  });
});

describe('newAliases / canonicalAlias', () => {
  it('drops the display name itself and already-known spellings', () => {
    assert.deepEqual(newAliases('NATS JetStream', ['jetstream'], ['nats_jetstream', 'JetStream', 'JS', ' js ']), ['JS']);
  });
  it('canonicalAlias mirrors canonicalizeName', () => {
    assert.equal(canonicalAlias('  THE_HIDDEN  Truth '), 'the hidden truth');
  });
});
