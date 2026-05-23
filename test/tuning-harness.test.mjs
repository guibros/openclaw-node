import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONFIGS,
  applyConfig,
  resetConfig,
  runConfigQueries,
  formatTuningReport,
  runTuningHarness,
} from '../bin/run-tuning-harness.mjs';

describe('DEFAULT_CONFIGS', () => {
  it('is a non-empty array of named configs with expected shape', () => {
    assert.ok(Array.isArray(DEFAULT_CONFIGS));
    assert.ok(DEFAULT_CONFIGS.length >= 10, `expected >=10 configs, got ${DEFAULT_CONFIGS.length}`);
    for (const config of DEFAULT_CONFIGS) {
      assert.equal(typeof config.name, 'string');
      assert.equal(typeof config.description, 'string');
      assert.ok(config.env !== null && typeof config.env === 'object');
    }
  });

  it('includes baseline and key tuning variants', () => {
    const names = DEFAULT_CONFIGS.map(c => c.name);
    assert.ok(names.includes('baseline'), 'missing baseline');
    assert.ok(names.includes('low-decay'), 'missing low-decay');
    assert.ok(names.includes('high-decay'), 'missing high-decay');
    assert.ok(names.includes('no-spread'), 'missing no-spread');
    assert.ok(names.includes('aggressive'), 'missing aggressive');
  });
});

describe('applyConfig / resetConfig', () => {
  const envKeys = ['SPREAD_STEPS', 'SPREAD_DECAY', 'SPREAD_THRESHOLD', 'RETRIEVAL_WEIGHTS'];
  let savedBefore;

  beforeEach(() => {
    savedBefore = {};
    for (const key of envKeys) {
      savedBefore[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedBefore[key] !== undefined) {
        process.env[key] = savedBefore[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('sets env vars from config and restores on reset', () => {
    const config = {
      name: 'test',
      description: 'test config',
      env: { SPREAD_DECAY: '0.5', SPREAD_STEPS: '2' },
    };
    const saved = applyConfig(config);
    assert.equal(process.env.SPREAD_DECAY, '0.5');
    assert.equal(process.env.SPREAD_STEPS, '2');
    assert.equal(process.env.SPREAD_THRESHOLD, undefined);
    assert.equal(process.env.RETRIEVAL_WEIGHTS, undefined);

    resetConfig(saved);
    assert.equal(process.env.SPREAD_DECAY, undefined);
    assert.equal(process.env.SPREAD_STEPS, undefined);
  });
});

describe('runConfigQueries', () => {
  it('collects per-query results from a mock pipeline', async () => {
    const mockPipeline = {
      retrieve: async (query, opts) => {
        if (query.includes('NATS')) {
          return [
            { chunk_id: 1, session_id: 's1', turn_index: 0, role: 'user', score: 0.9, snippet: 'NATS result' },
          ];
        }
        return [];
      },
    };

    const queries = [
      { id: 'q01', query: 'How is NATS configured?', category: 'architecture', expected_topic: 'NATS' },
      { id: 'q02', query: 'What is memory?', category: 'memory', expected_topic: 'memory' },
    ];

    const results = await runConfigQueries(mockPipeline, queries, 5);
    assert.equal(results.length, 2);
    assert.equal(results[0].queryId, 'q01');
    assert.equal(results[0].resultCount, 1);
    assert.equal(results[1].queryId, 'q02');
    assert.equal(results[1].resultCount, 0);
  });
});

describe('formatTuningReport', () => {
  it('produces markdown with summary table and per-query matrix', () => {
    const allResults = [
      {
        config: { name: 'baseline', description: 'Default', env: {} },
        queryResults: [
          { queryId: 'q01', query: 'test1', category: 'cat1', resultCount: 3, results: [] },
          { queryId: 'q02', query: 'test2', category: 'cat2', resultCount: 0, results: [] },
        ],
      },
      {
        config: { name: 'low-decay', description: 'Decay 0.3', env: { SPREAD_DECAY: '0.3' } },
        queryResults: [
          { queryId: 'q01', query: 'test1', category: 'cat1', resultCount: 5, results: [] },
          { queryId: 'q02', query: 'test2', category: 'cat2', resultCount: 1, results: [] },
        ],
      },
    ];

    const report = formatTuningReport(allResults, { date: '2026-05-23', queryCount: 2, limit: 5 });

    assert.ok(report.includes('# Retrieval Pipeline Parameter Tuning Report'));
    assert.ok(report.includes('## Configuration Summary'));
    assert.ok(report.includes('baseline'));
    assert.ok(report.includes('low-decay'));
    assert.ok(report.includes('## Delta vs Baseline'));
    assert.ok(report.includes('## Per-Query Hit Counts by Config'));
    assert.ok(report.includes('q01'));
    assert.ok(report.includes('q02'));
    assert.ok(report.includes('## Configuration Details'));
  });
});

describe('runTuningHarness', () => {
  it('runs multiple configs and returns structured results', async () => {
    const queries = [
      { id: 'q01', query: 'test query', category: 'test', expected_topic: 'test' },
    ];

    const configs = [
      { name: 'a', description: 'Config A', env: {} },
      { name: 'b', description: 'Config B', env: { SPREAD_DECAY: '0.5' } },
    ];

    // No databases → all channels disabled → empty results for all queries
    const allResults = await runTuningHarness({
      queries,
      configs,
      limit: 5,
    });

    assert.equal(allResults.length, 2);
    assert.equal(allResults[0].config.name, 'a');
    assert.equal(allResults[1].config.name, 'b');
    assert.equal(allResults[0].queryResults.length, 1);
    assert.equal(allResults[1].queryResults.length, 1);
    assert.equal(allResults[0].queryResults[0].queryId, 'q01');
  });
});
