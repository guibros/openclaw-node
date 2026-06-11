import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryPromotedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.promoted'),
  // R31 (repair 7.7): content samples are byte-capped so no producible
  // event can exceed the stream's payload limit or be dropped for size.
  data: z.object({
    entities_promoted: z.number().int().nonnegative(),
    // Capped sample of WHICH entities were promoted (the actual content).
    promoted_names: z.array(z.string().max(200)).max(20).optional(),
    promoted_more: z.number().int().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryPromotedEvent = z.infer<typeof MemoryPromotedSchema>;
