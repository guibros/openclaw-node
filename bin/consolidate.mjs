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

import { openStore } from '../lib/sqlite-store.mjs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import {
  initConsolidationTables,
  decayWeights,
  reinforceCoOccurrence,
  detectClusters,
  regenerateSummaries,
  detectContradictions,
  evaluatePromotionCandidates,
} from '../lib/consolidation.mjs';
import { buildMemoryEvent } from '../lib/local-event-log.mjs';
import { backfillSessionNotes } from '../lib/obsidian-session-notes.mjs';
import { generateDecisionNotes } from '../lib/obsidian-decision-notes.mjs';
import { generateThemeNotes } from '../lib/obsidian-theme-notes.mjs';
import { generateDailyDigest } from '../lib/obsidian-digest.mjs';

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
 * @param {object} [opts.eventLog] — local event log instance (publishLocal method)
 * @param {string} [opts.nodeId] — node identifier for event emission
 * @returns {Promise<object>} cycle results, including `aborted: true` and
 *   `abortedAt: '<step name>'` when the cycle stopped short.
 */
export async function runConsolidationCycle(opts = {}) {
  const startMs = Date.now();
  const dbPath = opts.dbPath || DEFAULT_DB_PATH;
  const db = opts.db || openStore(dbPath);
  const ownDb = !opts.db;
  const signal = opts.signal || null;
  const eventLog = opts.eventLog || null;
  const nodeId = opts.nodeId || process.env.OPENCLAW_NODE_ID || os.hostname();

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
  let contradictionResult, promotionResult, vaultSurfaceResult;

  try {
    // 1. Init tables
    initConsolidationTables(db);

    // 2. Decay weights
    abortInfo = checkpoint('decay');
    if (!abortInfo) {
      const decayStart = Date.now();
      decayResult = decayWeights(db);
      if (eventLog) {
        const archived = decayResult.archivedNames || [];
        const evt = buildMemoryEvent('memory.decayed', 'consolidation', 'memory', {
          entities_decayed: decayResult.decayedEntities + decayResult.decayedDecisions,
          archived_count: decayResult.archivedEntities,
          // Capped sample of WHICH entities were archived out (the meaningful loss).
          archived_names: archived.slice(0, 20),
          archived_more: Math.max(0, archived.length - 20),
          duration_ms: Date.now() - decayStart,
        }, nodeId);
        eventLog.publishLocal(evt).catch(() => {});
      }
    }

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
      // F-P208 fix: regenerateSummaries' per-concept loop checks the signal
      // and returns { aborted: true } when interrupted mid-loop. Before this
      // fix, the cycle continued running detectContradictions and
      // evaluatePromotionCandidates after a mid-summary abort, and reported
      // `aborted: false` to the caller — masking the partial state.
      if (summaryResult?.aborted) {
        abortInfo = { aborted: true, abortedAt: 'summaries-midloop' };
      }
    }

    // 5b. Vault surfaces beyond concepts. Session/decision/theme/daily notes
    // used to be born ONLY inside the flush-LLM path — which meant they simply
    // stopped whenever the LLM was unavailable or the tail deduped (last real
    // run 2026-06-16; memory review 2026-07-04 §3A). They are DB-driven, so
    // the consolidation cadence is their natural home. Each is best-effort:
    // one writer failing never kills the cycle.
    if (!abortInfo) abortInfo = checkpoint('vault-surfaces');
    if (!abortInfo && !opts.dryRun) {
      const vp = opts.vaultPath ? { vaultPath: opts.vaultPath } : {};
      vaultSurfaceResult = {};
      try {
        const r = await backfillSessionNotes({ db, ...vp, limit: opts.sessionNoteLimit ?? 20 });
        vaultSurfaceResult.sessionNotes = r.generated;
        vaultSurfaceResult.sessionNotesRemaining = r.remaining;
      } catch (e) { vaultSurfaceResult.sessionNotesError = e.message; }
      try {
        const r = await generateDecisionNotes({ db, ...vp });
        vaultSurfaceResult.decisionNotes = r.notes.length;
      } catch (e) { vaultSurfaceResult.decisionNotesError = e.message; }
      try {
        const r = await generateThemeNotes({ db, ...vp });
        vaultSurfaceResult.themeNotes = r.notes.length;
      } catch (e) { vaultSurfaceResult.themeNotesError = e.message; }
      // Daily digest reads vault state — must run after the writers above.
      try {
        const r = await generateDailyDigest({ ...vp });
        vaultSurfaceResult.dailyDigest = r.generated ? 1 : 0;
      } catch (e) { vaultSurfaceResult.dailyDigestError = e.message; }
    }

    // 6. Detect contradictions
    if (!abortInfo) abortInfo = checkpoint('contradictions');
    if (!abortInfo) contradictionResult = detectContradictions(db);

    // 7. Evaluate promotion candidates
    if (!abortInfo) abortInfo = checkpoint('promotion');
    if (!abortInfo) {
      const promoStart = Date.now();
      promotionResult = evaluatePromotionCandidates(db);
      if (eventLog) {
        const names = promotionResult.entityCandidates.map((e) => e.name).filter(Boolean);
        // R20 fix (repair 5.3): emit-on-change. The same ~100 candidates were
        // re-announced every 30-min cycle (nothing ever publishes them), which
        // also fed the watcher's stall detector a fake heartbeat. Decision in
        // DECISIONS: real promotion bookkeeping is federation-era scope (P.3);
        // an unchanged set is not an event.
        const fingerprint = createHash('sha256').update(JSON.stringify({
          e: promotionResult.entityCandidates.map((x) => x.id ?? x.name).sort(),
          d: promotionResult.decisionCandidates.map((x) => x.id ?? x.decision).sort(),
        })).digest('hex');
        const last = db.prepare(`SELECT value FROM consolidation_meta WHERE key = 'last_promoted_fingerprint'`).get()?.value;
        if (last === fingerprint) {
          promotionResult.eventSkipped = true;
        } else {
          const evt = buildMemoryEvent('memory.promoted', 'consolidation', 'memory', {
            entities_promoted: promotionResult.entityCandidates.length + promotionResult.decisionCandidates.length,
            // Capped sample of WHICH entities were promoted (highest-salience kept).
            promoted_names: names.slice(0, 20).map((n) => String(n).slice(0, 200)),
            promoted_more: Math.max(0, names.length - 20),
            duration_ms: Date.now() - promoStart,
          }, nodeId);
          eventLog.publishLocal(evt).catch(() => {});
          db.prepare(`INSERT INTO consolidation_meta (key, value) VALUES ('last_promoted_fingerprint', ?)
                      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(fingerprint);
        }
      }
    }

    const durationMs = Date.now() - startMs;

    return {
      decayed: decayResult,
      reinforced: reinforceResult,
      clusters: clusterResult,
      summariesRegenerated: summaryResult,
      vaultSurfaces: vaultSurfaceResult,
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
  const noEvents = args.includes('--no-events');

  const natsUrl = process.env.OPENCLAW_NATS || process.env.NATS_URL || 'nats://127.0.0.1:4222';
  const nodeId = process.env.OPENCLAW_NODE_ID || os.hostname();

  const opts = { nodeId };
  if (dbIdx !== -1 && args[dbIdx + 1]) opts.dbPath = args[dbIdx + 1];
  if (vaultIdx !== -1 && args[vaultIdx + 1]) opts.vaultPath = args[vaultIdx + 1];
  if (dryRun) opts.dryRun = true;

  let nc = null;

  // Connect to NATS for event emission (unless --no-events)
  if (!noEvents) {
    try {
      const { connect } = await import('nats');
      const { createLocalEventLog } = await import('../lib/local-event-log.mjs');
      nc = await connect({ servers: natsUrl });
      opts.eventLog = await createLocalEventLog(nc, nodeId);
      console.log(`NATS connected (${natsUrl}), events will be emitted.`);
    } catch (err) {
      console.warn(`NATS unavailable (${err.message}); running without event emission.`);
    }
  }

  runConsolidationCycle(opts)
    .then(async result => {
      console.log('Consolidation cycle complete.');
      console.log(`  Duration: ${result.durationMs}ms`);
      console.log(`  Decayed: ${result.decayed.decayedEntities} entities, ${result.decayed.decayedDecisions} decisions, ${result.decayed.archivedEntities} archived`);
      console.log(`  Reinforced: ${result.reinforced.reinforcedEntities} entities across ${result.reinforced.pairs.length} pairs`);
      console.log(`  Clusters: ${result.clusters.clusters.length} detected`);
      console.log(`  Summaries: ${result.summariesRegenerated.regenerated} regenerated`);
      console.log(`  Contradictions: ${result.contradictions.total} found`);
      console.log(`  Promotion candidates: ${result.promotionCandidates.entityCandidates.length} entities, ${result.promotionCandidates.decisionCandidates.length} decisions`);
      if (nc) {
        await nc.flush();
        await nc.close();
      }
    })
    .catch(async err => {
      console.error('Consolidation cycle failed:', err.message);
      if (nc) { try { await nc.close(); } catch {} }
      process.exit(1);
    });
}
