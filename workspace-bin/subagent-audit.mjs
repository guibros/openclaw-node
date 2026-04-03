#!/usr/bin/env node
/**
 * subagent-audit.mjs — Scan JSONL transcripts for sub-agent delegation patterns
 *
 * Extracts Task tool invocations from session transcripts, classifies outcomes,
 * and auto-updates the trust registry + lessons file.
 *
 * Usage:
 *   node bin/subagent-audit.mjs [--dry-run] <jsonl-path>    # audit one file
 *   node bin/subagent-audit.mjs --health-check               # trust registry health
 *
 * Called by memory-daemon:
 *   - Phase 0 (bootstrap): audit previous session's JSONL
 *   - Phase 2 (throttled): --health-check every 30min
 */

import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createInterface } from 'readline';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('subagent-audit');

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(__dirname);
const TRUST_REGISTRY = path.join(WORKSPACE, 'bin/trust-registry');
const LESSONS_FILE = path.join(WORKSPACE, '.learnings/lessons.md');

// ============================================================
// JSONL PARSER — Extract Task tool invocations
// ============================================================

/**
 * Audit a JSONL file for sub-agent delegations.
 * @param {string} jsonlPath
 * @returns {Promise<DelegationResult[]>}
 */
export const auditSession = tracer.wrapAsync('auditSession', async function auditSession(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return [];

  const results = [];
  const pendingTasks = new Map(); // tool_use_id → { soulId, description, timestamp, lineNum }

  const rl = createInterface({
    input: fs.createReadStream(jsonlPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Look for assistant messages with tool_use blocks
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      // Task tool invocation
      if (block.type === 'tool_use' && block.name === 'Task') {
        const input = block.input || {};
        const soulId = input.name || input.subagent_type || 'unknown';
        pendingTasks.set(block.id, {
          soulId,
          description: input.description || input.prompt?.slice(0, 100) || 'no description',
          timestamp: obj.timestamp || new Date().toISOString(),
          lineNum,
        });
      }

      // Tool result — match to pending Task
      if (block.type === 'tool_result' && pendingTasks.has(block.tool_use_id)) {
        const task = pendingTasks.get(block.tool_use_id);
        pendingTasks.delete(block.tool_use_id);

        const resultText = extractResultText(block);
        const result = classifyResult(resultText, block.is_error);
        const errorPattern = result === 'failure' ? extractErrorPattern(resultText) : null;
        const turnsEstimate = Math.max(1, Math.floor((lineNum - task.lineNum) / 3));

        results.push({
          soulId: task.soulId,
          taskDescription: task.description,
          turnsConsumed: turnsEstimate,
          result,
          errorPattern,
          timestamp: task.timestamp,
        });
      }
    }

    // Also check top-level tool_result entries (Claude Code format)
    if (obj.type === 'tool_result' && obj.tool_use_id && pendingTasks.has(obj.tool_use_id)) {
      const task = pendingTasks.get(obj.tool_use_id);
      pendingTasks.delete(obj.tool_use_id);

      const resultText = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content || '');
      const result = classifyResult(resultText, obj.is_error);
      const errorPattern = result === 'failure' ? extractErrorPattern(resultText) : null;

      results.push({
        soulId: task.soulId,
        taskDescription: task.description,
        turnsConsumed: Math.max(1, Math.floor((lineNum - task.lineNum) / 3)),
        result,
        errorPattern,
        timestamp: task.timestamp,
      });
    }
  }

  return results;
}, { tier: 1, category: 'compute' });

function extractResultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ');
  }
  return JSON.stringify(block.content || '');
}

