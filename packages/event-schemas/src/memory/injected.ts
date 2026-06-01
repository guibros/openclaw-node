import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryInjectedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.injected'),
  data: z.object({
    request_id: z.string(),
    token_count: z.number().int().nonnegative(),
    blocks_count: z.number().int().nonnegative(),
    // Preview of the actual memory block text injected into the prompt.
    block_preview: z.string().optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryInjectedEvent = z.infer<typeof MemoryInjectedSchema>;
