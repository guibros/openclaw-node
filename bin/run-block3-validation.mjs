#!/usr/bin/env node

/**
 * run-block3-validation — Block 3 validation runner.
 *
 * Reads recent sessions from the session store, runs both the regex extractor
 * and the LLM extractor on each, and produces a structured markdown comparison
 * document for manual operator scoring.
 *
 * The output document lands at memory-plan/eval/block-3-validation.md by default.
 * The operator reviews the comparison and makes the go/no-go decision for Block 4.
 *
 * Prerequisites:
 *   - Session store (~/.openclaw/state.db) must have sessions with messages.
 *   - For LLM extraction: Ollama must be running with a supported model.
 *     If Ollama is unavailable, the tool runs regex-only and leaves LLM columns empty.
 *
 * Usage:
 *   node bin/run-block3-validation.mjs
 *   node bin/run-block3-validation.mjs --limit 10 --session-db ~/.openclaw/state.db
 *   node bin/run-block3-validation.mjs --out memory-plan/eval/block-3-validation.md
 *   node bin/run-block3-validation.mjs --llm-base-url http://localhost:11434 --llm-model qwen3:8b
 */

import { openStore } from '../lib/sqlite-store.mjs';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

import { extractFacts, mergeFacts } from '../lib/pre-compression-flush.mjs';
import { extractStructured } from '../lib/extraction-prompt.mjs';
import { createLlmClient } from '../lib/llm-client.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_SESSION_DB = join(homedir(), '.openclaw/state.db');
const DEFAULT_OUT = join(process.cwd(), 'memory-plan/eval/block-3-validation.md');
const DEFAULT_LIMIT = 10;

// ─── Session Reader ──────────────────────────────────────────────────────────

/**
 * Read the N most recent sessions with their messages from the session store.
 *
 * @param {string} dbPath — path to session-store SQLite DB
 * @param {number} limit — number of sessions to read (most recent first)
 * @returns {Array<{id: string, startTime: string, messageCount: number, messages: Array<{role: string, content: string}>}>}
 */
export function readSessions(dbPath, limit = DEFAULT_LIMIT, opts = {}) {
  if (!existsSync(dbPath)) {
    throw new Error(`Session store not found: ${dbPath}`);
  }

  const db = openStore(dbPath, { readonly: true });

  try {
    // For validation we usually want SUBSTANTIVE sessions, not the most recent
    // (which on test machines tend to be 1-message test sessions). The default
    // selects sessions with the most messages so we get real extraction signal.
    // Pass {recent: true} to fall back to the old start_time DESC behavior.
    const orderClause = opts.recent
      ? 'ORDER BY start_time DESC'
      : 'ORDER BY message_count DESC';
    const sessions = db.prepare(
      `SELECT id, source, start_time, message_count FROM sessions ${orderClause} LIMIT ?`
    ).all(limit);

    return sessions.map(session => {
      const messages = db.prepare(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY turn_index ASC'
      ).all(session.id);

      return {
        id: session.id,
        startTime: session.start_time || 'unknown',
        messageCount: session.message_count || messages.length,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      };
    });
  } finally {
    db.close();
  }
}

// ─── Regex Extraction ────────────────────────────────────────────────────────

/**
 * Run the regex extractor on session messages and produce MEMORY.md-style output.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ facts: Array, memoryContent: string, metrics: object }}
 */
export function runRegexExtraction(messages) {
  // Take tail messages (same default as runFlush)
  const tail = messages.slice(-40);
  const facts = extractFacts(tail);

  // Format via mergeFacts starting from empty MEMORY.md
  const { content, added, merged, skipped } = mergeFacts('# Memory\n', facts);

  const categories = new Set(facts.map(f => f.category));

  return {
    facts,
    memoryContent: content,
    metrics: {
      factCount: facts.length,
      addedCount: added,
      mergedCount: merged,
      skippedCount: skipped,
      charLength: content.length,
      categories: [...categories],
    },
  };
}

// ─── LLM Extraction ─────────────────────────────────────────────────────────

/**
 * Run the LLM extractor on session messages and produce MEMORY.md-style output.
 * Uses a temporary in-memory extraction store for isolated generation.
 *
 * @param {object} client — LLM client from createLlmClient()
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} sessionId — session identifier
 * @returns {Promise<{ result: object, memoryContent: string, metrics: object }>}
 */
