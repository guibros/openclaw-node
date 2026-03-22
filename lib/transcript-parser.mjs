/**
 * transcript-parser.mjs — Format-agnostic JSONL transcript parser
 *
 * Abstracts away the differences between JSONL formats produced by
 * different OpenClaw frontends:
 *
 *   - claude-code:       {type: "user"|"assistant", message: {role, content}, timestamp, usage}
 *   - openclaw-gateway:  {type: "message", message: {role, content}, timestamp}
 *                        (plus metadata types: session, model_change, etc.)
 *   - mesh-agent:        Raw text stdout/stderr (non-JSONL, handled separately)
 *
 * Provides a unified stream of { role, content, timestamp } messages
 * regardless of source format.
 *
 * Usage:
 *   import { parseJsonl, parseJsonlFile, detectFormat } from './transcript-parser.mjs';
 *
 *   // Parse a JSONL file with auto-detected format
 *   const messages = await parseJsonlFile('/path/to/session.jsonl');
 *
 *   // Parse with explicit format
 *   const messages = await parseJsonlFile(path, { format: 'openclaw-gateway' });
 *
 *   // Parse a single JSONL line
 *   const msg = parseLine(jsonString, { format: 'claude-code' });
 */

import fs from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// ── Format Registry ────────────────────────────────────

/**
 * Adapters indexed by format name.
 * Each adapter has:
 *   - isMessage(entry): boolean — does this JSONL entry represent a conversation message?
 *   - extractMessage(entry): { role, content, timestamp, metadata? } | null
 */
const ADAPTERS = {};

/**
 * Register a new format adapter.
 * @param {string} name - Format identifier (e.g. 'claude-code', 'openclaw-gateway')
 * @param {Object} adapter - { isMessage(entry), extractMessage(entry) }
 */
export function registerFormat(name, adapter) {
  ADAPTERS[name] = adapter;
}

// ── Built-in Adapters ────────────────────────────────────

// Claude Code format: {type: "user"|"assistant", message: {role, content}, timestamp}
registerFormat('claude-code', {
  isMessage(entry) {
    return (entry.type === 'user' || entry.type === 'assistant') && entry.message;
  },

  extractMessage(entry) {
    const content = extractContent(entry.message);
    if (!content) return null;

    return {
      role: entry.type, // 'user' or 'assistant'
      content,
      timestamp: entry.timestamp || null,
      metadata: {
        usage: entry.usage || null,
        model: entry.model || null,
        costUSD: entry.costUSD || null,
      },
    };
  },
});

// OpenClaw Gateway format: {type: "message", message: {role, content}, timestamp}
// Metadata types to skip: session, model_change, thinking_level_change, queue-operation, tool_result, custom
const GATEWAY_SKIP_TYPES = new Set([
  'session', 'model_change', 'thinking_level_change',
  'custom', 'queue-operation', 'tool_result',
]);

