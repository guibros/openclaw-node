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

import { openStore } from '../lib/sqlite-store.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { atomicWriteFileSync } from '../lib/atomic-write.mjs';

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
  // F-Q313/Q410 fix: use shared atomicWriteFileSync helper. The previous
  // writeFileSync was non-atomic; SIGKILL or disk-full mid-write left a
  // truncated checkpoint.json, and the next run's JSON.parse caught the
  // error and silently "started fresh" — re-extracting every session. On
  // a 19-37 hour backfill this matters.
  atomicWriteFileSync(cpPath, JSON.stringify({
    completed: checkpoint.completed,
    failed: checkpoint.failed,
    startedAt: checkpoint.startedAt,
    lastUpdated: new Date().toISOString(),
  }, null, 2) + '\n', { mkdirp: true });
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
  const sessionDb = openStore(sessionDbPath, { readonly: true });

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
        // F-N106 / F-Q303 / F-Q304 fix: classify transient vs permanent
        // failures. Old transient regex matched "fetch failed" anywhere in
        // the message — including inside HTTP 500 body slices from Ollama
        // when the runner watchdog hits (permanent for that input — same
        // size will repeat the failure next run). Now: structured signals
        // only, and `LLM server returned 5xx:` is permanent regardless of
        // body content. Per-session attempt counter caps even legitimate
        // transient failures so a sticky-permanent doesn't infinite-loop.
        const msg = err?.message || '';
        const code = err?.code || err?.cause?.code || '';

        // Queue-shutdown means the daemon is being torn down — this run
        // should END, not get retried piecemeal next run. Surface as
        // permanent for this run; the session will be picked up on next
        // boot since it was never marked complete.
        const isQueueShutdown = /queue is shutting down|queue shutdown/i.test(msg);

        // Permanent: HTTP 5xx (Ollama runner death, OOM, etc.) and schema/
        // parse failures. Structured.
        const isHttp5xx = /^LLM server returned 5\d\d/i.test(msg);
        const isSchemaError = /Zod|invalid_type|JSON\.parse|invalid extraction/i.test(msg);

        // Transient: real network blips + real timeouts only.
        const isTransient = !isHttp5xx && !isSchemaError && (
          err?.name === 'AbortError' ||
          code === 'ETIMEDOUT' ||
          code === 'ECONNRESET' ||
          code === 'ECONNREFUSED' ||
          code === 'EAGAIN' ||
          code === 'EPIPE' ||
          code === 'ENETUNREACH' ||
          /SQLITE_BUSY|queue full/i.test(msg)
        );

        // Per-session attempt counter to escape sticky-transient loops.
        checkpoint.attempts = checkpoint.attempts || {};
        const attemptCount = (checkpoint.attempts[session.id] || 0) + 1;
        checkpoint.attempts[session.id] = attemptCount;
        const tooManyAttempts = attemptCount >= 5;

        if (isQueueShutdown) {
          process.stderr.write(
            `[extract-backfill] STOPPING: queue shutdown during session ${session.id}\n`
          );
          stopped = true;  // exit the outer loop
          break;
        } else if (isTransient && !tooManyAttempts) {
          process.stderr.write(
            `[extract-backfill] TRANSIENT (attempt ${attemptCount}): session ${session.id}: ${msg}\n`
          );
          failed++;
        } else {
          const reason = tooManyAttempts ? `PERMANENT-AFTER-${attemptCount}-ATTEMPTS` : 'PERMANENT';
          process.stderr.write(
            `[extract-backfill] ${reason}: session ${session.id}: ${msg}\n`
          );
          failed++;
          failedSet.add(session.id);
          checkpoint.failed.push(session.id);
          delete checkpoint.attempts[session.id];  // clean up after final
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