export async function runLlmExtraction(client, messages, sessionId) {
  // Take tail messages
  const tail = messages.slice(-40);

  // Run structured extraction
  const result = await extractStructured(client, tail);

  // Use a temporary in-memory extraction store for isolated MEMORY.md generation
  const tempStore = createExtractionStore({ dbPath: ':memory:' });

  try {
    tempStore.storeExtractionResult(sessionId, result);
    const memoryContent = tempStore.generateMemoryContent();

    return {
      result,
      memoryContent,
      metrics: {
        entityCount: result.entities.length,
        themeCount: result.themes.length,
        decisionCount: result.decisions.length,
        frictionCount: result.friction_signals.length,
        relationshipCount: result.relationships.length,
        actionCount: result.actions.length,
        charLength: memoryContent.length,
      },
    };
  } finally {
    tempStore.close();
  }
}

// ─── Metrics Aggregation ─────────────────────────────────────────────────────

/**
 * Compute aggregate metrics across all session results.
 *
 * @param {Array<{ sessionId: string, regex: object, llm: object|null }>} results
 * @returns {{ regex: object, llm: object|null, sessionCount: number }}
 */
export function aggregateMetrics(results) {
  const sessionCount = results.length;

  // Aggregate regex metrics
  const regexTotals = {
    totalFacts: 0,
    totalChars: 0,
    avgFacts: 0,
    avgChars: 0,
    allCategories: new Set(),
  };

  for (const r of results) {
    regexTotals.totalFacts += r.regex.metrics.factCount;
    regexTotals.totalChars += r.regex.metrics.charLength;
    for (const c of r.regex.metrics.categories) {
      regexTotals.allCategories.add(c);
    }
  }

  regexTotals.avgFacts = sessionCount > 0 ? Math.round(regexTotals.totalFacts / sessionCount * 10) / 10 : 0;
  regexTotals.avgChars = sessionCount > 0 ? Math.round(regexTotals.totalChars / sessionCount) : 0;
  regexTotals.allCategories = [...regexTotals.allCategories];

  // Aggregate LLM metrics (if available)
  const llmResults = results.filter(r => r.llm !== null);
  let llmTotals = null;

  if (llmResults.length > 0) {
    llmTotals = {
      totalEntities: 0,
      totalThemes: 0,
      totalDecisions: 0,
      totalChars: 0,
      avgEntities: 0,
      avgThemes: 0,
      avgDecisions: 0,
      avgChars: 0,
      sessionsProcessed: llmResults.length,
    };

    for (const r of llmResults) {
      llmTotals.totalEntities += r.llm.metrics.entityCount;
      llmTotals.totalThemes += r.llm.metrics.themeCount;
      llmTotals.totalDecisions += r.llm.metrics.decisionCount;
      llmTotals.totalChars += r.llm.metrics.charLength;
    }

    const n = llmResults.length;
    llmTotals.avgEntities = Math.round(llmTotals.totalEntities / n * 10) / 10;
    llmTotals.avgThemes = Math.round(llmTotals.totalThemes / n * 10) / 10;
    llmTotals.avgDecisions = Math.round(llmTotals.totalDecisions / n * 10) / 10;
    llmTotals.avgChars = Math.round(llmTotals.totalChars / n);
  }

  return { regex: regexTotals, llm: llmTotals, sessionCount };
}

// ─── Comparison Formatter ────────────────────────────────────────────────────

/**
 * Format comparison results into a structured markdown document.
 *
 * @param {Array<{ sessionId: string, startTime: string, messageCount: number, regex: object, llm: object|null }>} results
 * @returns {string} markdown document
 */
