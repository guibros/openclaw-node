#!/usr/bin/env node

/**
 * run-tuning-harness — Parameter tuning harness for the 5-channel retrieval pipeline.
 *
 * Runs the Gulf-1 25-query evaluation set through createRetrievalPipeline with
 * multiple parameter configurations (spreading activation decay/steps/threshold
 * and channel weights) and produces a structured markdown comparison report.
 *
 * Usage:
 *   node bin/run-tuning-harness.mjs [--queries path] [--db path] [--extraction-db path] [--graph-db path] [--out path] [--limit N]
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseQuerySet } from './run-gulf1-eval.mjs';
import { createRetrievalPipeline } from '../lib/retrieval-pipeline.mjs';

// ─── Default Configurations ──────────────────────────────────────────────────

/**
 * Named parameter configurations for tuning.
 * Each config specifies env vars to set before creating a pipeline instance.
 *
 * @type {Array<{name: string, description: string, env: Object<string, string>}>}
 */
export const DEFAULT_CONFIGS = [
  {
    name: 'baseline',
    description: 'Default parameters (steps=3, decay=0.7, threshold=0.1, equal weights)',
    env: {},
  },
  {
    name: 'low-decay',
    description: 'Rapid activation falloff (decay=0.3)',
    env: { SPREAD_DECAY: '0.3' },
  },
  {
    name: 'high-decay',
    description: 'Wide activation propagation (decay=0.9)',
    env: { SPREAD_DECAY: '0.9' },
  },
  {
    name: 'short-steps',
    description: 'Direct neighbors only (steps=1)',
    env: { SPREAD_STEPS: '1' },
  },
  {
    name: 'long-steps',
    description: 'Deep propagation (steps=5)',
    env: { SPREAD_STEPS: '5' },
  },
  {
    name: 'low-threshold',
    description: 'Include weak activations (threshold=0.01)',
    env: { SPREAD_THRESHOLD: '0.01' },
  },
  {
    name: 'high-threshold',
    description: 'Only strong activations (threshold=0.2)',
    env: { SPREAD_THRESHOLD: '0.2' },
  },
  {
    name: 'fts-heavy',
    description: 'FTS5 channel weight=3, rest=1',
    env: { RETRIEVAL_WEIGHTS: 'fts:3,vec:1,entity:1,theme:1,spread:1' },
  },
  {
    name: 'vec-heavy',
    description: 'Vector/semantic channel weight=3, rest=1',
    env: { RETRIEVAL_WEIGHTS: 'fts:1,vec:3,entity:1,theme:1,spread:1' },
  },
  {
    name: 'spread-heavy',
    description: 'Spreading activation channel weight=3, rest=1',
    env: { RETRIEVAL_WEIGHTS: 'fts:1,vec:1,entity:1,theme:1,spread:3' },
  },
  {
    name: 'no-spread',
    description: 'Spreading activation disabled (spread weight=0)',
    env: { RETRIEVAL_WEIGHTS: 'fts:1,vec:1,entity:1,theme:1,spread:0' },
  },
  {
    name: 'aggressive',
    description: 'Max activation coverage (steps=5, decay=0.9, threshold=0.01)',
    env: { SPREAD_STEPS: '5', SPREAD_DECAY: '0.9', SPREAD_THRESHOLD: '0.01' },
  },
];

// ─── Env Var Management ──────────────────────────────────────────────────────

const TUNING_ENV_KEYS = ['SPREAD_STEPS', 'SPREAD_DECAY', 'SPREAD_THRESHOLD', 'RETRIEVAL_WEIGHTS'];

/**
 * Apply a config's env vars. Saves previous values for restoration.
 * @param {{ env: Object<string, string> }} config
 * @returns {Object<string, string|undefined>} — saved previous values
 */
export function applyConfig(config) {
  const saved = {};
  for (const key of TUNING_ENV_KEYS) {
    saved[key] = process.env[key];
    if (config.env[key] !== undefined) {
      process.env[key] = config.env[key];
    } else {
      delete process.env[key];
    }
  }
  return saved;
}

/**
 * Restore env vars from saved values.
 * @param {Object<string, string|undefined>} saved
 */
export function resetConfig(saved) {
  for (const key of TUNING_ENV_KEYS) {
    if (saved[key] !== undefined) {
      process.env[key] = saved[key];
    } else {
      delete process.env[key];
    }
  }
}

// ─── Query Execution ─────────────────────────────────────────────────────────

/**
 * Run all queries through a retrieval pipeline and collect results.
 * @param {{ retrieve: Function }} pipeline
 * @param {Array<{id: string, query: string, category: string, expected_topic: string}>} queries
 * @param {number} limit — top-K per query
 * @returns {Promise<Array<{queryId: string, query: string, category: string, resultCount: number, results: Array}>>}
 */
export async function runConfigQueries(pipeline, queries, limit = 5) {
  const results = [];
  for (const q of queries) {
    let hits = [];
    try {
      hits = await pipeline.retrieve(q.query, { k: limit });
    } catch { /* pipeline may fail on empty DBs */ }
    results.push({
      queryId: q.id,
      query: q.query,
      category: q.category,
      resultCount: hits.length,
      results: hits,
    });
  }
  return results;
}

