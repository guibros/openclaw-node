/**
 * pre-compression-flush.mjs — Pre-compression memory extraction
 *
 * Detects when a session is approaching context compression
 * (by JSONL size / estimated token count) and extracts durable facts from
 * the conversation tail before they're lost.
 *
 * LLM-agnostic: uses transcript-parser.mjs to handle any JSONL format
 * (Claude Code, OpenClaw Gateway, or future backends).
 *
 * Zero token cost — pure JSONL parsing + heuristic extraction.
 * Writes to MEMORY.md with bigram-similarity dedup to prevent bloat.
 *
 * Adapted from Hermes's pre-compression flush pattern, fitted to
 * OpenClaw's daemon architecture.
 */

import fs from 'fs';
import path from 'path';
import { parseJsonlFile, estimateFileTokens } from './transcript-parser.mjs';

// ── Token Estimation ────────────────────────────────────

const CHARS_PER_TOKEN = 4; // rough approximation across common LLM tokenizers

/**
 * Estimate token count from character length.
 * Good enough for flush threshold — no tokenizer dependency needed.
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate total conversation tokens from a JSONL session file.
 * Format-agnostic — delegates to transcript-parser.
 * Returns { totalTokens, messageCount, tailMessages }.
 *
 * @param {string} jsonlPath
 * @param {number} tailCount
 * @param {Object} opts
 * @param {string} opts.format - Transcript format (auto-detected if omitted)
 */
export async function estimateSessionTokens(jsonlPath, tailCount = 40, opts = {}) {
  if (!fs.existsSync(jsonlPath)) return { totalTokens: 0, messageCount: 0, tailMessages: [] };

  const messages = await parseJsonlFile(jsonlPath, { format: opts.format });
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content.length;
  }

  const tailMessages = messages.slice(-tailCount);

  return {
    totalTokens: Math.ceil(totalChars / CHARS_PER_TOKEN),
    messageCount: messages.length,
    tailMessages,
  };
}

// ── Flush Threshold ────────────────────────────────────

/**
 * Check if a session should trigger a pre-compression flush.
 *
 * @param {string} jsonlPath - Path to the session's JSONL file
 * @param {Object} opts
 * @param {number} opts.contextWindowTokens - Model's context window size in tokens (default: 200000)
 * @param {number} opts.flushPct - Flush at this % of context window (default: 0.75)
 * @returns {{ shouldFlush: boolean, estimatedTokens: number, pctUsed: number, threshold: number }}
 */
export async function shouldFlush(jsonlPath, opts = {}) {
  const { contextWindowTokens = 200000, flushPct = 0.75 } = opts;
  const threshold = Math.floor(contextWindowTokens * flushPct);

  if (!fs.existsSync(jsonlPath)) return { shouldFlush: false, estimatedTokens: 0, pctUsed: 0, threshold };

  const stat = fs.statSync(jsonlPath);
  // Quick estimate from file size — ~4 chars/token, but JSONL has overhead (~2x)
  const quickEstimate = Math.ceil(stat.size / (CHARS_PER_TOKEN * 2));

  return {
    shouldFlush: quickEstimate >= threshold,
    estimatedTokens: quickEstimate,
    pctUsed: Math.round((quickEstimate / contextWindowTokens) * 100),
    threshold,
  };
}

// ── Bigram Similarity ────────────────────────────────────

/**
 * Compute bigram similarity between two strings (0.0 - 1.0).
 * Used for dedup when merging new facts into MEMORY.md.
 */
