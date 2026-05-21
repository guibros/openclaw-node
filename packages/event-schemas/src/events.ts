import { z } from 'zod';
import { SessionStartedSchema } from './memory/session-started.js';
import { SessionEndedSchema } from './memory/session-ended.js';
import { TurnRecordedSchema } from './memory/turn-recorded.js';
import { FactExtractedSchema } from './memory/fact-extracted.js';
import { ConceptMentionedSchema } from './memory/concept-mentioned.js';
import { SnapshotTakenSchema } from './memory/snapshot-taken.js';
import { CompactionTriggeredSchema } from './memory/compaction-triggered.js';
import { ArtifactAttachedSchema } from './memory/artifact-attached.js';

export const MemoryEventSchema = z.discriminatedUnion('event_type', [
  SessionStartedSchema,
  SessionEndedSchema,
  TurnRecordedSchema,
  FactExtractedSchema,
  ConceptMentionedSchema,
  SnapshotTakenSchema,
  CompactionTriggeredSchema,
  ArtifactAttachedSchema,
]);

export type MemoryEvent = z.infer<typeof MemoryEventSchema>;
