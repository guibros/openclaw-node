import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryPromotedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.promoted'),
  data: z.object({
    entities_promoted: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryPromotedEvent = z.infer<typeof MemoryPromotedSchema>;
