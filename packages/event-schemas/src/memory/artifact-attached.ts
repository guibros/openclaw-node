import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const ArtifactAttachedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.artifact_attached'),
  data: z.object({
    session_id: z.string(),
    artifact_ref: z.string(),
    mime_type: z.string(),
    filename: z.string().optional(),
    byte_count: z.number().int().nonnegative(),
  }),
});

export type ArtifactAttachedEvent = z.infer<typeof ArtifactAttachedSchema>;
