import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemorySynthesizedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.synthesized'),
  data: z.object({
    trigger: z.enum(['session_end', 'interval', 'manual']),
    artifacts_written: z.array(z.string()),
    duration_ms: z.number().int().nonnegative(),
    // Vault referential-integrity counts, measured on the synthesis cadence
    // (repair 2.5). The watcher/mission-control render these per flush.
    vault_integrity: z
      .object({
        notes: z.number().int().nonnegative(),
        links: z.number().int().nonnegative(),
        resolved: z.number().int().nonnegative(),
        slug_resolvable: z.number().int().nonnegative(),
        dangling: z.number().int().nonnegative(),
        orphans: z.number().int().nonnegative(),
      })
      .optional(),
  }),
});

export type MemorySynthesizedEvent = z.infer<typeof MemorySynthesizedSchema>;
