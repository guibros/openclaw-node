/**
 * parse-env.mjs — Small helpers for consistent environment-variable parsing.
 *
 * Existed primarily to fix F-M22: boolean env vars were parsed inconsistently
 * across the codebase. Some accepted '1' only, some accepted 'false' only,
 * some accepted neither. Operators reading docs and trying `true/yes/on/off`
 * silently got default behavior with no error.
 *
 * @module lib/parse-env
 */

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'y', 't']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'n', 'f']);

/**
 * Parse a boolean-shaped string with sensible defaults.
 * Returns `true` for any of: 1, true, yes, on, y, t (case-insensitive).
 * Returns `false` for any of: 0, false, no, off, n, f.
 * Returns the `defaultValue` when value is undefined/null/empty or unrecognized.
 *
 * @param {string | undefined | null} value
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
export function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (v === '') return defaultValue;
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return defaultValue;
}

/**
 * Parse a numeric env var with a fallback.
 *
 * @param {string | undefined | null} value
 * @param {number} defaultValue
 * @returns {number}
 */
export function parseNum(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}
