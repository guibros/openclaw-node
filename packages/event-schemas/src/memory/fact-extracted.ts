import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// PRODUCER STATUS (repair 7.8): none yet — gateway-era vocabulary; consumers
// already live (memory-budget, openclaw-status, watcher).

export const FactExtractedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.fact_extracted'),
  data: z.object({
    session_id: z.string(),
    fact: z.string(),
    category: z.string(),
    speaker: z.enum(['user', 'assistant']),
    supersedes: z.string().optional(),
  }),
});

export type FactExtractedEvent = z.infer<typeof FactExtractedSchema>;
