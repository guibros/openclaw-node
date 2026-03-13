/**
 * agent-activity.js — Claude Code JSONL Activity Detection for OpenClaw Mesh
 *
 * Reads Claude Code's structured JSONL session files to detect agent state
 * without requiring self-reporting (zero token cost).
 *
 * Ported from ComposioHQ/agent-orchestrator's agent-claude-code plugin.
 * Adapted for OpenClaw's mesh architecture.
 *
 * Usage:
 *   const { getActivityState, getSessionInfo } = require('./agent-activity');
 *
 *   // During task execution — what is the agent doing right now?
 *   const state = await getActivityState('/tmp/mesh-agent-work');
 *   // → { state: 'active'|'ready'|'idle'|'waiting_input'|'blocked'|'exited', timestamp }
 *
 *   // After task completion — cost + summary extraction
 *   const info = await getSessionInfo('/tmp/mesh-agent-work');
 *   // → { summary, cost: { inputTokens, outputTokens, estimatedCostUsd }, sessionId }
 */

const { readdir, stat, open, readFile } = require('fs/promises');
const { join, basename } = require('path');
const { homedir } = require('os');

// ── Path Encoding ────────────────────────────────────

/**
 * Convert a workspace path to Claude's project directory path.
 * Claude stores sessions at ~/.claude/projects/{encoded-path}/
 *
 * Encoding: strip leading /, replace all / and . with -
 * e.g. /tmp/mesh-agent-work → -tmp-mesh-agent-work
 *      /Users/dev/.worktrees/ao → -Users-dev--worktrees-ao
 */
function toClaudeProjectPath(workspacePath) {
  const normalized = workspacePath.replace(/\\/g, '/');
  return normalized.replace(/:/g, '').replace(/[/.]/g, '-');
}

/**
 * Get the Claude project directory for a workspace path.
 * Falls back to scanning ~/.claude/projects/ by mtime if computed path doesn't exist.
 * This guards against Claude changing its path encoding between versions.
 */
async function getProjectDir(workspacePath) {
  const encoded = toClaudeProjectPath(workspacePath);
  const computed = join(homedir(), '.claude', 'projects', encoded);

  // Fast path: computed directory exists
  try {
    await stat(computed);
    return computed;
  } catch { /* doesn't exist — try fallback */ }

  // Fallback: scan projects/ for recently modified dirs that contain JSONL files
  // matching our workspace. This catches encoding mismatches.
  const projectsBase = join(homedir(), '.claude', 'projects');
  let dirs;
  try {
    dirs = await readdir(projectsBase);
  } catch {
    return computed; // no projects dir at all — return computed for null result downstream
  }

  // Find dirs modified in the last hour, sorted newest first
  const candidates = [];
  for (const d of dirs) {
    const fullPath = join(projectsBase, d);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory() && Date.now() - s.mtimeMs < 3600000) {
        candidates.push({ path: fullPath, mtime: s.mtimeMs });
      }
    } catch { /* skip */ }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  // Prefer a candidate whose dir name contains a key part of the workspace path
  // (guards against returning wrong session when multiple Claude instances run)
  const pathParts = workspacePath.split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1] || '';

  for (const { path: dirPath } of candidates) {
    const dirName = basename(dirPath);
    if (lastPart && dirName.includes(lastPart)) {
      console.warn(`[agent-activity] Computed path "${encoded}" not found. Using matched fallback: ${dirPath}`);
      return dirPath;
    }
  }

  // No name-matched candidate — fall back to most recent as last resort
  if (candidates.length > 0) {
    console.warn(`[agent-activity] Computed path "${encoded}" not found. Using mtime fallback: ${candidates[0].path}`);
    return candidates[0].path;
  }

  return computed;
}

// ── JSONL File Discovery ─────────────────────────────

/**
 * Find the most recently modified .jsonl session file in a project directory.
 * Excludes agent-*.jsonl files (internal Claude bookkeeping).
 */
