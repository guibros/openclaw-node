#!/usr/bin/env node

/**
 * run-gulf1-eval — Gulf 1 evaluation runner.
 *
 * Runs a curated query set through all three search modes (FTS5, semantic, hybrid)
 * and produces a structured markdown results document for manual scoring.
 *
 * Prerequisites:
 *   - Session embeddings must be populated (run bin/embed-existing-sessions.mjs first).
 *
 * Usage:
 *   node bin/run-gulf1-eval.mjs [--queries path] [--db path] [--out path] [--limit N]
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  initDatabase,
  searchSessions,
  searchSessionsFts,
  hybridSearchSessions,
  DB_PATH,
} from '../lib/mcp-knowledge/core.mjs';

// ─── Query Set Parsing ───────────────────────────────────────────────────────

/**
 * Parse and validate a query set JSON file.
 * @param {string} jsonStr - Raw JSON string
 * @returns {Array<{id: string, query: string, category: string, expected_topic: string}>}
 */
export function parseQuerySet(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new Error('Query set must be a JSON array');
  }
  for (const entry of parsed) {
    if (!entry.id || typeof entry.id !== 'string') {
      throw new Error(`Query entry missing valid "id" field: ${JSON.stringify(entry)}`);
    }
    if (!entry.query || typeof entry.query !== 'string') {
      throw new Error(`Query entry "${entry.id}" missing valid "query" field`);
    }
    if (!entry.category || typeof entry.category !== 'string') {
      throw new Error(`Query entry "${entry.id}" missing valid "category" field`);
    }
    if (!entry.expected_topic || typeof entry.expected_topic !== 'string') {
      throw new Error(`Query entry "${entry.id}" missing valid "expected_topic" field`);
    }
  }
  return parsed;
}

// ─── Evaluation Runner ───────────────────────────────────────────────────────

/**
 * Run a single query through all three search modes.
 * @param {Database} db
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<{fts: Array, semantic: Array, hybrid: Array}>}
 */
async function runQueryAllModes(db, query, limit) {
  let fts = [];
  try {
    fts = searchSessionsFts(db, query, limit);
  } catch { /* empty db or FTS5 syntax issue */ }

  let semantic = [];
  try {
    semantic = await searchSessions(db, query, limit);
  } catch { /* empty db or embedding issue */ }

  let hybrid = [];
  try {
    hybrid = await hybridSearchSessions(db, query, limit);
  } catch { /* empty db */ }

  return { fts, semantic, hybrid };
}

/**
 * Run the full evaluation: all queries × all modes.
 * @param {Database} db
 * @param {Array} queries - Parsed query set
 * @param {number} limit - Top-N results per mode
 * @returns {Promise<Array<{query: object, results: {fts: Array, semantic: Array, hybrid: Array}}>>}
 */
export async function runEvaluation(db, queries, limit = 5) {
  const results = [];
  for (const q of queries) {
    const modeResults = await runQueryAllModes(db, q.query, limit);
    results.push({ query: q, results: modeResults });
  }
  return results;
}

// ─── Results Formatting ──────────────────────────────────────────────────────

/**
 * Format a single result row for the markdown table.
 * @param {object} r - Search result
 * @param {number} rank - 1-based rank
 * @returns {string}
 */
function formatResultRow(r, rank) {
  const snippet = (r.snippet || '').replace(/\n/g, ' ').slice(0, 80);
  return `| ${rank} | ${r.session_id} | ${r.turn_index} | ${r.role} | ${r.score} | ${snippet} |  |`;
}

/**
 * Format a results table header for one search mode.
 * @param {string} mode
 * @returns {string}
 */
const MODE_LABELS = { fts: 'FTS5', semantic: 'Semantic', hybrid: 'Hybrid' };

function formatModeHeader(mode) {
  const label = MODE_LABELS[mode] || mode.toUpperCase();
  return [
    `**${label}** results:`,
    '',
    '| Rank | Session | Turn | Role | Score | Snippet | Relevant? (0-2) |',
    '|------|---------|------|------|-------|---------|-----------------|',
  ].join('\n');
}

/**
 * Aggregate scoring placeholders into a summary section.
 * @param {Array} evalResults - Full evaluation results
 * @returns {string}
 */
export function aggregateScores(evalResults) {
  const lines = [
    '## Aggregate Scores',
    '',
    'Fill in after scoring all queries. For each query, relevance scores are 0-2:',
    '- **0** = not relevant (wrong session or wrong part)',
    '- **1** = partially relevant (right session, wrong part)',
    '- **2** = highly relevant (right session and right part)',
    '',
    '| Mode | Total Possible | Total Score | Percentage |',
    '|------|---------------|-------------|------------|',
    `| FTS5 | ${evalResults.length * 5 * 2} |  |  |`,
    `| Semantic | ${evalResults.length * 5 * 2} |  |  |`,
    `| Hybrid | ${evalResults.length * 5 * 2} |  |  |`,
    '',
    '## Decision',
    '',
    '- [ ] Hybrid is **clearly better** than FTS5 on most queries → proceed to Phase 3',
    '- [ ] Hybrid is **marginally better** → consider whether the rest of the plan is justified',
    '- [ ] Hybrid is **no better or worse** → **stop the plan**',
    '',
  ];
  return lines.join('\n');
}

