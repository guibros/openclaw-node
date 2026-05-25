import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const ContextBroadcastSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('context.broadcast'),
  data: z.object({
    themes: z.array(z.string()),
    entities: z.array(z.string()),
    problem_class: z.enum(['debug', 'design', 'research', 'implement']).optional(),
    intensity: z.enum(['passive', 'interested', 'actively_seeking']),
    ttl_minutes: z.number(),
    dedup_key: z.string(),
  }),
});

export type ContextBroadcastEvent = z.infer<typeof ContextBroadcastSchema>;
