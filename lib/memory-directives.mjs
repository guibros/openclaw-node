/**
 * memory-directives.mjs — Parse @memory runtime control directives from user prompts.
 *
 * Directives per Block 7 frozen decisions:
 *   @memory off    — disable injection for current turn only
 *   @memory deep   — increase injection budget to 2x for current turn
 *   @memory none   — hard disable for entire session (until restart)
 *   @memory only:<theme> — constrain injection to a specific theme/entity
 *
 * Directives are parsed by pure regex (no LLM call). Matched directives are
 * stripped from the prompt text before passing to the LLM.
 *
 * @module lib/memory-directives
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Regex matching @memory directives. Case-insensitive, captures the directive type.
 * `only:` captures the colon and theme name as one token (e.g. "only:nats").
 */
export const DIRECTIVE_REGEX = /@memory\s+(off|deep|none|only:\S+)/i;

/** Set of recognized directive type strings (without param). */
export const DIRECTIVE_TYPES = new Set(['off', 'deep', 'none', 'only']);

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a @memory directive from text.
 *
 * Returns an object with:
 *   - type: 'off' | 'deep' | 'none' | 'only' | null (null = no directive found)
 *   - param: string | null (non-null only for 'only' type, contains the theme name)
 *   - cleanedText: text with the directive stripped out
 *
 * First match wins if multiple directives are present.
 *
 * @param {string} text — user prompt text
 * @returns {{ type: string|null, param: string|null, cleanedText: string }}
 */
export function parseMemoryDirective(text) {
  if (!text || typeof text !== 'string') {
    return { type: null, param: null, cleanedText: text || '' };
  }

  const match = text.match(DIRECTIVE_REGEX);
  if (!match) {
    return { type: null, param: null, cleanedText: text };
  }

  const rawType = match[1].toLowerCase();
  let type, param;

  if (rawType.startsWith('only:')) {
    type = 'only';
    param = rawType.slice(5); // everything after "only:"
  } else {
    type = rawType;
    param = null;
  }

  // Strip the matched directive from the text, collapse extra whitespace
  const cleanedText = text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();

  return { type, param, cleanedText };
}

// ─── Publish Directive ────────────────────────────────────────────────────────

/**
 * Regex matching @publish directives. Captures the entity/theme/decision name.
 * Supports quoted names: @publish "my entity name" or unquoted single-word: @publish nats
 */
export const PUBLISH_DIRECTIVE_REGEX = /@publish\s+(?:"([^"]+)"|(\S+))/i;

/**
 * Parse a @publish directive from text.
 *
 * Returns:
 *   - name: string | null (the item name to publish, or null if no directive)
 *   - cleanedText: text with the directive stripped out
 *
 * @param {string} text
 * @returns {{ name: string|null, cleanedText: string }}
 */
export function parsePublishDirective(text) {
  if (!text || typeof text !== 'string') {
    return { name: null, cleanedText: text || '' };
  }

  const match = text.match(PUBLISH_DIRECTIVE_REGEX);
  if (!match) {
    return { name: null, cleanedText: text };
  }

  const name = match[1] || match[2]; // quoted or unquoted
  const cleanedText = text.replace(match[0], '').replace(/\s{2,}/g, ' ').trim();

  return { name, cleanedText };
}

// ─── Message Helpers ─────────────────────────────────────────────────────────

/**
 * Replace the last user message content in an OpenAI-compatible messages array.
 * Returns a new array (non-mutating).
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} newContent — replacement text for the last user message
 * @returns {Array<{role: string, content: string}>}
 */
export function replaceLastUserContent(messages, newContent) {
  if (!messages || !messages.length) return messages || [];
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === 'user' && typeof result[i].content === 'string') {
      result[i] = { ...result[i], content: newContent };
      break;
    }
  }
  return result;
}