/**
 * Format the full evaluation results into a markdown document.
 * @param {Array} evalResults - Results from runEvaluation
 * @param {object} meta - Metadata (db path, timestamp, etc.)
 * @returns {string}
 */
export function formatResults(evalResults, meta = {}) {
  const lines = [
    '# Gulf 1 Evaluation Results',
    '',
    `**Date:** ${meta.date || new Date().toISOString().slice(0, 10)}`,
    `**Database:** ${meta.dbPath || 'unknown'}`,
    `**Queries:** ${evalResults.length}`,
    `**Top-N per mode:** ${meta.limit || 5}`,
    '',
    '---',
    '',
    aggregateScores(evalResults),
    '---',
    '',
  ];

  for (const entry of evalResults) {
    const q = entry.query;
    lines.push(`### ${q.id}: ${q.query}`);
    lines.push('');
    lines.push(`**Category:** ${q.category} | **Expected topic:** ${q.expected_topic}`);
    lines.push('');

    for (const mode of ['fts', 'semantic', 'hybrid']) {
      const results = entry.results[mode];
      lines.push(formatModeHeader(mode));

      if (results.length === 0) {
        lines.push('| — | — | — | — | — | (no results) |  |');
      } else {
        for (let i = 0; i < results.length; i++) {
          lines.push(formatResultRow(results[i], i + 1));
        }
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Database Stats Check ────────────────────────────────────────────────────

/**
 * Check if the database has session data indexed.
 * @param {Database} db
 * @returns {{chunks: number, vectors: number, sessions: number}}
 */
export function checkDatabaseReadiness(db) {
  const chunks = db.prepare('SELECT COUNT(*) as c FROM session_chunks').get().c;
  let vectors = 0;
  try {
    vectors = db.prepare('SELECT COUNT(*) as c FROM session_chunk_vectors').get().c;
  } catch { /* table might not exist */ }
  const sessions = db.prepare('SELECT COUNT(DISTINCT session_id) FROM session_chunks').get()['COUNT(DISTINCT session_id)'];
  return { chunks, vectors, sessions };
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const isMain = process.argv[1] && (
  process.argv[1].endsWith('run-gulf1-eval.mjs') ||
  process.argv[1].endsWith('run-gulf1-eval')
);

if (isMain) {
  const { values: opts } = parseArgs({
    options: {
      queries: { type: 'string', default: 'memory-plan/eval/gulf1-queries.json' },
      db: { type: 'string' },
      out: { type: 'string', default: 'memory-plan/eval/gulf1-results.md' },
      limit: { type: 'string', default: '5' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (opts.help) {
    process.stdout.write(`Usage: run-gulf1-eval [--queries path] [--db path] [--out path] [--limit N]

Options:
  --queries PATH   Path to query set JSON (default: memory-plan/eval/gulf1-queries.json)
  --db PATH        Path to knowledge database (default: auto-detect)
  --out PATH       Output markdown file (default: memory-plan/eval/gulf1-results.md)
  --limit N        Top-N results per mode (default: 5)
  -h, --help       Show this help
`);
    process.exit(0);
  }

  const limit = parseInt(opts.limit, 10) || 5;
  const dbPath = opts.db || DB_PATH;

  process.stderr.write(`[gulf1-eval] Loading query set from ${opts.queries}\n`);
  const queryJson = await readFile(opts.queries, 'utf-8');
  const queries = parseQuerySet(queryJson);
  process.stderr.write(`[gulf1-eval] ${queries.length} queries loaded\n`);

  process.stderr.write(`[gulf1-eval] Opening database at ${dbPath}\n`);
  const db = initDatabase(dbPath);

  const readiness = checkDatabaseReadiness(db);
  process.stderr.write(`[gulf1-eval] Database: ${readiness.sessions} sessions, ${readiness.chunks} chunks, ${readiness.vectors} vectors\n`);

  if (readiness.chunks === 0) {
    process.stderr.write('[gulf1-eval] WARNING: No session data indexed. Run bin/embed-existing-sessions.mjs first.\n');
    process.stderr.write('[gulf1-eval] Proceeding with empty results for template generation.\n');
  }

  if (readiness.vectors === 0 && readiness.chunks > 0) {
    process.stderr.write('[gulf1-eval] WARNING: No embeddings found. Semantic search will return empty results.\n');
  }

  process.stderr.write('[gulf1-eval] Running evaluation...\n');
  const evalResults = await runEvaluation(db, queries, limit);

  const output = formatResults(evalResults, { dbPath, limit, date: new Date().toISOString().slice(0, 10) });

  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, output, 'utf-8');
  process.stderr.write(`[gulf1-eval] Results written to ${opts.out}\n`);

  // Summary
  let totalFts = 0, totalSemantic = 0, totalHybrid = 0;
  for (const entry of evalResults) {
    totalFts += entry.results.fts.length;
    totalSemantic += entry.results.semantic.length;
    totalHybrid += entry.results.hybrid.length;
  }
  process.stderr.write(`[gulf1-eval] Results: FTS5=${totalFts}, semantic=${totalSemantic}, hybrid=${totalHybrid} total hits\n`);

  db.close();
  process.stderr.write('[gulf1-eval] Done.\n');
}
