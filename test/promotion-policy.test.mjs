import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPromotionPolicy,
  validatePromotionPolicy,
  DEFAULT_POLICY_PATH,
  POLICY_CATEGORIES,
} from '../lib/promotion-policy.mjs';

describe('promotion-policy', () => {
  const validPolicy = {
    automatic: ['kanban_events'],
    explicit: ['share_true'],
    threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
    manual_review: ['everything_else'],
  };

  describe('loadPromotionPolicy', () => {
    it('loads and validates the default config file', async () => {
      const policy = await loadPromotionPolicy(DEFAULT_POLICY_PATH);
      assert.deepStrictEqual(policy.automatic, ['kanban_events']);
      assert.deepStrictEqual(policy.explicit, ['share_true']);
      assert.strictEqual(policy.threshold.concept_mention_count, 10);
      assert.strictEqual(policy.threshold.decision_confidence, 0.95);
      assert.deepStrictEqual(policy.manual_review, ['everything_else']);
    });

    it('rejects a missing file', async () => {
      await assert.rejects(
        () => loadPromotionPolicy('/nonexistent/path/policy.yaml'),
        { code: 'ENOENT' }
      );
    });

    it('loads a custom config path', async () => {
      const tmpDir = join(tmpdir(), `promo-policy-test-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
      const customPath = join(tmpDir, 'custom-policy.yaml');
      const yaml = [
        'automatic:',
        '  - kanban_events',
        'explicit:',
        '  - share_true',
        'threshold:',
        '  concept_mention_count: 20',
        '  decision_confidence: 0.99',
        'manual_review:',
        '  - everything_else',
      ].join('\n');
      await writeFile(customPath, yaml, 'utf8');
      try {
        const policy = await loadPromotionPolicy(customPath);
        assert.strictEqual(policy.threshold.concept_mention_count, 20);
        assert.strictEqual(policy.threshold.decision_confidence, 0.99);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('validatePromotionPolicy', () => {
    it('accepts a valid policy object', () => {
      const result = validatePromotionPolicy(validPolicy);
      assert.deepStrictEqual(result, validPolicy);
    });

    it('rejects null input', () => {
      assert.throws(() => validatePromotionPolicy(null), /non-null object/);
    });

    it('rejects missing required category', () => {
      const { threshold, ...partial } = validPolicy;
      assert.throws(
        () => validatePromotionPolicy(partial),
        /Missing required policy category: threshold/
      );
    });

    it('rejects unknown top-level key', () => {
      assert.throws(
        () => validatePromotionPolicy({ ...validPolicy, unknown_key: [] }),
        /Unknown policy category: unknown_key/
      );
    });

    it('rejects non-numeric threshold value', () => {
      assert.throws(
        () => validatePromotionPolicy({
          ...validPolicy,
          threshold: { concept_mention_count: 'five', decision_confidence: 0.95 },
        }),
        /must be a number/
      );
    });

    it('rejects unknown threshold key', () => {
      assert.throws(
        () => validatePromotionPolicy({
          ...validPolicy,
          threshold: { concept_mention_count: 10, decision_confidence: 0.95, unknown_threshold: 5 },
        }),
        /Unknown threshold key: unknown_threshold/
      );
    });
  });

  describe('constants', () => {
    it('DEFAULT_POLICY_PATH ends with config/promotion-policy.yaml', () => {
      assert.ok(DEFAULT_POLICY_PATH.endsWith('config/promotion-policy.yaml'));
    });

    it('POLICY_CATEGORIES contains all four categories', () => {
      assert.deepStrictEqual(
        POLICY_CATEGORIES,
        ['automatic', 'explicit', 'threshold', 'manual_review']
      );
    });
  });
});
