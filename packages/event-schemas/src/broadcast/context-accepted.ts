import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// F-P406: same array/string bounds as context-broadcast.
export const ContextAcceptedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('context.accepted'),
  data: z.object({
    responding_to: z.string().uuid(),
    accepted_artifacts: z.array(z.string().min(1).max(512)).max(50),
    feedback: z.object({
      useful: z.boolean(),
      note: z.string().max(2048).optional(),
    }).optional(),
  }),
});

export type ContextAcceptedEvent = z.infer<typeof ContextAcceptedSchema>;
