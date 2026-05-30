import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemorySynthesizedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.synthesized'),
  data: z.object({
    trigger: z.enum(['session_end', 'interval', 'manual']),
    artifacts_written: z.array(z.string()),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemorySynthesizedEvent = z.infer<typeof MemorySynthesizedSchema>;
