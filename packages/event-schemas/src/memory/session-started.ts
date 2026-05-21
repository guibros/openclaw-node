import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const SessionStartedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.session_started'),
  data: z.object({
    session_id: z.string(),
    start_time: z.string().datetime(),
    session_type: z.enum(['interactive', 'daemon', 'headless']).default('interactive'),
  }),
});

export type SessionStartedEvent = z.infer<typeof SessionStartedSchema>;
