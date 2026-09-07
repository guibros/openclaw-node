/**
 * memory-formatter.mjs — Format budgeted memory into the [memory: ...] injection block.
 *
 * Consumes the output of `createMemoryInjector().retrieve()` from Step 7.2
 * and produces the text block per Block 7 frozen decisions (REFERENCE_PLAN §7.3).
 *
 * Does NOT parse @memory directives (Step 7.4).
 *
 * @module lib/memory-formatter
 */

import { formatDegradedWarning } from './memory-injector.mjs';

// ─── Field sanitisation (review H-2 / P5-6) ──────────────────────────────────
//
// The [memory: …] frame is parsed by position: a stored field containing a
// newline plus "[end memory]" closed the frame early and put attacker text in
// instruction position of the system message (the peer-memory path already
// escaped; this local path did not). Every field goes through sanitizeField:
// one line, frame tokens defanged, length capped.

export const FIELD_CAPS = Object.freeze({
  name: 120,
  type: 40,
  decision: 300,
  date: 10,
  sessionId: 80,
  snippet: 120,
});

export function sanitizeField(value, cap = 300) {
  const text = String(value ?? '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\[\s*end\s+memory\s*\]/gi, '[end memory (escaped)]')
    .replace(/\[\s*memory\s*:/gi, '[memory (escaped):')
    .trim();
  return text.length > cap ? text.slice(0, cap - 1) + '…' : text;
}

// ─── Sub-formatters ──────────────────────────────────────────────────────────

/**
 * Format a list of concepts as comma-separated "Name (type)" entries.
 *
 * @param {Array<{name: string, type: string}>} concepts
 * @returns {string} e.g. "NATS (tool), Mesh Coordination (concept)"
 */
export function formatConceptList(concepts) {
  if (!concepts || !concepts.length) return '';
  return concepts.map(c => `${sanitizeField(c.name, FIELD_CAPS.name)} (${sanitizeField(c.type, FIELD_CAPS.type)})`).join(', ');
}

/**
 * Format decisions as a bullet list with date and confidence.
 *
 * @param {Array<{decision: string, confidence: number, date: string}>} decisions
 * @returns {string} e.g. "- 2026-02-15: Decided to use NATS (0.95)"
 */
export function formatDecisionList(decisions) {
  if (!decisions || !decisions.length) return '';
  return decisions
    .map(d => {
      const dateStr = d.date ? sanitizeField(String(d.date).slice(0, FIELD_CAPS.date), FIELD_CAPS.date) : 'unknown';
      const conf = typeof d.confidence === 'number' ? d.confidence : sanitizeField(d.confidence, 8);
      return `- ${dateStr}: ${sanitizeField(d.decision, FIELD_CAPS.decision)} (${conf})`;
    })
    .join('\n');
}

/**
 * Format snippets as brief related session references.
 *
 * @param {Array<{sessionId: string, snippet: string}>} snippets
 * @returns {string}
 */
export function formatSnippetSummaries(snippets) {
  if (!snippets || !snippets.length) return '';
  // Deduplicate by sessionId, take first snippet per session
  const seen = new Set();
  const unique = [];
  for (const s of snippets) {
    const key = s.sessionId || 'unknown';
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }
  return unique.map(s => {
    const id = sanitizeField(s.sessionId || 'unknown', FIELD_CAPS.sessionId);
    const text = s.snippet ? sanitizeField(s.snippet, FIELD_CAPS.snippet) : '';
    return text ? `[${id}]: ${text}` : `[${id}]`;
  }).join('\n');
}

// ─── Main Formatter ──────────────────────────────────────────────────────────

/**
 * Compose the full [memory: ...] block from budgeted retrieval output.
 * Returns empty string if all arrays are empty (no memory to inject).
 *
 * @param {{ concepts?: Array, decisions?: Array, snippets?: Array }} data
 * @returns {string}
 */
export function formatMemoryBlock(data = {}) {
  const { concepts = [], decisions = [], snippets = [], analysis } = data;

  // F-M10 fix: delegate to the single source of truth in memory-injector.
  // Previously this function inlined a duplicate of formatDegradedWarning
  // (with the comment "kept here to avoid cross-file dep") and the two
  // copies had already drifted (this one merged analysis-wait-timeout +
  // analysis-call-timeout into one label; the injector treated them
  // separately). Now we just call the canonical formatter.
  const degradedWarning = formatDegradedWarning(analysis);

  // If nothing to inject AND no warning to surface, return empty
  if (!concepts.length && !decisions.length && !snippets.length && !degradedWarning) {
    return '';
  }

  const headerLabel = degradedWarning
    ? '[memory: ⚠ degraded mode]'
    : '[memory: recent relevant context]';
  const lines = [headerLabel];

  if (degradedWarning) {
    lines.push(degradedWarning);
  }

  if (concepts.length) {
    const conceptStr = formatConceptList(concepts);
    lines.push(`Active concepts in this conversation: ${conceptStr}`);
  }

  if (decisions.length) {
    lines.push('Recent decisions:');
    lines.push(formatDecisionList(decisions));
  }

  if (snippets.length) {
    lines.push('Related sessions:');
    lines.push(formatSnippetSummaries(snippets));
  }

  lines.push('[end memory]');
  return lines.join('\n');
}

// ─── System Message Injection ────────────────────────────────────────────────

/**
 * Prepend a memory block to existing system message content.
 * If systemContent is empty/null, the memory block becomes the system content.
 *
 * @param {string|null} systemContent — existing system message text
 * @param {string} memoryBlock — formatted [memory: ...] block
 * @returns {string}
 */
export function injectIntoSystemMessage(systemContent, memoryBlock) {
  if (!memoryBlock) return systemContent || '';
  if (!systemContent) return memoryBlock;
  return `${memoryBlock}\n\n${systemContent}`;
}

/**
 * Extract the last user message text from an OpenAI-compatible messages array.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
export function extractLastUserPrompt(messages) {
  if (!messages || !messages.length) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      return messages[i].content;
    }
  }
  return '';
}

/**
 * Inject a memory block into an OpenAI-compatible messages array.
 * Prepends to existing system message or inserts a new system message at position 0.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} memoryBlock
 * @returns {Array<{role: string, content: string}>}
 */
export function injectIntoMessages(messages, memoryBlock) {
  if (!memoryBlock || !messages || !messages.length) return messages || [];

  const result = [...messages];
  if (result[0] && result[0].role === 'system') {
    result[0] = {
      ...result[0],
      content: injectIntoSystemMessage(result[0].content, memoryBlock),
    };
  } else {
    result.unshift({ role: 'system', content: memoryBlock });
  }
  return result;
}
