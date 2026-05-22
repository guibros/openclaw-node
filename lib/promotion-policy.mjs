/**
 * Promotion policy loader — reads, parses, and validates the promotion policy
 * YAML config that governs which local events are eligible for sharing to the
 * shared JetStream cluster.
 *
 * The policy config lives at config/promotion-policy.yaml by default.
 * Policy evaluation logic (evaluatePromotionPolicy) is implemented by the
 * promoter daemon (Step 4.2).
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default path to the promotion policy config file. */
export const DEFAULT_POLICY_PATH = join(__dirname, '..', 'config', 'promotion-policy.yaml');

/** Valid category names in the policy config. */
export const POLICY_CATEGORIES = ['automatic', 'explicit', 'threshold', 'manual_review'];

/** Valid threshold keys and their expected types. */
const THRESHOLD_KEYS = {
  concept_mention_count: 'number',
  decision_confidence: 'number',
};

/**
 * Validates a parsed promotion policy object.
 * Throws on structural errors; returns the validated policy.
 *
 * @param {object} parsed - The parsed YAML object.
 * @returns {object} The validated policy object.
 * @throws {Error} If the policy is invalid.
 */
export function validatePromotionPolicy(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Promotion policy must be a non-null object');
  }

  // Require all four categories
  for (const cat of POLICY_CATEGORIES) {
    if (!(cat in parsed)) {
      throw new Error(`Missing required policy category: ${cat}`);
    }
  }

  // Reject unknown top-level keys
  for (const key of Object.keys(parsed)) {
    if (!POLICY_CATEGORIES.includes(key)) {
      throw new Error(`Unknown policy category: ${key}`);
    }
  }

  // automatic: must be an array of strings
  if (!Array.isArray(parsed.automatic)) {
    throw new Error('Policy "automatic" must be an array');
  }
  for (const item of parsed.automatic) {
    if (typeof item !== 'string') {
      throw new Error(`Policy "automatic" items must be strings, got ${typeof item}`);
    }
  }

  // explicit: must be an array of strings
  if (!Array.isArray(parsed.explicit)) {
    throw new Error('Policy "explicit" must be an array');
  }
  for (const item of parsed.explicit) {
    if (typeof item !== 'string') {
      throw new Error(`Policy "explicit" items must be strings, got ${typeof item}`);
    }
  }

  // threshold: must be an object with numeric values
  if (typeof parsed.threshold !== 'object' || parsed.threshold === null || Array.isArray(parsed.threshold)) {
    throw new Error('Policy "threshold" must be an object');
  }
  for (const [key, value] of Object.entries(parsed.threshold)) {
    if (!(key in THRESHOLD_KEYS)) {
      throw new Error(`Unknown threshold key: ${key}`);
    }
    if (typeof value !== THRESHOLD_KEYS[key]) {
      throw new Error(`Threshold "${key}" must be a ${THRESHOLD_KEYS[key]}, got ${typeof value}`);
    }
    if (value <= 0) {
      throw new Error(`Threshold "${key}" must be positive, got ${value}`);
    }
  }

  // manual_review: must be an array of strings
  if (!Array.isArray(parsed.manual_review)) {
    throw new Error('Policy "manual_review" must be an array');
  }
  for (const item of parsed.manual_review) {
    if (typeof item !== 'string') {
      throw new Error(`Policy "manual_review" items must be strings, got ${typeof item}`);
    }
  }

  return parsed;
}

/**
 * Loads and validates the promotion policy from a YAML file.
 *
 * @param {string} [configPath] - Path to the YAML config file. Defaults to DEFAULT_POLICY_PATH.
 * @returns {Promise<object>} The validated promotion policy object.
 * @throws {Error} If the file cannot be read or the policy is invalid.
 */
export async function loadPromotionPolicy(configPath = DEFAULT_POLICY_PATH) {
  const raw = await readFile(configPath, 'utf8');
  const parsed = yaml.load(raw);
  return validatePromotionPolicy(parsed);
}
