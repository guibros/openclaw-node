import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryRetrievedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.retrieved'),
  data: z.object({
    query_hash: z.string(),
    channels_hit: z.number().int().nonnegative(),
    results_count: z.number().int().nonnegative(),
    // The actual query text + what came back (capped).
    query: z.string().optional(),
    concept_names: z.array(z.string()).optional(),
    decision_texts: z.array(z.string()).optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryRetrievedEvent = z.infer<typeof MemoryRetrievedSchema>;
