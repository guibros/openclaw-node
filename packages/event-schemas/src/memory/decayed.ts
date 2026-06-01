import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryDecayedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.decayed'),
  data: z.object({
    entities_decayed: z.number().int().nonnegative(),
    // Capped sample of WHICH entities were archived out (the actual loss).
    archived_count: z.number().int().nonnegative().optional(),
    archived_names: z.array(z.string()).optional(),
    archived_more: z.number().int().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryDecayedEvent = z.infer<typeof MemoryDecayedSchema>;
