import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// PRODUCER STATUS (repair 7.8): none yet — designed for gateway per-turn
// ingest (today the daemon polls JSONL off disk instead). Consumed by the
// memory watcher; renders in mission-control the day a producer lands.

export const TurnRecordedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.turn_recorded'),
  data: z.object({
    session_id: z.string(),
    turn_index: z.number().int().nonnegative(),
    role: z.enum(['user', 'assistant', 'system']),
    content_hash: z.string(),
    token_count: z.number().int().nonnegative().optional(),
  }),
});

export type TurnRecordedEvent = z.infer<typeof TurnRecordedSchema>;