async function findLatestSessionFile(projectDir) {
  let entries;
  try {
    entries = await readdir(projectDir);
  } catch {
    return null;
  }

  const jsonlFiles = entries.filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'));
  if (jsonlFiles.length === 0) return null;

  const withStats = await Promise.all(
    jsonlFiles.map(async (f) => {
      const fullPath = join(projectDir, f);
      try {
        const s = await stat(fullPath);
        return { path: fullPath, mtime: s.mtimeMs };
      } catch {
        return { path: fullPath, mtime: 0 };
      }
    })
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats[0]?.path ?? null;
}

// ── JSONL Parsing ────────────────────────────────────

/**
 * Read only the last entry type and file mtime from a JSONL file.
 * Reads only the last chunk (up to 4KB) — optimized for polling.
 */
async function readLastEntry(filePath) {
  try {
    const { size, mtimeMs } = await stat(filePath);
    if (size === 0) return null;

    const chunkSize = Math.min(size, 4096);
    const offset = Math.max(0, size - chunkSize);

    let content;
    if (offset === 0) {
      content = await readFile(filePath, 'utf-8');
    } else {
      const fh = await open(filePath, 'r');
      try {
        const buffer = Buffer.allocUnsafe(chunkSize);
        await fh.read(buffer, 0, chunkSize, offset);
        content = buffer.toString('utf-8');
      } finally {
        await fh.close();
      }
    }

    // Find the last valid JSON line
    const lines = content.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null) {
          return {
            lastType: parsed.type || 'unknown',
            modifiedAt: new Date(mtimeMs),
            data: parsed,
          };
        }
      } catch {
        // Skip malformed lines (may be truncated at chunk boundary)
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse the tail of a JSONL file (last 128KB) for summary + cost extraction.
 * Summaries and cost data are always near the end.
 */
async function parseJsonlTail(filePath, maxBytes = 131072) {
  let content;
  let offset;
  try {
    const { size } = await stat(filePath);
    offset = Math.max(0, size - maxBytes);
    if (offset === 0) {
      content = await readFile(filePath, 'utf-8');
    } else {
      const fh = await open(filePath, 'r');
      try {
        const length = size - offset;
        const buffer = Buffer.allocUnsafe(length);
        await fh.read(buffer, 0, length, offset);
        content = buffer.toString('utf-8');
      } finally {
        await fh.close();
      }
    }
  } catch {
    return [];
  }

  // Skip potentially truncated first line when reading mid-file
  const firstNewline = content.indexOf('\n');
  const safeContent = offset > 0 && firstNewline >= 0
    ? content.slice(firstNewline + 1)
    : content;

  const lines = [];
  for (const line of safeContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        lines.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return lines;
}

// ── Activity Detection ───────────────────────────────

const DEFAULT_READY_THRESHOLD_MS = 300000; // 5 minutes

/**
 * Get current activity state from Claude's JSONL session files.
 *
 * @param {string} workspacePath - The cwd used when spawning Claude
 * @param {number} [readyThresholdMs=300000] - ms before "ready" becomes "idle"
 * @returns {Promise<{state: string, timestamp: Date}|null>}
 *
 * States:
 *   starting       — Claude spawned but JSONL file not yet created
 *   active         — agent is processing (thinking, writing code, running tools)
 *   ready          — agent finished its turn, waiting for input
 *   idle           — agent has been inactive beyond threshold
 *   waiting_input  — agent is asking a permission question
 *   blocked        — agent hit an error
 */
async function getActivityState(workspacePath, readyThresholdMs) {
  const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;
  const projectDir = await getProjectDir(workspacePath);
  const sessionFile = await findLatestSessionFile(projectDir);

  // No JSONL file yet — Claude may still be starting up
  if (!sessionFile) return { state: 'starting', timestamp: new Date() };

  const entry = await readLastEntry(sessionFile);
  if (!entry) return null;

  const ageMs = Date.now() - entry.modifiedAt.getTime();
  const timestamp = entry.modifiedAt;

  switch (entry.lastType) {
    case 'user':
    case 'tool_use':
    case 'progress':
      return { state: ageMs > threshold ? 'idle' : 'active', timestamp };

    case 'assistant':
    case 'system':
    case 'summary':
    case 'result':
      return { state: ageMs > threshold ? 'idle' : 'ready', timestamp };

    case 'permission_request':
      return { state: 'waiting_input', timestamp };

    case 'error':
      return { state: 'blocked', timestamp };

    default:
      return { state: ageMs > threshold ? 'idle' : 'active', timestamp };
  }
}

// ── Session Info Extraction ──────────────────────────

/**
 * Extract summary, cost, and session ID from a Claude session.
 * Call after task completion for reporting.
 *
 * @param {string} workspacePath
 * @returns {Promise<{summary: string|null, cost: {inputTokens, outputTokens, estimatedCostUsd}|null, sessionId: string|null}>}
 */
async function getSessionInfo(workspacePath, { model } = {}) {
  const projectDir = await getProjectDir(workspacePath);
  const sessionFile = await findLatestSessionFile(projectDir);

  if (!sessionFile) return { summary: null, cost: null, sessionId: null };

  const lines = await parseJsonlTail(sessionFile);
  if (lines.length === 0) return { summary: null, cost: null, sessionId: null };

  const sessionId = basename(sessionFile, '.jsonl');

  // Extract summary — last "summary" type entry, or fallback to first user message
  let summary = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.type === 'summary' && lines[i].summary) {
      summary = lines[i].summary;
      break;
    }
  }
  if (!summary) {
    for (const line of lines) {
      if (line?.type === 'user' && line.message?.content && typeof line.message.content === 'string') {
        const msg = line.message.content.trim();
        if (msg.length > 0) {
          summary = msg.length > 120 ? msg.substring(0, 120) + '...' : msg;
          break;
        }
      }
    }
  }

  // Extract cost — aggregate from all entries
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;

  for (const line of lines) {
    if (typeof line.costUSD === 'number') {
      totalCost += line.costUSD;
    } else if (typeof line.estimatedCostUsd === 'number') {
      totalCost += line.estimatedCostUsd;
    }

    if (line.usage) {
      inputTokens += line.usage.input_tokens ?? 0;
      inputTokens += line.usage.cache_read_input_tokens ?? 0;
      inputTokens += line.usage.cache_creation_input_tokens ?? 0;
      outputTokens += line.usage.output_tokens ?? 0;
    } else {
      if (typeof line.inputTokens === 'number') inputTokens += line.inputTokens;
      if (typeof line.outputTokens === 'number') outputTokens += line.outputTokens;
    }
  }

  // Model-aware pricing (per 1M tokens)
  const PRICING = {
    'opus': { input: 15.0, output: 75.0 },
    'sonnet': { input: 3.0, output: 15.0 },
    'haiku': { input: 0.25, output: 1.25 },
  };
  if (totalCost === 0 && (inputTokens > 0 || outputTokens > 0)) {
    // Try to detect model from JSONL entries
    let detectedModel = model || null;
    if (!detectedModel) {
      for (const line of lines) {
        if (line.model) {
          const m = line.model.toLowerCase();
          if (m.includes('opus')) { detectedModel = 'opus'; break; }
          if (m.includes('haiku')) { detectedModel = 'haiku'; break; }
          if (m.includes('sonnet')) { detectedModel = 'sonnet'; break; }
        }
      }
    }
    const rates = PRICING[detectedModel] || PRICING.sonnet;
    totalCost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  }

  const cost = (inputTokens === 0 && outputTokens === 0 && totalCost === 0)
    ? null
    : { inputTokens, outputTokens, estimatedCostUsd: totalCost };

  return { summary, cost, sessionId };
}

// ── Exports ──────────────────────────────────────────

module.exports = {
  toClaudeProjectPath,
  getProjectDir,
  findLatestSessionFile,
  getActivityState,
  getSessionInfo,
  DEFAULT_READY_THRESHOLD_MS,
};
