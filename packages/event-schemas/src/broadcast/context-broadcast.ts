import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const ContextBroadcastSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('context.broadcast'),
  data: z.object({
    themes: z.array(z.string()),
    entities: z.array(z.string()),
    problem_class: z.enum(['debug', 'design', 'research', 'implement']).optional(),
    intensity: z.enum(['passive', 'interested', 'actively_seeking']),
    // F-N9 fix: bounded TTL. Unbounded z.number() accepted Infinity and
    // negative values; the offerer's expiry check `now - ts > ttl * 60_000`
    // then became `positive > Infinity` (always false) → broadcast never
    // expired locally. Cap at 24h (matches the 24h sig-freshness ceiling
    // in verifyEvent); min 1 minute (anything lower is meaningless given
    // network latency).
    ttl_minutes: z.number().int().positive().min(1).max(60 * 24),
    dedup_key: z.string(),
  }),
});

export type ContextBroadcastEvent = z.infer<typeof ContextBroadcastSchema>;
