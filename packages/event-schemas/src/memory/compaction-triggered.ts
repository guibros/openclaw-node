import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const CompactionTriggeredSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.compaction_triggered'),
  data: z.object({
    session_id: z.string(),
    trigger: z.enum(['budget_exceeded', 'manual', 'scheduled']),
    entries_before: z.number().int().nonnegative(),
    entries_after: z.number().int().nonnegative(),
  }),
});

export type CompactionTriggeredEvent = z.infer<typeof CompactionTriggeredSchema>;
