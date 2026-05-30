import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryRetrievedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.retrieved'),
  data: z.object({
    query_hash: z.string(),
    channels_hit: z.number().int().nonnegative(),
    results_count: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryRetrievedEvent = z.infer<typeof MemoryRetrievedSchema>;
