/**
 * flush-economics.mjs — Marginal-value gate for pre-compression extraction.
 *
 * The flush pipeline already refuses to re-extract a window whose content hash
 * is unchanged (R4, repair 1.4). That catches "literally nothing happened". It
 * does not catch the common case at a long session's repeated interval and idle
 * boundaries: one short exchange lands, the hash moves, and a full LLM
 * extraction re-runs over a 40-message window of which 39 were already
 * extracted. The call is paid in full for a few percent of new information.
 *
 * This module turns that binary identity check into a marginal-value decision —
 * the shape NVIDIA's SoL-Pi uses for context compaction (arXiv:2609.20519):
 * spend only when the material being bought justifies the call.
 *
 * SoL-Pi also carries a window-pressure override, because compaction destroys
 * context its agent still needs. There is deliberately none here: extraction
 * reads the durable transcript on disk, which compaction does not shorten, and
 * runFlush's extraction window reaches back to the last extraction point, so a
 * deferral can only delay material, never put it out of reach. The one thing
 * the gate relies on the caller for is `deferrable`: a later flush will run.
 * (An earlier revision measured headroom from cumulative transcript size, which
 * never shrinks; on multi-MB sessions the override fired at every boundary and
 * silently switched the saving off.)
 *
 * Pure: no I/O, no clock. The caller supplies every measurement, which is what
 * makes the policy testable without a daemon, an LLM, or a transcript.
 */

/**
 * Tunables. Deliberately conservative: losing a durable fact costs more than a
 * redundant extraction call, so every "unknown" path below resolves toward
 * extracting.
 */
export const DEFAULT_FLUSH_ECONOMICS = Object.freeze({
  /**
   * Absolute new material (tokens) that justifies a call on its own, regardless
   * of how large the window around it is.
   */
  minNewTokens: 1500,
  /**
   * ...or the new material is at least this fraction of the window being paid
   * for. Keeps short sessions responsive: a 5-message window that is 40% new is
   * worth extracting even though 40% of it is well under minNewTokens.
   */
  minMarginalYield: 0.15,
});

/**
 * Why a decision came out the way it did. The daemon appends it to the flush
 * log line and tests assert on it — a decision that cannot explain itself is
 * not auditable.
 */
export const FLUSH_REASONS = Object.freeze({
  UNCHANGED_TAIL: 'unchanged_tail',
  NOT_DEFERRABLE: 'not_deferrable',
  FIRST_EXTRACTION: 'first_extraction',
  MARGIN_UNKNOWN: 'margin_unknown',
  SUFFICIENT_NEW_MATERIAL: 'sufficient_new_material',
  HIGH_MARGINAL_YIELD: 'high_marginal_yield',
  LOW_MARGINAL_YIELD: 'low_marginal_yield',
});

/**
 * Decide whether an extraction window is worth sending to the model.
 *
 * @param {Object} input
 * @param {number}      input.tailTokens       — tokens in the window about to be extracted
 * @param {boolean}     input.unchanged        — window hash equals the last extracted hash
 * @param {boolean}     input.deferrable       — a later flush is guaranteed to run
 * @param {boolean}     input.priorExtraction  — this session has been extracted before
 * @param {number|null} input.newTokens        — tokens added since the last extraction; null when unknowable
 * @param {Object}     [input.economics]       — overrides for DEFAULT_FLUSH_ECONOMICS
 * @returns {{extract: boolean, reason: string, marginalYield: number|null,
 *            newTokensFloor: number, tailTokens: number, newTokens: number|null}}
 */
export function decideExtraction(input) {
  const economics = { ...DEFAULT_FLUSH_ECONOMICS, ...(input.economics || {}) };
  const tailTokens = Math.max(0, input.tailTokens ?? 0);
  const newTokens = input.newTokens == null ? null : Math.max(0, input.newTokens);

  // Share of the call that buys information the store does not already hold.
  const marginalYield =
    newTokens === null || tailTokens === 0 ? null : newTokens / tailTokens;

  const decision = (extract, reason) => ({
    extract,
    reason,
    marginalYield,
    newTokensFloor: economics.minNewTokens,
    tailTokens,
    newTokens,
  });

  // Identical content yields identical facts; re-extracting it is never worth
  // a call, whatever the caller's guarantees.
  if (input.unchanged) return decision(false, FLUSH_REASONS.UNCHANGED_TAIL);

  // No later flush is promised, so this is the last chance to capture this
  // material. Marginal value is irrelevant against losing it. Callers opt in
  // per site; an absent flag leaves the gate disabled entirely, which is
  // exactly the pre-existing behaviour.
  if (!input.deferrable) return decision(true, FLUSH_REASONS.NOT_DEFERRABLE);

  // Nothing has been extracted yet, so the entire window is new material.
  if (!input.priorExtraction) return decision(true, FLUSH_REASONS.FIRST_EXTRACTION);

  // A prior extraction exists but the delta is unknowable (the transcript was
  // rewritten under us). Guessing toward "skip" would silently drop facts, so
  // pay for the call.
  if (newTokens === null) return decision(true, FLUSH_REASONS.MARGIN_UNKNOWN);

  if (newTokens >= economics.minNewTokens) {
    return decision(true, FLUSH_REASONS.SUFFICIENT_NEW_MATERIAL);
  }

  if (marginalYield !== null && marginalYield >= economics.minMarginalYield) {
    return decision(true, FLUSH_REASONS.HIGH_MARGINAL_YIELD);
  }

  // Too little new material to pay for the window around it. It stays inside
  // the next window and keeps accumulating toward the floor; the ungated
  // end-of-session flush captures whatever is still pending.
  return decision(false, FLUSH_REASONS.LOW_MARGINAL_YIELD);
}