registerFormat('openclaw-gateway', {
  isMessage(entry) {
    if (GATEWAY_SKIP_TYPES.has(entry.type)) return false;
    return entry.type === 'message' && entry.message && entry.message.role;
  },

  extractMessage(entry) {
    let content = extractContent(entry.message);
    if (!content) return null;

    // Strip gateway header noise: "[Mon 2026-03-22 14:30 GMT-5] actual message"
    content = content.replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*/i, '');

    // Strip metadata noise: "Conversation info (untrusted metadata): ```json {...} ```"
    content = content.replace(/^Conversation info \(untrusted metadata\):[\s\S]*?```\s*/i, '');
    content = content.trim();

    if (!content) return null;

    return {
      role: entry.message.role, // 'user' or 'assistant'
      content,
      timestamp: entry.timestamp || null,
      metadata: {},
    };
  },
});

// Generic fallback: tries both formats
registerFormat('auto', {
  isMessage(entry) {
    // Role-as-type format (type='user'|'assistant')
    if ((entry.type === 'user' || entry.type === 'assistant') && entry.message) return true;
    // Unified-message format (type='message' with role field)
    if (entry.type === 'message' && entry.message && entry.message.role) return true;
    return false;
  },

  extractMessage(entry) {
    // Try role-as-type format first
    if ((entry.type === 'user' || entry.type === 'assistant') && entry.message) {
      return ADAPTERS['claude-code'].extractMessage(entry);
    }
    // Try unified-message format
    if (entry.type === 'message' && entry.message && entry.message.role) {
      return ADAPTERS['openclaw-gateway'].extractMessage(entry);
    }
    return null;
  },
});

// ── Content Extraction ────────────────────────────────────

/**
 * Extract text content from a message object.
 * Handles both string content and array-of-blocks content.
 *
 * @param {Object} message - { content: string | Array<{type, text}> }
 * @returns {string}
 */
export function extractContent(message) {
  if (!message) return '';

  const { content } = message;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('\n');
  }

  return '';
}

// ── Format Detection ────────────────────────────────────

/**
 * Auto-detect JSONL format by sampling the first few entries.
 *
 * @param {string} jsonlPath - Path to the JSONL file
 * @param {number} sampleLines - Number of lines to sample (default: 10)
 * @returns {Promise<string>} Format name: 'claude-code' | 'openclaw-gateway' | 'auto'
 */
export async function detectFormat(jsonlPath, sampleLines = 10) {
  if (!fs.existsSync(jsonlPath)) return 'auto';

  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });
  let roleTypeHits = 0;   // role-as-type format (type='user'|'assistant')
  let unifiedMsgHits = 0; // unified-message format (type='message' + role field)
  let lineCount = 0;

  for await (const line of rl) {
    if (lineCount >= sampleLines) break;
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      if (entry.type === 'user' || entry.type === 'assistant') roleTypeHits++;
      if (entry.type === 'message' && entry.message?.role) unifiedMsgHits++;
      if (GATEWAY_SKIP_TYPES.has(entry.type)) unifiedMsgHits++; // metadata entries = gateway signal
      if (entry.usage || entry.costUSD) roleTypeHits++; // token tracking = role-type format signal
    } catch { /* skip */ }

    lineCount++;
  }

  if (roleTypeHits > unifiedMsgHits) return 'claude-code';
  if (unifiedMsgHits > roleTypeHits) return 'openclaw-gateway';
  return 'auto';
}

// ── Parsing ────────────────────────────────────

/**
 * Parse a single JSONL line into a message.
 *
 * @param {string} line - Raw JSONL string
 * @param {Object} opts
 * @param {string} opts.format - Format name (default: 'auto')
 * @returns {{ role: string, content: string, timestamp: string|null, metadata?: object } | null}
 */
export function parseLine(line, opts = {}) {
  const { format = 'auto' } = opts;
  const adapter = ADAPTERS[format] || ADAPTERS['auto'];

  try {
    const entry = JSON.parse(line);
    if (!adapter.isMessage(entry)) return null;
    return adapter.extractMessage(entry);
  } catch {
    return null;
  }
}

/**
 * Parse an entire JSONL file into an array of messages.
 * Optionally returns only the tail (last N messages).
 *
 * @param {string} jsonlPath - Path to the JSONL file
 * @param {Object} opts
 * @param {string} opts.format - Format name (default: auto-detected)
 * @param {number} opts.tail - If set, return only the last N messages
 * @returns {Promise<Array<{ role, content, timestamp, metadata? }>>}
 */
export async function parseJsonlFile(jsonlPath, opts = {}) {
  let { format, tail } = opts;

  if (!fs.existsSync(jsonlPath)) return [];

  // Auto-detect format if not specified
  if (!format) {
    format = await detectFormat(jsonlPath);
  }

  const adapter = ADAPTERS[format] || ADAPTERS['auto'];
  const messages = [];

  const rl = createInterface({ input: createReadStream(jsonlPath), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!adapter.isMessage(entry)) continue;
      const msg = adapter.extractMessage(entry);
      if (msg) messages.push(msg);
    } catch { /* skip malformed */ }
  }

  if (tail && tail > 0) {
    return messages.slice(-tail);
  }

  return messages;
}

/**
 * Count messages and estimate tokens from a JSONL file.
 *
 * @param {string} jsonlPath
 * @param {Object} opts
 * @param {string} opts.format - Format name (default: auto-detected)
 * @param {number} opts.charsPerToken - Chars per token estimate (default: 4)
 * @returns {Promise<{ messageCount, totalChars, estimatedTokens }>}
 */
export async function estimateFileTokens(jsonlPath, opts = {}) {
  const { charsPerToken = 4 } = opts;
  const messages = await parseJsonlFile(jsonlPath, opts);

  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content.length;
  }

  return {
    messageCount: messages.length,
    totalChars,
    estimatedTokens: Math.ceil(totalChars / charsPerToken),
  };
}

/**
 * Get list of registered format names.
 */
export function listFormats() {
  return Object.keys(ADAPTERS);
}
