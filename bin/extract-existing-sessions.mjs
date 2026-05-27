#!/usr/bin/env node
/**
 * bin/extract-existing-sessions.mjs — Backfill: run LLM extraction over all
 * historical sessions in the session-store database.
 *
 * Reads sessions from ~/.openclaw/state.db, runs extractStructured() on the
 * tail of each session's messages, and stores results in the extraction store
 * (entities, themes, mentions, decisions). After all sessions are processed,
 * optionally regenerates concept notes and refreshes the adjacency cache.
 *
 * Resumable: tracks progress in a checkpoint file. SIGINT stops gracefully.
 * Designed for long-running background execution (19-37 hours on 225 sessions
 * at Qwen3-8B speed).
 *
 * Usage:
 *   node bin/extract-existing-sessions.mjs
 *   node bin/extract-existing-sessions.mjs --session-db ~/.openclaw/state.db
 *   node bin/extract-existing-sessions.mjs --tail 30 --skip-notes --skip-graph
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

import { createLlmClient } from '../lib/llm-client.mjs';
import { extractStructured } from '../lib/extraction-prompt.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SESSION_DB = join(homedir(), '.openclaw/state.db');
export const DEFAULT_EXTRACTION_DB = join(homedir(), '.openclaw/state.db');
export const DEFAULT_CHECKPOINT = join(homedir(), '.openclaw/.extract-migration-checkpoint.json');

/**
 * Default tail message count for extraction. Reduced from the daemon's 40 to 20
 * per Block 3 carry-forward — 40 turns produces redundant content beyond ~20-turn
 * window and causes timeouts on large sessions.
 */
export const DEFAULT_TAIL_COUNT = 20;

// ─── Checkpoint helpers ──────────────────────────────────────────────────────

export function loadCheckpoint(path) {
  if (!existsSync(path)) return { completed: [], failed: [], startedAt: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      completed: raw.completed || [],
      failed: raw.failed || [],
      startedAt: raw.startedAt || null,
    };
  } catch {
    return { completed: [], failed: [], startedAt: null };
  }
}

