import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const ContextAcceptedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('context.accepted'),
  data: z.object({
    responding_to: z.string().uuid(),
    accepted_artifacts: z.array(z.string()),
    feedback: z.object({
      useful: z.boolean(),
      note: z.string().optional(),
    }).optional(),
  }),
});

export type ContextAcceptedEvent = z.infer<typeof ContextAcceptedSchema>;
