import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryExtractedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.extracted'),
  data: z.object({
    session_id: z.string(),
    entities_count: z.number().int().nonnegative(),
    themes_count: z.number().int().nonnegative(),
    mentions_count: z.number().int().nonnegative(),
    decisions_count: z.number().int().nonnegative(),
    model: z.string(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryExtractedEvent = z.infer<typeof MemoryExtractedSchema>;
