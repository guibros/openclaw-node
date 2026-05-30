import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryErrorSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.error'),
  data: z.object({
    boundary: z.enum(['ingest', 'extract', 'retrieve', 'inject', 'synthesize', 'decay', 'promote']),
    error_code: z.string(),
    error_message: z.string(),
    session_id: z.string().optional(),
  }),
});

export type MemoryErrorEvent = z.infer<typeof MemoryErrorSchema>;