// ─── Report Formatting ───────────────────────────────────────────────────────

/**
 * Format the full tuning report as markdown.
 * @param {Array<{config: {name: string, description: string, env: object}, queryResults: Array}>} allResults
 * @param {{ date?: string, queryCount?: number, limit?: number }} meta
 * @returns {string}
 */
export function formatTuningReport(allResults, meta = {}) {
  const lines = [
    '# Retrieval Pipeline Parameter Tuning Report',
    '',
    `**Date:** ${meta.date || new Date().toISOString().slice(0, 10)}`,
    `**Queries:** ${meta.queryCount || (allResults[0]?.queryResults?.length || 0)}`,
    `**Top-K per query:** ${meta.limit || 5}`,
    `**Configurations tested:** ${allResults.length}`,
    '',
    '---',
    '',
  ];

  // Summary table
  lines.push('## Configuration Summary');
  lines.push('');
  lines.push('| Config | Description | Total Hits | Queries w/ Results | Avg Hits/Query |');
  lines.push('|--------|-------------|------------|-------------------|----------------|');

  for (const entry of allResults) {
    const totalHits = entry.queryResults.reduce((s, q) => s + q.resultCount, 0);
    const queriesWithResults = entry.queryResults.filter(q => q.resultCount > 0).length;
    const queryCount = entry.queryResults.length;
    const avgHits = queryCount > 0 ? (totalHits / queryCount).toFixed(1) : '0.0';
    lines.push(`| ${entry.config.name} | ${entry.config.description} | ${totalHits} | ${queriesWithResults}/${queryCount} | ${avgHits} |`);
  }
  lines.push('');

  // Delta table: compare each config to baseline
  const baselineEntry = allResults.find(e => e.config.name === 'baseline');
  if (baselineEntry && allResults.length > 1) {
    lines.push('## Delta vs Baseline');
    lines.push('');
    lines.push('| Config | Total Hits Delta | Queries w/ Results Delta |');
    lines.push('|--------|-----------------|-------------------------|');

    const baselineTotal = baselineEntry.queryResults.reduce((s, q) => s + q.resultCount, 0);
    const baselineWithResults = baselineEntry.queryResults.filter(q => q.resultCount > 0).length;

    for (const entry of allResults) {
      if (entry.config.name === 'baseline') continue;
      const totalHits = entry.queryResults.reduce((s, q) => s + q.resultCount, 0);
      const queriesWithResults = entry.queryResults.filter(q => q.resultCount > 0).length;
      const hitsDelta = totalHits - baselineTotal;
      const queryDelta = queriesWithResults - baselineWithResults;
      const hitsSign = hitsDelta >= 0 ? '+' : '';
      const querySign = queryDelta >= 0 ? '+' : '';
      lines.push(`| ${entry.config.name} | ${hitsSign}${hitsDelta} | ${querySign}${queryDelta} |`);
    }
    lines.push('');
  }

  // Per-query comparison matrix
  lines.push('## Per-Query Hit Counts by Config');
  lines.push('');
  const configNames = allResults.map(e => e.config.name);
  lines.push(`| Query | Category | ${configNames.join(' | ')} |`);
  lines.push(`|-------|----------|${configNames.map(() => '---').join('|')}|`);

  if (allResults.length > 0 && allResults[0].queryResults.length > 0) {
    const queryCount = allResults[0].queryResults.length;
    for (let qi = 0; qi < queryCount; qi++) {
      const q = allResults[0].queryResults[qi];
      const counts = allResults.map(e => String(e.queryResults[qi]?.resultCount ?? 0));
      lines.push(`| ${q.queryId} | ${q.category} | ${counts.join(' | ')} |`);
    }
  }
  lines.push('');

  // Env var reference
  lines.push('## Configuration Details');
  lines.push('');
  for (const entry of allResults) {
    const envStr = Object.keys(entry.config.env).length > 0
      ? Object.entries(entry.config.env).map(([k, v]) => `${k}=${v}`).join(', ')
      : '(all defaults)';
    lines.push(`- **${entry.config.name}:** ${envStr}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Run the full tuning harness.
 * @param {{ queries: Array, knowledgeDb?: Database, extractionDb?: Database, graphCache?: object, configs?: Array, limit?: number }} opts
 * @returns {Promise<Array<{config: object, queryResults: Array}>>}
 */
export async function runTuningHarness(opts) {
  const {
    queries,
    knowledgeDb,
    extractionDb,
    graphCache,
    configs = DEFAULT_CONFIGS,
    limit = 5,
  } = opts;

  const allResults = [];

  for (const config of configs) {
    const saved = applyConfig(config);
    try {
      const pipeline = createRetrievalPipeline({ knowledgeDb, extractionDb, graphCache });
      const queryResults = await runConfigQueries(pipeline, queries, limit);
      allResults.push({ config, queryResults });
    } finally {
      resetConfig(saved);
    }
  }

  return allResults;
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const isMain = process.argv[1] && (
  process.argv[1].endsWith('run-tuning-harness.mjs') ||
  process.argv[1].endsWith('run-tuning-harness')
);

if (isMain) {
  const { values: opts } = parseArgs({
    options: {
      queries: { type: 'string', default: 'memory-plan/eval/gulf1-queries.json' },
      db: { type: 'string' },
      'extraction-db': { type: 'string' },
      'graph-db': { type: 'string' },
      out: { type: 'string', default: 'memory-plan/eval/tuning-results.md' },
      limit: { type: 'string', default: '5' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (opts.help) {
    process.stdout.write(`Usage: run-tuning-harness [--queries path] [--db path] [--extraction-db path] [--graph-db path] [--out path] [--limit N]

Options:
  --queries PATH         Path to query set JSON (default: memory-plan/eval/gulf1-queries.json)
  --db PATH              Path to knowledge database (default: auto-detect)
  --extraction-db PATH   Path to extraction store database (default: auto-detect)
  --graph-db PATH        Path to graph cache database (default: auto-detect)
  --out PATH             Output markdown file (default: memory-plan/eval/tuning-results.md)
  --limit N              Top-K results per query per config (default: 5)
  -h, --help             Show this help
`);
    process.exit(0);
  }

  const limit = parseInt(opts.limit, 10) || 5;

  process.stderr.write(`[tuning] Loading query set from ${opts.queries}\n`);
  const queryJson = await readFile(opts.queries, 'utf-8');
  const queries = parseQuerySet(queryJson);
  process.stderr.write(`[tuning] ${queries.length} queries loaded\n`);

  // Open databases
  let knowledgeDb = null;
  let extractionDb = null;
  let graphCache = null;

  if (opts.db) {
    const { initDatabase } = await import('../lib/mcp-knowledge/core.mjs');
    knowledgeDb = initDatabase(opts.db);
    process.stderr.write(`[tuning] Knowledge DB: ${opts.db}\n`);
  } else {
    try {
      const { initDatabase, DB_PATH } = await import('../lib/mcp-knowledge/core.mjs');
      knowledgeDb = initDatabase(DB_PATH);
      process.stderr.write(`[tuning] Knowledge DB: ${DB_PATH}\n`);
    } catch {
      process.stderr.write('[tuning] WARNING: No knowledge DB found. FTS5 and vector channels disabled.\n');
    }
  }

  if (opts['extraction-db']) {
    const { createExtractionStore } = await import('../lib/extraction-store.mjs');
    const store = createExtractionStore({ dbPath: opts['extraction-db'] });
    extractionDb = store.db;
    process.stderr.write(`[tuning] Extraction DB: ${opts['extraction-db']}\n`);
  } else {
    try {
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const defaultPath = join(homedir(), '.openclaw', 'state.db');
      const { openStore } = await import('../lib/sqlite-store.mjs');
      extractionDb = openStore(defaultPath, { readonly: true });
      process.stderr.write(`[tuning] Extraction DB: ${defaultPath}\n`);
    } catch {
      process.stderr.write('[tuning] WARNING: No extraction DB found. Entity/theme/spread channels disabled.\n');
    }
  }

  if (opts['graph-db']) {
    const { createGraphCache } = await import('../bin/obsidian-graph-cache.mjs');
    graphCache = createGraphCache({ dbPath: opts['graph-db'] });
    process.stderr.write(`[tuning] Graph DB: ${opts['graph-db']}\n`);
  } else {
    try {
      const { createGraphCache } = await import('../bin/obsidian-graph-cache.mjs');
      graphCache = createGraphCache();
      process.stderr.write('[tuning] Graph cache: default path\n');
    } catch {
      process.stderr.write('[tuning] WARNING: No graph cache found. Spreading activation channel disabled.\n');
    }
  }

  process.stderr.write(`[tuning] Running ${DEFAULT_CONFIGS.length} configurations x ${queries.length} queries...\n`);
  const allResults = await runTuningHarness({
    queries,
    knowledgeDb,
    extractionDb,
    graphCache,
    limit,
  });

  const report = formatTuningReport(allResults, {
    date: new Date().toISOString().slice(0, 10),
    queryCount: queries.length,
    limit,
  });

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, report, 'utf-8');
  process.stderr.write(`[tuning] Report written to ${opts.out}\n`);

  // Summary
  for (const entry of allResults) {
    const totalHits = entry.queryResults.reduce((s, q) => s + q.resultCount, 0);
    const withResults = entry.queryResults.filter(q => q.resultCount > 0).length;
    process.stderr.write(`[tuning]   ${entry.config.name}: ${totalHits} hits, ${withResults}/${queries.length} queries with results\n`);
  }

  if (knowledgeDb) knowledgeDb.close();
  if (extractionDb && typeof extractionDb.close === 'function') extractionDb.close();
  if (graphCache && typeof graphCache.close === 'function') graphCache.close();

  process.stderr.write('[tuning] Done.\n');
}
