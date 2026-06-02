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
import crypto from 'crypto';
import { parseJsonlFile, estimateFileTokens } from './transcript-parser.mjs';
import { extractStructured } from './extraction-prompt.mjs';
import { generateConceptNotes } from './obsidian-summarizer.mjs';
import { generateSessionNote } from './obsidian-session-notes.mjs';
import { generateDailyDigest } from './obsidian-digest.mjs';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { createTracer } = _require('./tracer');
const tracer = createTracer('pre-compression-flush');

// ── Feature Flag ────────────────────────────────────

/**
 * USE_LLM_EXTRACTION feature flag.
 * When true (default), uses LLM-driven structured extraction via extractStructured.
 * When false, falls back to regex-based extractFacts.
 */
export const USE_LLM_EXTRACTION = process.env.USE_LLM_EXTRACTION !== 'false';

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
const _shouldFlush = tracer.wrapAsync('shouldFlush', async function shouldFlush(jsonlPath, opts = {}) {
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
}, { tier: 3, category: 'io' });
export { _shouldFlush as shouldFlush };

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
 * Returns array of { fact, category, speaker } objects.
 */
const _extractFacts = tracer.wrap('extractFacts', function extractFacts(tailMessages) {
  const facts = [];
  const seen = new Set();

  const patterns = [
    // User corrections / preferences
    { re: /(?:don'?t|never|always|stop|prefer|please)\s+(.{10,80})/i, category: 'preference' },
    // Decisions
    { re: /(?:decided|let'?s go with|we'?ll use|switching to|going with)\s+(.{10,80})/i, category: 'decision' },
    // Environment / config
    { re: /(?:api|endpoint|url|port|config|database|db)\s+(?:is|at|on|in)\s+(.{5,80})/i, category: 'environment' },
    // File paths
    { re: /((?:\/[\w.-]+){3,})/g, category: 'reference' },
    // URLs
    { re: /(https?:\/\/\S{10,80})/g, category: 'reference' },
    // Agent actions / intents
    { re: /(?:I'll|I'm going to|I will|let me)\s+(.{10,80})/i, category: 'agent_action' },
    // Agent findings / observations
    { re: /(?:I found|I noticed|the issue is|the problem is|this is because)\s+(.{10,80})/i, category: 'finding' },
  ];

  for (const msg of tailMessages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const content = msg.content;

    for (const { re, category } of patterns) {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const matches = content.matchAll(new RegExp(re.source, flags.includes('i') ? flags : flags + 'i'));
      for (const match of matches) {
        const factText = truncateAtWord(match[0].trim(), 120);

        // Dedup within extraction
        const key = factText.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);

        facts.push({ fact: factText, category, speaker: msg.role });
      }
    }
  }

  return facts;
}, { tier: 3, category: 'compute' });
export { _extractFacts as extractFacts };

// ── Supersedes Helpers ────────────────────────────────────

/**
 * Strip `<!-- supersedes: ... -->` HTML comments from text.
 * Used before similarity comparison so the hash doesn't pollute bigram scores.
 */
export function stripSupersedes(text) {
  return text.replace(/\s*<!--\s*supersedes:\s*[a-f0-9]+\s*-->/g, '').trim();
}

/**
 * Strip `[user] ` or `[assistant] ` speaker prefix from text.
 * Used before similarity comparison so the tag doesn't pollute bigram scores.
 */
export function stripSpeaker(text) {
  return text.replace(/^\[(user|assistant)\]\s*/, '').trim();
}

/**
 * Truncate text at a word boundary instead of mid-word.
 * Falls back to hard slice if the last space is too early (< 70% of maxLen),
 * which avoids absurdly short results when a single word is very long.
 */
export function truncateAtWord(text, maxLen) {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.7 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Clean legacy `(updated: ...)` parenthetical chains from MEMORY.md content.
 * Keeps only the innermost (most recent) segment of each chain.
 * Called once at the top of mergeFacts to clean existing entries.
 */
export function cleanParentheticalChains(content) {
  const lines = content.split('\n');
  const cleaned = lines.map(line => {
    if (!line.startsWith('- ') && !line.startsWith('* ')) return line;
    const prefix = line.startsWith('- ') ? '- ' : '* ';
    let text = line.slice(prefix.length);
    // Repeatedly peel: replace "prefix (updated: inner)" with just "inner"
    let prev;
    do {
      prev = text;
      text = text.replace(/^.+ \(updated: (.+)\)$/, '$1');
    } while (text !== prev);
    return prefix + text.trim();
  });
  return cleaned.join('\n');
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
 * @param {Array} facts - Array of { fact, category, speaker }
 * @param {number} charBudget - Max character budget (default 2200)
 * @returns {{ content: string, added: number, merged: number, skipped: number }}
 */
export function mergeFacts(memoryContent, facts, charBudget = 2200) {
  // One-time cleanup of legacy parenthetical chains
  let content = cleanParentheticalChains(memoryContent);
  const entries = parseMemoryMd(content);
  let added = 0, merged = 0, skipped = 0;

  for (const { fact, category, speaker } of facts) {
    const speakerTag = speaker ? `[${speaker}] ` : '';
    // Check against existing entries (strip speaker tags + supersedes comments for clean comparison)
    let bestSim = 0;
    let bestEntry = null;

    for (const entry of entries) {
      const sim = bigramSimilarity(fact, stripSpeaker(stripSupersedes(entry.text)));
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
      // Merge: replace with the NEW fact verbatim + invisible supersedes comment
      const oldHash = crypto.createHash('sha256').update(stripSpeaker(stripSupersedes(bestEntry.text))).digest('hex').slice(0, 8);
      const replacement = `${speakerTag}${fact} <!-- supersedes: ${oldHash} -->`;
      content = content.replace(bestEntry.raw, `- ${replacement}`);
      // Update the entry in the working list so subsequent merges see the new text
      bestEntry.text = replacement;
      bestEntry.raw = `- ${replacement}`;
      merged++;
      continue;
    }

    // Budget check before appending
    if (content.length + fact.length + speakerTag.length + 10 > charBudget) {
      break; // respect character budget
    }

    // Append under "## Recent" section (create if missing)
    if (!content.includes('## Recent')) {
      content = content.trimEnd() + '\n\n## Recent\n';
    }
    content = content.trimEnd() + `\n- ${speakerTag}${fact}`;
    added++;
    entries.push({ section: 'Recent', text: fact, raw: `- ${fact}` });
  }

  return { content: content.trimEnd() + '\n', added, merged, skipped };
}

// ── Main Flush Pipeline ────────────────────────────────────

/**
 * Run the pre-compression flush pipeline.
 *
 * When USE_LLM_EXTRACTION is true and an llmClient + extractionStore are provided,
 * uses LLM-driven structured extraction → SQLite storage → MEMORY.md generation.
 * Otherwise falls back to the regex-based extractFacts → mergeFacts path.
 *
 * @param {string} jsonlPath - Path to current session JSONL
 * @param {string} memoryMdPath - Path to MEMORY.md
 * @param {Object} opts
 * @param {number} opts.tailCount - Number of tail messages to scan (default 40)
 * @param {number} opts.charBudget - MEMORY.md character budget (default 2200)
 * @param {string} opts.format - Transcript format (auto-detected if omitted)
 * @param {object} opts.llmClient - LLM client from createLlmClient() (optional)
 * @param {object} opts.extractionStore - Extraction store from createExtractionStore() (optional)
 * @param {string} opts.sessionId - Session identifier for extraction store (optional)
 * @returns {Promise<{ flushed: boolean, facts: number, added: number, merged: number, skipped: number, mode: string }>}
 */
// R4 fix (repair 1.4): per-session record of the last successfully-extracted
// tail. Every flush boundary (interval, idle, session-end, NATS) used to
// re-extract identical content — duplicate mention rows + minutes of
// redundant LLM work per re-run.
const hashTail = (tailMessages) => crypto.createHash('sha256')
  .update(JSON.stringify(tailMessages.map((m) => [m.role, m.content])))
  .digest('hex');

function lastExtractionHash(db, sessionId) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS extraction_state (
      session_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      message_count INTEGER,
      extracted_at TEXT NOT NULL
    )
  `);
  return db.prepare(`SELECT content_hash FROM extraction_state WHERE session_id = ?`)
    .get(sessionId)?.content_hash;
}

function recordExtractionHash(db, sessionId, contentHash, messageCount) {
  db.prepare(`
    INSERT INTO extraction_state (session_id, content_hash, message_count, extracted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      content_hash = excluded.content_hash,
      message_count = excluded.message_count,
      extracted_at = excluded.extracted_at
  `).run(sessionId, contentHash, messageCount, new Date().toISOString());
}

const _runFlush = tracer.wrapAsync('runFlush', async function runFlush(jsonlPath, memoryMdPath, opts = {}) {
  const { tailCount = 40, charBudget = 2200, format } = opts;

  if (!fs.existsSync(jsonlPath)) {
    return { flushed: false, facts: 0, added: 0, merged: 0, skipped: 0, mode: 'none' };
  }

  // 1. Get tail messages (format-agnostic via transcript-parser)
  const { tailMessages, messageCount } = await estimateSessionTokens(jsonlPath, tailCount, { format });

  if (tailMessages.length === 0) {
    return { flushed: false, facts: 0, added: 0, merged: 0, skipped: 0, mode: 'none' };
  }

  // 2. Choose extraction path
  const useLlm = USE_LLM_EXTRACTION && opts.llmClient && opts.extractionStore;

  if (useLlm) {
    const sessionId = opts.sessionId || path.basename(jsonlPath, '.jsonl');
    const contentHash = hashTail(tailMessages);
    if (lastExtractionHash(opts.extractionStore.db, sessionId) === contentHash) {
      return {
        flushed: false, facts: 0, added: 0, merged: 0, skipped: 1, mode: 'llm-dedup',
        extraction: {
          session_id: sessionId,
          entities_count: 0, themes_count: 0, mentions_count: 0, decisions_count: 0,
          duration_ms: 0,
        },
      };
    }

    // LLM extraction path
    try {
      const extractStart = Date.now();
      const result = await extractStructured(opts.llmClient, tailMessages);
      const duration_ms = Date.now() - extractStart;

      // Store in SQLite (stamp mentions with last-turn-of-tail)
      opts.extractionStore.storeExtractionResult(sessionId, result, undefined, { turnIndex: messageCount });
      recordExtractionHash(opts.extractionStore.db, sessionId, contentHash, messageCount);

      // Generate structured MEMORY.md from the entity/theme/decision tables
      const synthStart = Date.now();
      const content = opts.extractionStore.generateMemoryContent(charBudget);
      fs.writeFileSync(memoryMdPath, content);

      // Generate Obsidian concept notes (4.2)
      const artifacts = [memoryMdPath];
      try {
        const conceptResult = await generateConceptNotes({
          db: opts.extractionStore.db,
          client: opts.llmClient,
          respectPrivacy: false,
          maxConcepts: 10,
        });
        for (const note of conceptResult.notes) {
          artifacts.push(path.join(conceptResult.vaultPath, 'concepts', note));
        }
      } catch (conceptErr) {
        if (typeof process !== 'undefined' && process.stderr) {
          process.stderr.write(`[pre-compression-flush] concept notes failed: ${conceptErr.message}\n`);
        }
      }

      // Generate Obsidian session note (4.3)
      try {
        const sessionResult = await generateSessionNote({
          db: opts.extractionStore.db,
          sessionId,
        });
        if (sessionResult.generated && sessionResult.filePath) {
          artifacts.push(sessionResult.filePath);
        }
      } catch (sessionErr) {
        if (typeof process !== 'undefined' && process.stderr) {
          process.stderr.write(`[pre-compression-flush] session note failed: ${sessionErr.message}\n`);
        }
      }

      // Generate daily digest from vault notes (4.8)
      try {
        const digestResult = await generateDailyDigest();
        if (digestResult.generated && digestResult.filePath) {
          artifacts.push(digestResult.filePath);
        }
      } catch (digestErr) {
        if (typeof process !== 'undefined' && process.stderr) {
          process.stderr.write(`[pre-compression-flush] daily digest failed: ${digestErr.message}\n`);
        }
      }

      const synthesis_ms = Date.now() - synthStart;

      // Count extracted items for stats
      const factCount = result.entities.length + result.decisions.length +
        result.themes.length + result.friction_signals.length;

      return {
        flushed: true,
        facts: factCount,
        added: factCount,
        merged: 0,
        skipped: 0,
        mode: 'llm',
        extraction: {
          session_id: sessionId,
          entities_count: result.entities.length,
          themes_count: result.themes.length,
          mentions_count: result.entities.length,
          decisions_count: result.decisions.length,
          // Capped sample of WHAT was extracted (the actual content, not just counts).
          entity_names: result.entities.slice(0, 20).map((e) => e.name),
          theme_labels: result.themes.slice(0, 12).map((t) => t.label),
          decision_texts: result.decisions.slice(0, 10).map((d) => d.decision),
          duration_ms,
        },
        synthesis: {
          session_id: sessionId,
          artifacts_written: artifacts,
          duration_ms: synthesis_ms,
        },
      };
    } catch (err) {
      // LLM extraction failed — fall back to regex path
      // Log but don't throw — graceful degradation
      const logMsg = `LLM extraction failed (falling back to regex): ${err.message}`;
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[pre-compression-flush] ${logMsg}\n`);
      }
    }
  }

  // Regex extraction path (fallback or when USE_LLM_EXTRACTION=false)
  const facts = _extractFacts(tailMessages);

  if (facts.length === 0) {
    return { flushed: true, facts: 0, added: 0, merged: 0, skipped: 0, mode: 'regex' };
  }

  // 3. Read and merge into MEMORY.md
  let memoryContent = '';
  if (fs.existsSync(memoryMdPath)) {
    memoryContent = fs.readFileSync(memoryMdPath, 'utf-8');
  }

  const mergeResult = mergeFacts(memoryContent, facts, charBudget);

  // 4. Write back
  fs.writeFileSync(memoryMdPath, mergeResult.content);

  return {
    flushed: true,
    facts: facts.length,
    added: mergeResult.added,
    merged: mergeResult.merged,
    skipped: mergeResult.skipped,
    mode: 'regex',
  };
}, { tier: 3, category: 'io' });
export { _runFlush as runFlush };
