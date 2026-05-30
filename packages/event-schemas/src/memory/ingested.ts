import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryIngestedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.ingested'),
  data: z.object({
    session_id: z.string(),
    source: z.string(),
    messages_added: z.number().int().nonnegative(),
    total_messages: z.number().int().nonnegative(),
  }),
});

export type MemoryIngestedEvent = z.infer<typeof MemoryIngestedSchema>;
