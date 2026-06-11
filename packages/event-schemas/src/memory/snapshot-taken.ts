import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// PRODUCER STATUS (repair 7.8): none yet — gateway-era vocabulary; consumers
// already live (memory-promoter, watcher).

export const SnapshotTakenSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.snapshot_taken'),
  data: z.object({
    session_id: z.string(),
    snapshot_type: z.enum(['memory', 'session', 'full']),
    content_hash: z.string(),
    byte_count: z.number().int().nonnegative(),
  }),
});

export type SnapshotTakenEvent = z.infer<typeof SnapshotTakenSchema>;
