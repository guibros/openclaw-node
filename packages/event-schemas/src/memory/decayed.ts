import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryDecayedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.decayed'),
  data: z.object({
    entities_decayed: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryDecayedEvent = z.infer<typeof MemoryDecayedSchema>;
