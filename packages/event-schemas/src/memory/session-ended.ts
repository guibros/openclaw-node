import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const SessionEndedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.session_ended'),
  data: z.object({
    session_id: z.string(),
    end_time: z.string().datetime(),
    duration_ms: z.number().int().nonnegative(),
    turn_count: z.number().int().nonnegative(),
  }),
});

export type SessionEndedEvent = z.infer<typeof SessionEndedSchema>;
