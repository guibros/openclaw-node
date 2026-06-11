import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// PRODUCER STATUS (repair 7.8): none — the live compaction signal flows over
// the raw subject mesh.memory.compaction_completed, bypassing this typed
// event. Migrating that signal here is unclaimed scope. Watcher consumes it.

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