export function bigramSimilarity(a, b) {
  if (!a || !b) return 0;

  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const bigrams = s => {
    const tokens = norm(s).split(/\s+/);
    const bg = new Set();
    for (let i = 0; i < tokens.length - 1; i++) {
      bg.add(`${tokens[i]} ${tokens[i + 1]}`);
    }
    // Also add unigrams for short strings
    for (const t of tokens) bg.add(t);
    return bg;
  };

  const setA = bigrams(a);
  const setB = bigrams(b);

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Fact Extraction ────────────────────────────────────

/**
 * Extract durable facts from conversation tail messages.
 * Heuristic approach — looks for:
 *   - User corrections / preferences ("don't...", "always...", "I prefer...")
 *   - Decisions ("we decided...", "let's go with...")
 *   - Environment discoveries ("the API is at...", "config is in...")
 *   - Named entities + context (URLs, file paths, project names)
 *
 * Returns array of { fact, category, confidence } objects.
 */
export function extractFacts(tailMessages) {
  const facts = [];
  const seen = new Set();

  const patterns = [
    // User corrections / preferences
    { re: /(?:don'?t|never|always|stop|prefer|please)\s+(.{10,80})/i, category: 'preference', confidence: 85 },
    // Decisions
    { re: /(?:decided|let'?s go with|we'?ll use|switching to|going with)\s+(.{10,80})/i, category: 'decision', confidence: 80 },
    // Environment / config
    { re: /(?:api|endpoint|url|port|config|database|db)\s+(?:is|at|on|in)\s+(.{5,80})/i, category: 'environment', confidence: 75 },
    // File paths
    { re: /((?:\/[\w.-]+){3,})/g, category: 'reference', confidence: 60 },
    // URLs
    { re: /(https?:\/\/\S{10,80})/g, category: 'reference', confidence: 65 },
  ];

  for (const msg of tailMessages) {
    if (msg.role !== 'user') continue; // focus on user statements
    const content = msg.content;

    for (const { re, category, confidence } of patterns) {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const matches = content.matchAll(new RegExp(re.source, flags.includes('i') ? flags : flags + 'i'));
      for (const match of matches) {
        const factText = match[0].trim().slice(0, 120);

        // Dedup within extraction
        const key = factText.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);

        facts.push({ fact: factText, category, confidence });
      }
    }
  }

  return facts;
}

// ── MEMORY.md Merge ────────────────────────────────────

/**
 * Parse MEMORY.md into structured entries.
 * Each entry is a markdown line (typically a "- " bullet under a section).
 */
export function parseMemoryMd(content) {
  const lines = content.split('\n');
  const entries = [];
  let currentSection = '';

  for (const line of lines) {
    if (line.startsWith('##')) {
      currentSection = line.replace(/^#+\s*/, '').trim();
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      entries.push({
        section: currentSection,
        text: line.replace(/^[-*]\s*/, '').trim(),
        raw: line,
      });
    }
  }

  return entries;
}

/**
 * Merge new facts into MEMORY.md content with dedup.
 *
 * Strategy:
 *   - >90% similarity to existing entry → skip (already known)
 *   - >70% similarity → merge (append new info to existing entry)
 *   - <70% similarity → append as new entry under appropriate section
 *
 * @param {string} memoryContent - Current MEMORY.md content
 * @param {Array} facts - Array of { fact, category, confidence }
 * @param {number} charBudget - Max character budget (default 2200)
 * @returns {{ content: string, added: number, merged: number, skipped: number }}
 */
export function mergeFacts(memoryContent, facts, charBudget = 2200) {
  const entries = parseMemoryMd(memoryContent);
  let content = memoryContent;
  let added = 0, merged = 0, skipped = 0;

  for (const { fact, category } of facts) {
    // Check against existing entries
    let bestSim = 0;
    let bestEntry = null;

    for (const entry of entries) {
      const sim = bigramSimilarity(fact, entry.text);
      if (sim > bestSim) {
        bestSim = sim;
        bestEntry = entry;
      }
    }

    if (bestSim > 0.9) {
      skipped++;
      continue;
    }

    if (bestSim > 0.7 && bestEntry) {
      // Merge: replace the existing line with a combined version
      const combined = `${bestEntry.text} (updated: ${fact.slice(0, 60)})`;
      content = content.replace(bestEntry.raw, `- ${combined}`);
      merged++;
      continue;
    }

    // Budget check before appending
    if (content.length + fact.length + 10 > charBudget) {
      break; // respect character budget
    }

    // Append under "## Recent" section (create if missing)
    if (!content.includes('## Recent')) {
      content = content.trimEnd() + '\n\n## Recent\n';
    }
    content = content.trimEnd() + `\n- ${fact}`;
    added++;
    entries.push({ section: 'Recent', text: fact, raw: `- ${fact}` });
  }

  return { content: content.trimEnd() + '\n', added, merged, skipped };
}

// ── Main Flush Pipeline ────────────────────────────────────

/**
 * Run the pre-compression flush pipeline.
 *
 * 1. Read tail of JSONL conversation
 * 2. Extract durable facts
 * 3. Merge into MEMORY.md with dedup
 * 4. Return stats
 *
 * @param {string} jsonlPath - Path to current session JSONL
 * @param {string} memoryMdPath - Path to MEMORY.md
 * @param {Object} opts
 * @param {number} opts.tailCount - Number of tail messages to scan (default 40)
 * @param {number} opts.charBudget - MEMORY.md character budget (default 2200)
 * @param {string} opts.format - Transcript format (auto-detected if omitted)
 * @returns {Promise<{ flushed: boolean, facts: number, added: number, merged: number, skipped: number }>}
 */
export async function runFlush(jsonlPath, memoryMdPath, opts = {}) {
  const { tailCount = 40, charBudget = 2200, format } = opts;

  if (!fs.existsSync(jsonlPath)) {
    return { flushed: false, facts: 0, added: 0, merged: 0, skipped: 0 };
  }

  // 1. Get tail messages (format-agnostic via transcript-parser)
  const { tailMessages } = await estimateSessionTokens(jsonlPath, tailCount, { format });

  if (tailMessages.length === 0) {
    return { flushed: false, facts: 0, added: 0, merged: 0, skipped: 0 };
  }

  // 2. Extract facts
  const facts = extractFacts(tailMessages);

  if (facts.length === 0) {
    return { flushed: true, facts: 0, added: 0, merged: 0, skipped: 0 };
  }

  // 3. Read and merge into MEMORY.md
  let memoryContent = '';
  if (fs.existsSync(memoryMdPath)) {
    memoryContent = fs.readFileSync(memoryMdPath, 'utf-8');
  }

  const result = mergeFacts(memoryContent, facts, charBudget);

  // 4. Write back
  fs.writeFileSync(memoryMdPath, result.content);

  return {
    flushed: true,
    facts: facts.length,
    added: result.added,
    merged: result.merged,
    skipped: result.skipped,
  };
}