function classifyResult(text, isError) {
  if (isError) return 'failure';
  if (!text) return 'unknown';

  const lower = text.toLowerCase();

  // Explicit failure markers
  if (lower.includes('error:') || lower.includes('failed') ||
      lower.includes('could not') || lower.includes('blocked') ||
      lower.includes('permission denied') || lower.includes('is_error')) {
    return 'failure';
  }

  // Explicit success markers
  if (lower.includes('completed') || lower.includes('done') ||
      lower.includes('success') || lower.includes('finished')) {
    return 'success';
  }

  // Heuristic: long output without error markers is likely success
  if (text.length > 500 && !lower.includes('error') && !lower.includes('fail')) {
    return 'success';
  }

  return 'unknown';
}

function extractErrorPattern(text) {
  if (!text) return null;
  // First meaningful sentence
  const sentences = text.split(/[.!?\n]/).filter(s => s.trim().length > 10);
  return sentences[0]?.trim().slice(0, 200) || null;
}

// ============================================================
// RESULT PROCESSING — Update trust registry + lessons
// ============================================================

/**
 * Process audit results: update trust-registry, append failures to lessons.
 */
export async function processResults(resultsList, dryRun = false) {
  for (const r of resultsList) {
    if (r.result === 'unknown') continue;

    if (!dryRun) {
      // Update trust registry
      try {
        await execFileAsync('python3', [
          TRUST_REGISTRY, 'update', r.soulId,
          '--result', r.result,
          '--turns', String(r.turnsConsumed),
          '--task', r.taskDescription.slice(0, 200),
        ], { cwd: WORKSPACE, timeout: 10000 });
      } catch (e) {
        // Trust registry might not exist yet — that's OK
        if (!e.message.includes('ENOENT')) {
          console.error(`Trust registry update failed for ${r.soulId}: ${e.message}`);
        }
      }

      // Append failures to lessons
      if (r.result === 'failure' && r.errorPattern) {
        const today = new Date().toISOString().split('T')[0];
        const entry = `[error] Sub-agent ${r.soulId} failed: ${r.errorPattern} (auto-extracted, ${today})\n`;
        try {
          fs.appendFileSync(LESSONS_FILE, entry);
        } catch { /* lessons file might not exist */ }
      }
    }
  }
}

/**
 * Trust registry health check — report open circuits and stale entries.
 */
export async function healthCheck(dryRun = false) {
  if (!fs.existsSync(TRUST_REGISTRY)) {
    console.log('Trust registry not found — skipping health check');
    return;
  }

  try {
    const { stdout } = await execFileAsync('python3', [TRUST_REGISTRY, 'status'], {
      cwd: WORKSPACE, timeout: 10000,
    });
    if (stdout.trim()) {
      console.log('Trust registry status:');
      console.log(stdout);
    }
  } catch (e) {
    console.error(`Trust registry health check failed: ${e.message}`);
  }
}

// ============================================================
// CLI
// ============================================================

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doHealthCheck = args.includes('--health-check');
  const jsonlPath = args.find(a => !a.startsWith('--'));

  if (doHealthCheck) {
    healthCheck(dryRun).catch(e => { console.error(e.message); process.exit(1); });
  } else if (jsonlPath) {
    auditSession(jsonlPath)
      .then(async results => {
        console.log(`Found ${results.length} delegations:`);
        for (const r of results) {
          const icon = r.result === 'success' ? '+' : r.result === 'failure' ? '!' : '?';
          console.log(`  [${icon}] ${r.soulId}: ${r.taskDescription} (${r.turnsConsumed} turns, ${r.result})`);
          if (r.errorPattern) console.log(`      Error: ${r.errorPattern}`);
        }

        const actionable = results.filter(r => r.result !== 'unknown');
        if (actionable.length > 0) {
          if (dryRun) {
            console.log(`\nDry run: would update ${actionable.length} trust registry entries`);
          } else {
            await processResults(results);
            console.log(`\nUpdated ${actionable.length} trust registry entries`);
          }
        }
      })
      .catch(e => { console.error(e.message); process.exit(1); });
  } else {
    console.log('Usage:');
    console.log('  node bin/subagent-audit.mjs [--dry-run] <jsonl-path>');
    console.log('  node bin/subagent-audit.mjs --health-check');
  }
}