export function saveCheckpoint(cpPath, checkpoint) {
  const dir = dirname(cpPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(cpPath, JSON.stringify({
    completed: checkpoint.completed,
    failed: checkpoint.failed,
    startedAt: checkpoint.startedAt,
    lastUpdated: new Date().toISOString(),
  }, null, 2) + '\n');
}

// ─── Extraction core ─────────────────────────────────────────────────────────

/**
 * Run LLM extraction over all historical sessions.
 *
 * @param {Object} opts
 * @param {string} [opts.sessionDbPath] - Path to session-store SQLite DB
 * @param {string} [opts.extractionDbPath] - Path to extraction-store SQLite DB
 * @param {string} [opts.checkpointPath] - Path to checkpoint JSON file
 * @param {number} [opts.tailCount] - Number of tail messages per session
 * @param {boolean} [opts.skipNotes] - Skip concept note regeneration
 * @param {boolean} [opts.skipGraph] - Skip graph cache refresh
 * @param {object} [opts.llmClient] - LLM client (injected for testing)
 * @param {object} [opts.extractionStore] - Extraction store (injected for testing)
 * @param {Function} [opts.extractFn] - Extraction function (injected for testing)
 * @returns {Promise<{processed: number, skipped: number, failed: number, total: number}>}
 */
export async function runExtraction(opts = {}) {
  const {
    sessionDbPath = DEFAULT_SESSION_DB,
    extractionDbPath = DEFAULT_EXTRACTION_DB,
    checkpointPath = DEFAULT_CHECKPOINT,
    tailCount = DEFAULT_TAIL_COUNT,
    skipNotes = false,
    skipGraph = false,
  } = opts;

  // LLM client — injected or created
  const client = opts.llmClient || createLlmClient();

  // Health check — exit gracefully if LLM unavailable
  if (!opts.llmClient) {
    const health = await client.healthCheck();
    if (!health.ok) {
      process.stderr.write(
        `[extract-backfill] LLM server unreachable: ${health.error}\n` +
        `[extract-backfill] Start Ollama and try again.\n`
      );
      return { processed: 0, skipped: 0, failed: 0, total: 0 };
    }
    process.stderr.write(`[extract-backfill] LLM server OK (model: ${health.model})\n`);
  }

  // Open session store (read-only)
  if (!existsSync(sessionDbPath)) {
    process.stderr.write(`[extract-backfill] session store not found: ${sessionDbPath}\n`);
    return { processed: 0, skipped: 0, failed: 0, total: 0 };
  }
  const sessionDb = new Database(sessionDbPath, { readonly: true });

  // Open extraction store (read-write)
  const store = opts.extractionStore || createExtractionStore({ dbPath: extractionDbPath });
  const extractFn = opts.extractFn || extractStructured;

  // Load checkpoint
  const checkpoint = loadCheckpoint(checkpointPath);
  if (!checkpoint.startedAt) checkpoint.startedAt = new Date().toISOString();
  const completedSet = new Set(checkpoint.completed);
  const failedSet = new Set(checkpoint.failed);

  // Query all sessions
  const sessions = sessionDb.prepare(
    'SELECT id, source, start_time, message_count FROM sessions ORDER BY start_time ASC'
  ).all();
  const total = sessions.length;

  process.stderr.write(`[extract-backfill] found ${total} sessions in session store\n`);
  process.stderr.write(`[extract-backfill] checkpoint: ${completedSet.size} completed, ${failedSet.size} failed\n`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let stopped = false;

  // Graceful SIGINT handling
  const onSigint = () => { stopped = true; };
  process.on('SIGINT', onSigint);

  try {
    for (let i = 0; i < sessions.length; i++) {
      if (stopped) {
        process.stderr.write(`[extract-backfill] SIGINT received, stopping gracefully\n`);
        break;
      }

      const session = sessions[i];

      // Skip if already completed or already failed
      if (completedSet.has(session.id) || failedSet.has(session.id)) {
        skipped++;
        continue;
      }

      // Get messages for this session
      const messages = sessionDb.prepare(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY turn_index ASC'
      ).all(session.id);

      // Skip sessions with no messages
      if (messages.length === 0) {
        completedSet.add(session.id);
        checkpoint.completed.push(session.id);
        skipped++;
        saveCheckpoint(checkpointPath, checkpoint);
        continue;
      }

      // Form tail (last N messages)
      const tail = messages.slice(-tailCount).map(m => ({ role: m.role, content: m.content }));

      // Run LLM extraction — per-session try/catch (do not abort on individual failures)
      try {
        const result = await extractFn(client, tail);
        store.storeExtractionResult(session.id, result);
        processed++;

        completedSet.add(session.id);
        checkpoint.completed.push(session.id);
      } catch (err) {
        // F-N106 fix: distinguish transient from permanent failures. Old code
        // pushed every error into checkpoint.failed → permanent skip on next
        // run. Queue-full (F-C7 pressure), DB-locked, Ollama-busy, and
        // network blips are all transient — they should retry next run.
        // Only schema/parse failures + structural data errors are permanent.
        const msg = err?.message || '';
        const isTransient =
          /queue full|queue is shutting down|SQLITE_BUSY|EAGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg) ||
          err?.name === 'AbortError' ||
          err?.code === 'ETIMEDOUT';

        if (isTransient) {
          process.stderr.write(
            `[extract-backfill] TRANSIENT: session ${session.id} skipped (will retry next run): ${msg}\n`
          );
          // Do NOT add to failedSet — leave the session unmarked so the
          // next run picks it up. Count as failed for this run's progress.
          failed++;
        } else {
          process.stderr.write(
            `[extract-backfill] PERMANENT: session ${session.id} failed: ${msg}\n`
          );
          failed++;
          failedSet.add(session.id);
          checkpoint.failed.push(session.id);
        }
      }

      saveCheckpoint(checkpointPath, checkpoint);

      // Progress report every 5 sessions
      if ((processed + failed) % 5 === 0 && (processed + failed) > 0) {
        process.stderr.write(
          `[extract-backfill] progress: ${processed + skipped + failed}/${total}` +
          ` (${processed} extracted, ${failed} failed, ${skipped} skipped)\n`
        );
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    sessionDb.close();
    if (!opts.extractionStore) store.close();
  }

  process.stderr.write(
    `[extract-backfill] extraction done: ${processed} extracted, ${failed} failed, ${skipped} skipped\n`
  );

  // Post-extraction: regenerate concept notes
  if (!skipNotes && processed > 0) {
    try {
      process.stderr.write(`[extract-backfill] regenerating concept notes...\n`);
      const { generateConceptNotes } = await import('../lib/obsidian-summarizer.mjs');
      await generateConceptNotes({ dbPath: extractionDbPath, llmClient: client });
      process.stderr.write(`[extract-backfill] concept notes regenerated.\n`);
    } catch (err) {
      process.stderr.write(`[extract-backfill] WARN: concept note generation failed: ${err.message}\n`);
    }
  }

  // Post-extraction: refresh graph cache
  if (!skipGraph && processed > 0) {
    try {
      process.stderr.write(`[extract-backfill] refreshing graph cache...\n`);
      const { createGraphCache } = await import('../bin/obsidian-graph-cache.mjs');
      const cache = createGraphCache();
      await cache.refreshCache();
      const stats = cache.getStats();
      cache.close();
      process.stderr.write(
        `[extract-backfill] graph cache refreshed: ${stats.nodeCount} nodes, ${stats.edgeCount} edges\n`
      );
    } catch (err) {
      process.stderr.write(`[extract-backfill] WARN: graph cache refresh failed: ${err.message}\n`);
    }
  }

  return { processed, skipped, failed, total };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''));
if (isMain) {
  const { values } = parseArgs({
    options: {
      'session-db': { type: 'string', default: DEFAULT_SESSION_DB },
      'extraction-db': { type: 'string', default: DEFAULT_EXTRACTION_DB },
      'checkpoint': { type: 'string', default: DEFAULT_CHECKPOINT },
      'tail': { type: 'string', default: String(DEFAULT_TAIL_COUNT) },
      'skip-notes': { type: 'boolean', default: false },
      'skip-graph': { type: 'boolean', default: false },
    },
  });

  runExtraction({
    sessionDbPath: values['session-db'],
    extractionDbPath: values['extraction-db'],
    checkpointPath: values['checkpoint'],
    tailCount: parseInt(values['tail'], 10),
    skipNotes: values['skip-notes'],
    skipGraph: values['skip-graph'],
  }).then(result => {
    process.stderr.write(
      `[extract-backfill] final: ${result.processed} extracted, ` +
      `${result.failed} failed, ${result.skipped} skipped out of ${result.total}\n`
    );
  }).catch(err => {
    process.stderr.write(`[extract-backfill] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
