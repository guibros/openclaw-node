import { z } from 'zod';

export const EventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string(),
  event_version: z.number().int().positive().default(1),
  entity_id: z.string(),
  entity_type: z.enum(['task', 'plan', 'collab', 'circling', 'session', 'memory', 'system']),
  timestamp: z.string().datetime(),
  causation_id: z.string().uuid().nullable().default(null),
  correlation_id: z.string().uuid().nullable().default(null),
  actor: z.object({
    type: z.enum(['user', 'agent', 'system']),
    id: z.string(),
  }),
  node_id: z.string(),
  idempotency_key: z.string(),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
