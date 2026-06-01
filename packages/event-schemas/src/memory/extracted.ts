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
    // Capped samples of the actual extracted content (not just counts).
    entity_names: z.array(z.string()).optional(),
    theme_labels: z.array(z.string()).optional(),
    decision_texts: z.array(z.string()).optional(),
    model: z.string(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryExtractedEvent = z.infer<typeof MemoryExtractedSchema>;
