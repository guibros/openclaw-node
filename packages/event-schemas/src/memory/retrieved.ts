import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryRetrievedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.retrieved'),
  // R31 (repair 7.7): content samples are byte-capped so no producible
  // event can exceed the stream's payload limit or be dropped for size.
  data: z.object({
    query_hash: z.string(),
    channels_hit: z.number().int().nonnegative(),
    results_count: z.number().int().nonnegative(),
    // The actual query text + what came back (capped).
    query: z.string().max(200).optional(),
    concept_names: z.array(z.string().max(200)).max(20).optional(),
    decision_texts: z.array(z.string().max(500)).max(10).optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryRetrievedEvent = z.infer<typeof MemoryRetrievedSchema>;
