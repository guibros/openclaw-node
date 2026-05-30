import { z } from 'zod';
import { SessionStartedSchema } from './memory/session-started.js';
import { SessionEndedSchema } from './memory/session-ended.js';
import { TurnRecordedSchema } from './memory/turn-recorded.js';
import { FactExtractedSchema } from './memory/fact-extracted.js';
import { ConceptMentionedSchema } from './memory/concept-mentioned.js';
import { SnapshotTakenSchema } from './memory/snapshot-taken.js';
import { CompactionTriggeredSchema } from './memory/compaction-triggered.js';
import { ArtifactAttachedSchema } from './memory/artifact-attached.js';
import { MemoryIngestedSchema } from './memory/ingested.js';
import { MemoryExtractedSchema } from './memory/extracted.js';
import { MemoryRetrievedSchema } from './memory/retrieved.js';
import { MemoryInjectedSchema } from './memory/injected.js';
import { MemorySynthesizedSchema } from './memory/synthesized.js';
import { MemoryDecayedSchema } from './memory/decayed.js';
import { MemoryPromotedSchema } from './memory/promoted.js';
import { MemoryErrorSchema } from './memory/error.js';
import { ContextBroadcastSchema } from './broadcast/context-broadcast.js';
import { ContextOfferSchema } from './broadcast/context-offer.js';
import { ContextAcceptedSchema } from './broadcast/context-accepted.js';

export const MemoryEventSchema = z.discriminatedUnion('event_type', [
  SessionStartedSchema,
  SessionEndedSchema,
  TurnRecordedSchema,
  FactExtractedSchema,
  ConceptMentionedSchema,
  SnapshotTakenSchema,
  CompactionTriggeredSchema,
  ArtifactAttachedSchema,
  MemoryIngestedSchema,
  MemoryExtractedSchema,
  MemoryRetrievedSchema,
  MemoryInjectedSchema,
  MemorySynthesizedSchema,
  MemoryDecayedSchema,
  MemoryPromotedSchema,
  MemoryErrorSchema,
]);

export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const BroadcastEventSchema = z.discriminatedUnion('event_type', [
  ContextBroadcastSchema,
  ContextOfferSchema,
  ContextAcceptedSchema,
]);

export type BroadcastEvent = z.infer<typeof BroadcastEventSchema>;
