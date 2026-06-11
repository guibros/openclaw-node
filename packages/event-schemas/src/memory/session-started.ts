import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// PRODUCER STATUS (repair 7.8): none yet — gateway-era session vocabulary;
// consumers already live (memory-budget, watcher).

export const SessionStartedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.session_started'),
  data: z.object({
    session_id: z.string(),
    start_time: z.string().datetime(),
    session_type: z.enum(['interactive', 'daemon', 'headless']).default('interactive'),
  }),
});

export type SessionStartedEvent = z.infer<typeof SessionStartedSchema>;
