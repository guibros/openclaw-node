#!/usr/bin/env node

/**
 * consolidate.mjs — CLI orchestrator for one full consolidation cycle.
 *
 * Runs all 6 consolidation jobs in sequence:
 *   1. Init tables (entities_archived)
 *   2. Decay weights (salience half-life 14d + archival)
 *   3. Reinforce co-occurrence (bump frequently paired entities)
 *   4. Detect clusters (candidate theme notes)
 *   5. Regenerate summaries (concept notes via LLM/data fallback)
 *   6. Detect contradictions (entity/decision conflicts)
 *   7. Evaluate promotion candidates
 *
 * Usage:
 *   node bin/consolidate.mjs [--db <path>] [--vault-path <path>] [--dry-run]
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import {
  initConsolidationTables,
  decayWeights,
  reinforceCoOccurrence,
  detectClusters,
  regenerateSummaries,
  detectContradictions,
  evaluatePromotionCandidates,
} from '../lib/consolidation.mjs';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.openclaw/state.db');

/**
 * Run one full consolidation cycle.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — path to extraction store DB
 * @param {string} [opts.vaultPath] — Obsidian vault path
 * @param {boolean} [opts.dryRun] — skip writes, just report what would happen
 * @param {object} [opts.db] — pre-opened database (for testing)
 * @returns {Promise<object>} cycle results
 */
export async function runConsolidationCycle(opts = {}) {
  const startMs = Date.now();
  const dbPath = opts.dbPath || DEFAULT_DB_PATH;
  const db = opts.db || new Database(dbPath);
  const ownDb = !opts.db;

  try {
    db.pragma('journal_mode = WAL');

    // 1. Init tables
    initConsolidationTables(db);

    // 2. Decay weights
    const decayResult = decayWeights(db);

    // 3. Reinforce co-occurrence
    const reinforceResult = reinforceCoOccurrence(db);

    // 4. Detect clusters
    const clusterResult = detectClusters(db);

    // 5. Regenerate summaries (async — uses LLM)
    const summaryResult = await regenerateSummaries({
      db,
      vaultPath: opts.vaultPath,
    });

    // 6. Detect contradictions
    const contradictionResult = detectContradictions(db);

    // 7. Evaluate promotion candidates
    const promotionResult = evaluatePromotionCandidates(db);

    const durationMs = Date.now() - startMs;

    return {
      decayed: decayResult,
      reinforced: reinforceResult,
      clusters: clusterResult,
      summariesRegenerated: summaryResult,
      contradictions: contradictionResult,
      promotionCandidates: promotionResult,
      durationMs,
    };
  } finally {
    if (ownDb) db.close();
  }
}

// ── CLI Entry ────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/consolidate.mjs')) {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const vaultIdx = args.indexOf('--vault-path');
  const dryRun = args.includes('--dry-run');

  const opts = {};
  if (dbIdx !== -1 && args[dbIdx + 1]) opts.dbPath = args[dbIdx + 1];
  if (vaultIdx !== -1 && args[vaultIdx + 1]) opts.vaultPath = args[vaultIdx + 1];
  if (dryRun) opts.dryRun = true;

  runConsolidationCycle(opts)
    .then(result => {
      console.log('Consolidation cycle complete.');
      console.log(`  Duration: ${result.durationMs}ms`);
      console.log(`  Decayed: ${result.decayed.decayedEntities} entities, ${result.decayed.decayedDecisions} decisions, ${result.decayed.archivedEntities} archived`);
      console.log(`  Reinforced: ${result.reinforced.reinforcedEntities} entities across ${result.reinforced.pairs.length} pairs`);
      console.log(`  Clusters: ${result.clusters.clusters.length} detected`);
      console.log(`  Summaries: ${result.summariesRegenerated.regenerated} regenerated`);
      console.log(`  Contradictions: ${result.contradictions.total} found`);
      console.log(`  Promotion candidates: ${result.promotionCandidates.entityCandidates.length} entities, ${result.promotionCandidates.decisionCandidates.length} decisions`);
    })
    .catch(err => {
      console.error('Consolidation cycle failed:', err.message);
      process.exit(1);
    });
}
