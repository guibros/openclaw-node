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

// ─── Sub-formatters ──────────────────────────────────────────────────────────

/**
 * Format a list of concepts as comma-separated "Name (type)" entries.
 *
 * @param {Array<{name: string, type: string}>} concepts
 * @returns {string} e.g. "NATS (tool), Mesh Coordination (concept)"
 */
export function formatConceptList(concepts) {
  if (!concepts || !concepts.length) return '';
  return concepts.map(c => `${c.name} (${c.type})`).join(', ');
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
      const dateStr = d.date ? d.date.slice(0, 10) : 'unknown';
      return `- ${dateStr}: ${d.decision} (${d.confidence})`;
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
    const id = s.sessionId || 'unknown';
    const text = s.snippet ? s.snippet.slice(0, 120).trim() : '';
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
  const { concepts = [], decisions = [], snippets = [] } = data;

  // If nothing to inject, return empty — callers skip injection
  if (!concepts.length && !decisions.length && !snippets.length) {
    return '';
  }

  const lines = ['[memory: recent relevant context]'];

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