export function formatComparison(results) {
  const agg = aggregateMetrics(results);
  const lines = [];

  lines.push('# Block 3 Validation — LLM vs Regex Extraction Comparison');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Sessions evaluated:** ${agg.sessionCount}`);
  lines.push(`**LLM extraction available:** ${agg.llm ? `yes (${agg.llm.sessionsProcessed} sessions)` : 'no (Ollama unavailable)'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Aggregate summary
  lines.push('## Aggregate Metrics');
  lines.push('');
  lines.push('| Metric | Regex | LLM |');
  lines.push('|--------|-------|-----|');
  lines.push(`| Sessions processed | ${agg.sessionCount} | ${agg.llm ? agg.llm.sessionsProcessed : '—'} |`);
  lines.push(`| Avg facts/entities per session | ${agg.regex.avgFacts} | ${agg.llm ? agg.llm.avgEntities : '—'} |`);
  lines.push(`| Avg MEMORY.md chars | ${agg.regex.avgChars} | ${agg.llm ? agg.llm.avgChars : '—'} |`);

  if (agg.llm) {
    lines.push(`| Avg themes per session | — | ${agg.llm.avgThemes} |`);
    lines.push(`| Avg decisions per session | — | ${agg.llm.avgDecisions} |`);
  }

  lines.push(`| Categories/types | ${agg.regex.allCategories.join(', ') || 'none'} | ${agg.llm ? 'entities, themes, decisions, friction, relationships, actions' : '—'} |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Per-session comparison
  lines.push('## Per-Session Comparison');
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`### Session ${i + 1}: \`${r.sessionId}\``);
    lines.push('');
    lines.push(`- **Start time:** ${r.startTime}`);
    lines.push(`- **Message count:** ${r.messageCount}`);
    lines.push('');

    // Regex results
    lines.push('#### Regex Extraction');
    lines.push('');
    lines.push(`- Facts extracted: ${r.regex.metrics.factCount}`);
    lines.push(`- Categories: ${r.regex.metrics.categories.join(', ') || 'none'}`);
    lines.push(`- MEMORY.md length: ${r.regex.metrics.charLength} chars`);
    lines.push('');
    lines.push('<details><summary>Regex MEMORY.md output</summary>');
    lines.push('');
    lines.push('```markdown');
    lines.push(r.regex.memoryContent.trimEnd());
    lines.push('```');
    lines.push('</details>');
    lines.push('');

    // LLM results
    lines.push('#### LLM Extraction');
    lines.push('');

    if (r.llm) {
      lines.push(`- Entities: ${r.llm.metrics.entityCount}`);
      lines.push(`- Themes: ${r.llm.metrics.themeCount}`);
      lines.push(`- Decisions: ${r.llm.metrics.decisionCount}`);
      lines.push(`- Friction signals: ${r.llm.metrics.frictionCount}`);
      lines.push(`- Relationships: ${r.llm.metrics.relationshipCount}`);
      lines.push(`- Actions: ${r.llm.metrics.actionCount}`);
      lines.push(`- MEMORY.md length: ${r.llm.metrics.charLength} chars`);
      lines.push('');
      lines.push('<details><summary>LLM MEMORY.md output</summary>');
      lines.push('');
      lines.push('```markdown');
      lines.push(r.llm.memoryContent.trimEnd());
      lines.push('```');
      lines.push('</details>');
    } else {
      lines.push('*LLM extraction unavailable — Ollama not running or health check failed.*');
    }

    lines.push('');

    // Manual scoring section
    lines.push('#### Manual Scoring');
    lines.push('');
    lines.push('| Criterion | Regex (0-2) | LLM (0-2) | Notes |');
    lines.push('|-----------|-------------|-----------|-------|');
    lines.push('| Semantic coherence | | | |');
    lines.push('| Signal-to-noise ratio | | | |');
    lines.push('| Coverage of key topics | | | |');
    lines.push('| Actionable information | | | |');
    lines.push('| Fragment quality | | | |');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Go/no-go checklist
  lines.push('## Go/No-Go Decision Checklist');
  lines.push('');
  lines.push('Answer each question after scoring all sessions above.');
  lines.push('');
  lines.push('- [ ] LLM extraction produced higher average scores than regex across sessions');
  lines.push('- [ ] LLM extraction produced fewer low-quality fragments (noise)');
  lines.push('- [ ] LLM-generated MEMORY.md is more semantically organized (sections vs flat bullets)');
  lines.push('- [ ] LLM extraction captured decisions and themes that regex missed');
  lines.push('- [ ] No sessions where LLM extraction was significantly worse than regex');
  lines.push('');
  lines.push('**Decision:** _[ GO / NO-GO / ITERATE ]_');
  lines.push('');
  lines.push('**Notes:** _[operator assessment here]_');
  lines.push('');

  return lines.join('\n');
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

/**
 * Run the Block 3 validation.
 *
 * @param {object} opts
 * @param {string} opts.sessionDbPath — path to session-store SQLite DB
 * @param {string} opts.outPath — path to write the comparison document
 * @param {number} opts.limit — number of sessions to evaluate
 * @param {string} opts.llmBaseUrl — LLM server base URL
 * @param {string} opts.llmModel — LLM model identifier
 * @returns {Promise<{ sessionCount: number, llmAvailable: boolean, outputPath: string }>}
 */
export async function runValidation(opts = {}) {
  const {
    sessionDbPath = DEFAULT_SESSION_DB,
    outPath = DEFAULT_OUT,
    limit = DEFAULT_LIMIT,
    llmBaseUrl,
    llmModel,
  } = opts;

  // Read sessions
  const sessions = readSessions(sessionDbPath, limit);
  process.stderr.write(`[block3-validation] read ${sessions.length} sessions\n`);

  if (sessions.length === 0) {
    process.stderr.write('[block3-validation] no sessions found, nothing to validate\n');
    return { sessionCount: 0, llmAvailable: false, outputPath: outPath };
  }

  // Check LLM availability
  let llmClient = null;
  let llmAvailable = false;

  try {
    const clientOpts = {};
    if (llmBaseUrl) clientOpts.baseUrl = llmBaseUrl;
    if (llmModel) clientOpts.model = llmModel;
    llmClient = createLlmClient(clientOpts);

    const health = await llmClient.healthCheck();
    llmAvailable = health.ok;

    if (llmAvailable) {
      process.stderr.write(`[block3-validation] LLM available: ${health.model || 'unknown model'}\n`);
    } else {
      process.stderr.write(`[block3-validation] LLM unavailable: ${health.error || 'unknown error'}\n`);
      llmClient = null;
    }
  } catch (err) {
    process.stderr.write(`[block3-validation] LLM health check failed: ${err.message}\n`);
    llmClient = null;
  }

  // Process each session
  const results = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    process.stderr.write(`[block3-validation] processing session ${i + 1}/${sessions.length}: ${session.id}\n`);

    // Skip sessions with no messages
    if (session.messages.length === 0) {
      process.stderr.write(`[block3-validation] skipping session ${session.id}: no messages\n`);
      continue;
    }

    // Regex extraction (always runs)
    const regex = runRegexExtraction(session.messages);

    // LLM extraction (if available)
    let llm = null;
    if (llmClient) {
      try {
        llm = await runLlmExtraction(llmClient, session.messages, session.id);
      } catch (err) {
        process.stderr.write(`[block3-validation] LLM extraction failed for ${session.id}: ${err.message}\n`);
      }
    }

    results.push({
      sessionId: session.id,
      startTime: session.startTime,
      messageCount: session.messageCount,
      regex,
      llm,
    });
  }

  // Format and write comparison document
  const markdown = formatComparison(results);
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }
  await writeFile(outPath, markdown);

  process.stderr.write(`[block3-validation] wrote comparison to ${outPath}\n`);
  process.stderr.write(`[block3-validation] done: ${results.length} sessions, LLM ${llmAvailable ? 'available' : 'unavailable'}\n`);

  return { sessionCount: results.length, llmAvailable, outputPath: outPath };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''));
if (isMain) {
  const { values } = parseArgs({
    options: {
      'session-db': { type: 'string', default: DEFAULT_SESSION_DB },
      'out': { type: 'string', default: DEFAULT_OUT },
      'limit': { type: 'string', default: String(DEFAULT_LIMIT) },
      'llm-base-url': { type: 'string' },
      'llm-model': { type: 'string' },
    },
  });

  runValidation({
    sessionDbPath: values['session-db'],
    outPath: values['out'],
    limit: parseInt(values['limit'], 10),
    llmBaseUrl: values['llm-base-url'],
    llmModel: values['llm-model'],
  }).catch(err => {
    process.stderr.write(`[block3-validation] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
