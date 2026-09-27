import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

export const MemoryDecayedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.decayed'),
  data: z.object({
    entities_decayed: z.number().int().nonnegative(),
    // Capped sample of WHICH entities were archived out.
    archived_count: z.number().int().nonnegative().optional(),
    archived_names: z.array(z.string()).optional(),
    archived_more: z.number().int().nonnegative().optional(),
    // The prune step that follows decay (repair 2026-09-26): decisions moved
    // to decisions_archived, idle themes hard-deleted, and how the step went —
    // disabled = CONSOLIDATE_PRUNE=0, no_backup = themes or decayed-out
    // decisions kept because no VACUUM INTO backup could be taken,
    // aborted = hard cap before prune.
    decisions_archived: z.number().int().nonnegative().optional(),
    themes_deleted: z.number().int().nonnegative().optional(),
    prune_status: z.enum(['ran', 'disabled', 'no_backup', 'aborted']).optional(),
    backup_path: z.string().max(1024).optional(),
    // Per-row identity of everything the cycle took out of the live tables
    // (decay archival + prune), byte-capped like every content sample (R31).
    removed: z.array(z.object({
      action: z.enum(['archived', 'deleted']),
      kind: z.enum(['entity', 'decision', 'theme']),
      id: z.number().int(),
      label: z.string().max(200),
    })).max(50).optional(),
    removed_more: z.number().int().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type MemoryDecayedEvent = z.infer<typeof MemoryDecayedSchema>;
