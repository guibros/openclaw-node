import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// PRODUCER STATUS (repair 7.8): none yet — gateway-era vocabulary; consumers
// already live (memory-promoter, watcher).

export const ConceptMentionedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.concept_mentioned'),
  data: z.object({
    session_id: z.string(),
    concept_name: z.string(),
    turn_index: z.number().int().nonnegative(),
    salience: z.number().min(0).max(1).optional(),
  }),
});

export type ConceptMentionedEvent = z.infer<typeof ConceptMentionedSchema>;
