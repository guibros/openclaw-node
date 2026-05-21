import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

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
