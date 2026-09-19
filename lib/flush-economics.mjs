/**
 * flush-economics.mjs — Marginal-value gate for pre-compression extraction.
 *
 * The flush pipeline already refuses to re-extract a tail whose content hash is
 * unchanged (R4, repair 1.4). That catches "literally nothing happened". It does
 * not catch the common case at a long session's repeated idle boundaries: one
 * short exchange lands, the hash moves, and a full LLM extraction re-runs over a
 * 40-message tail of which 39 messages were already extracted. The call is paid
 * in full for a few percent of new information.
 *
 * This module turns that binary identity check into a marginal-value decision —
 * the shape NVIDIA's SoL-Pi uses for context compaction (arXiv:2609.20519):
 * spend only when the material being bought justifies the call, and keep a
 * window-pressure override so the economics can never suppress the last
 * extraction before the harness compresses the context away.
 *
 * Pure: no I/O, no clock. The caller supplies every measurement, which is what
 * makes the policy testable without a daemon, an LLM, or a transcript.
 */

/**
 * Tunables. Defaults are deliberately conservative: losing a durable fact costs
 * more than a redundant extraction call, so every "unknown" path below resolves
 * toward extracting.
 */
export const DEFAULT_FLUSH_ECONOMICS = Object.freeze({
  /**
   * Absolute new material (tokens) that justifies a call on its own, regardless
   * of how large the tail around it is.
   */
  minNewTokens: 1500,
  /**
   * ...or the new material is at least this fraction of the tail being paid for.
   * Keeps short sessions responsive: a 5-message tail that is 40% new is worth
   * extracting even though 40% of it is well under minNewTokens.
   */
  minMarginalYield: 0.15,
  /**
   * Distance from the context window at which marginal value stops mattering.
   * Inside the reserve this may be the last extraction before compression, so it
   * runs whatever the yield. Mirrors SoL-Pi's windowReserveTokens.
   */
  windowReserveTokens: 16_384,
});

/**
 * Why a flush decision came out the way it did. Logged by the daemon and
 * asserted on in tests — a decision that cannot explain itself is not auditable.
 */
export const FLUSH_REASONS = Object.freeze({
  UNCHANGED_TAIL: 'unchanged_tail',
  NOT_DEFERRABLE: 'not_deferrable',
  FIRST_EXTRACTION: 'first_extraction',
  MARGIN_UNKNOWN: 'margin_unknown',
  TAIL_SATURATED: 'tail_saturated',
  WINDOW_PROTECTION: 'window_protection',
  SUFFICIENT_NEW_MATERIAL: 'sufficient_new_material',
  HIGH_MARGINAL_YIELD: 'high_marginal_yield',
  LOW_MARGINAL_YIELD: 'low_marginal_yield',
});

/**
 * Decide whether a tail is worth sending to the extraction model.
 *
 * @param {Object} input
 * @param {number}      input.tailTokens           — tokens in the tail about to be extracted
 * @param {boolean}     input.unchanged            — tail hash equals the last extracted hash
 * @param {boolean}     input.deferrable           — a later flush is guaranteed to cover deferred material
 * @param {boolean}     input.priorExtraction      — this session has been extracted before
 * @param {boolean}     input.tailSaturated        — every message in the tail is new since the last extraction
 * @param {number|null} input.newTokens            — tokens added since the last extraction; null when unrecorded
 * @param {number|null} input.sessionTokens        — estimated tokens in the whole session; null when unmeasured
 * @param {number|null} input.contextWindowTokens  — model context window; null when unknown
 * @param {Object}     [input.economics]           — overrides for DEFAULT_FLUSH_ECONOMICS
 * @returns {{extract: boolean, reason: string, marginalYield: number|null,
 *            newTokensFloor: number, headroomTokens: number|null,
 *            tailTokens: number, newTokens: number|null}}
 */
export function decideExtraction(input) {
  const economics = { ...DEFAULT_FLUSH_ECONOMICS, ...(input.economics || {}) };
  const tailTokens = Math.max(0, input.tailTokens ?? 0);
  const newTokens = input.newTokens == null ? null : Math.max(0, input.newTokens);

  // Share of the call that buys information the store does not already hold.
  const marginalYield =
    newTokens === null || tailTokens === 0 ? null : newTokens / tailTokens;

  // How close the session is to the point where the harness discards context.
  const headroomTokens =
    input.contextWindowTokens == null || input.sessionTokens == null
      ? null
      : input.contextWindowTokens - input.sessionTokens;

  const decision = (extract, reason) => ({
    extract,
    reason,
    marginalYield,
    newTokensFloor: economics.minNewTokens,
    headroomTokens,
    tailTokens,
    newTokens,
  });

  // Identical content yields identical facts. Nothing — not even window
  // pressure — makes re-extracting it worth a call.
  if (input.unchanged) return decision(false, FLUSH_REASONS.UNCHANGED_TAIL);

  // The caller has not promised a later flush, so this is the last chance to
  // capture this material. Marginal value is irrelevant against losing it.
  // Callers opt in per site; an absent flag leaves the gate disabled entirely,
  // which is exactly the pre-existing behaviour.
  if (!input.deferrable) return decision(true, FLUSH_REASONS.NOT_DEFERRABLE);

  // Nothing has been extracted yet, so the entire tail is new material.
  if (!input.priorExtraction) return decision(true, FLUSH_REASONS.FIRST_EXTRACTION);

  // A prior extraction exists but predates token accounting (or the measurement
  // was unavailable). Without a delta the yield is unknowable, and guessing
  // toward "skip" would silently drop facts, so pay for the call.
  if (newTokens === null) return decision(true, FLUSH_REASONS.MARGIN_UNKNOWN);

  // Every message in the tail is unextracted, so deferring again would push the
  // oldest of them out of the tail window and out of reach for good. The yield
  // gate below would also catch this (a fully-new tail yields 1.0), but that is
  // an artefact of the default ratio; fact retention must not depend on tuning.
  if (input.tailSaturated) return decision(true, FLUSH_REASONS.TAIL_SATURATED);

  // Inside the reserve this may be the last chance before compression.
  if (headroomTokens !== null && headroomTokens <= economics.windowReserveTokens) {
    return decision(true, FLUSH_REASONS.WINDOW_PROTECTION);
  }

  if (newTokens >= economics.minNewTokens) {
    return decision(true, FLUSH_REASONS.SUFFICIENT_NEW_MATERIAL);
  }

  if (marginalYield !== null && marginalYield >= economics.minMarginalYield) {
    return decision(true, FLUSH_REASONS.HIGH_MARGINAL_YIELD);
  }

  // Too little new material to pay for the tail around it. The unconditional
  // end-of-session flush still captures these facts, so deferring costs nothing
  // but the delay; the material keeps accumulating toward the floor meanwhile.
  return decision(false, FLUSH_REASONS.LOW_MARGINAL_YIELD);
}
