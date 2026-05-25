import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const ContextOfferSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('context.offer'),
  data: z.object({
    responding_to: z.string().uuid(),
    offerer_node_id: z.string(),
    artifacts: z.array(z.object({
      artifact_ref: z.string(),
      relevance_score: z.number(),
      provenance: z.object({
        source_node: z.string(),
        source_type: z.string(),
      }),
      summary: z.string(),
    })),
    expires_at: z.string().datetime(),
  }),
});

export type ContextOfferEvent = z.infer<typeof ContextOfferSchema>;
