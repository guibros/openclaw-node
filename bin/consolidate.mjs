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
 * F-N100 fix (F-H19 regression): destructures `signal` and checks
 * `signal.aborted` between each step. Before this fix the scheduler passed
 * `signal` but `runConsolidationCycle` destructured only the other opts and
 * silently dropped it. The 5-min hard-cap would fire, the wrapping
 * Promise.race would reject, but this function kept running on the same
 * DB until natural completion — two ticks could stack overlapping cycles.
 *
 * Cancellation is cooperative: SQLite steps run to completion (they're
 * single-statement / O(N) at the table scale we deal with), but we don't
 * START the next step once aborted. The LLM-bound `regenerateSummaries`
 * threads the signal down to per-concept granularity.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — path to extraction store DB
 * @param {string} [opts.vaultPath] — Obsidian vault path
 * @param {boolean} [opts.dryRun] — skip writes, just report what would happen
 * @param {object} [opts.db] — pre-opened database (for testing)
 * @param {object} [opts.client] — LLM client for summary generation
 * @param {AbortSignal} [opts.signal] — F-N100: hard-cap cancellation
 * @param {number} [opts.maxConcepts] — F-N101: cap per-cycle summary count
 * @returns {Promise<object>} cycle results, including `aborted: true` and
 *   `abortedAt: '<step name>'` when the cycle stopped short.
 */
export async function runConsolidationCycle(opts = {}) {
  const startMs = Date.now();
  const dbPath = opts.dbPath || DEFAULT_DB_PATH;
  const db = opts.db || new Database(dbPath);
  const ownDb = !opts.db;
  const signal = opts.signal || null;

  // Helper: returns true if the cycle should stop. We check this between
  // every step so a hard-cap fires deterministically rather than racing
  // against whichever step happens to finish next.
  const checkpoint = (stepName) => {
    if (signal?.aborted) {
      return { aborted: true, abortedAt: stepName };
    }
    return null;
  };

  let abortInfo = null;
  let decayResult, reinforceResult, clusterResult;
  let summaryResult = { regenerated: 0 };
  let contradictionResult, promotionResult;

  try {
    db.pragma('journal_mode = WAL');

    // 1. Init tables
    initConsolidationTables(db);

    // 2. Decay weights
    abortInfo = checkpoint('decay');
    if (!abortInfo) decayResult = decayWeights(db);

    // 3. Reinforce co-occurrence
    if (!abortInfo) abortInfo = checkpoint('reinforce');
    if (!abortInfo) reinforceResult = reinforceCoOccurrence(db);

    // 4. Detect clusters
    if (!abortInfo) abortInfo = checkpoint('clusters');
    if (!abortInfo) clusterResult = detectClusters(db);

    // 5. Regenerate summaries (async — uses LLM). Signal flows in so the
    // per-concept loop stops cleanly mid-cycle.
    if (!abortInfo) abortInfo = checkpoint('summaries');
    if (!abortInfo) {
      summaryResult = await regenerateSummaries({
        db,
        vaultPath: opts.vaultPath,
        client: opts.client,
        signal,
        maxConcepts: opts.maxConcepts,
      });
    }

    // 6. Detect contradictions
    if (!abortInfo) abortInfo = checkpoint('contradictions');
    if (!abortInfo) contradictionResult = detectContradictions(db);

    // 7. Evaluate promotion candidates
    if (!abortInfo) abortInfo = checkpoint('promotion');
    if (!abortInfo) promotionResult = evaluatePromotionCandidates(db);

    const durationMs = Date.now() - startMs;

    return {
      decayed: decayResult,
      reinforced: reinforceResult,
      clusters: clusterResult,
      summariesRegenerated: summaryResult,
      contradictions: contradictionResult,
      promotionCandidates: promotionResult,
      durationMs,
      ...(abortInfo || { aborted: false }),
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
