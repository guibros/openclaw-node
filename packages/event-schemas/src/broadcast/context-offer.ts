import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// F-P402 fix (mirrors F-N9): cap expires_at at 24h in the future.
// Unbounded expires_at let attackers publish offers that never expired,
// permanently pinning entries in the acceptor's pendingOffers Map.
// We intentionally do NOT reject past timestamps at schema time — the
// acceptor has explicit "skip expired" logic that needs to count + log
// already-expired offers. Schema only enforces the upper bound.
const MAX_EXPIRES_FUTURE_MS = 24 * 60 * 60 * 1000;
const expiresAtSchema = z
  .string()
  .datetime()
  .refine(
    (s) => {
      const ms = Date.parse(s);
      if (!Number.isFinite(ms)) return false;
      // Only reject far-future. Past timestamps fall through to the
      // acceptor's expiry-skip path.
      return ms - Date.now() < MAX_EXPIRES_FUTURE_MS;
    },
    'expires_at must be within 24h of now (no far-future eternities)',
  );

// F-P406/F-P407 fix: bound array lengths and numeric ranges to defeat the
// cheapest DoS in the protocol — a single signed offer with a million
// artifacts. Plus relevance_score must be finite and in [0,1] or canonicalize
// (which coerces NaN/Infinity to null) and parse diverge.
const artifactSchema = z.object({
  artifact_ref: z.string().min(1).max(512),
  relevance_score: z.number().min(0).max(1).finite(),
  provenance: z.object({
    source_node: z.string().min(1).max(128),
    source_type: z.string().min(1).max(64),
  }),
  summary: z.string().max(2048),
});

export const ContextOfferSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('context.offer'),
  data: z.object({
    responding_to: z.string().uuid(),
    offerer_node_id: z.string().min(1).max(128),
    artifacts: z.array(artifactSchema).max(50),
    expires_at: expiresAtSchema,
  }),
});

export type ContextOfferEvent = z.infer<typeof ContextOfferSchema>;
