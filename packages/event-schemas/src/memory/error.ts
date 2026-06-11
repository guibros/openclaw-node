import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryErrorSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.error'),
  // R31 (repair 7.7): content samples are byte-capped so no producible
  // event can exceed the stream's payload limit or be dropped for size.
  data: z.object({
    boundary: z.enum(['ingest', 'extract', 'retrieve', 'inject', 'synthesize', 'decay', 'promote']),
    error_code: z.string().max(100),
    error_message: z.string().max(500),
    session_id: z.string().optional(),
  }),
});

export type MemoryErrorEvent = z.infer<typeof MemoryErrorSchema>;
