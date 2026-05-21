import { zodToJsonSchema } from 'zod-to-json-schema';
import { MemoryEventSchema } from './events.js';

export { EventEnvelopeSchema, type EventEnvelope } from './envelope.js';
export { MemoryEventSchema, type MemoryEvent } from './events.js';
export {
  SessionStartedSchema, type SessionStartedEvent,
  SessionEndedSchema, type SessionEndedEvent,
  TurnRecordedSchema, type TurnRecordedEvent,
  FactExtractedSchema, type FactExtractedEvent,
  ConceptMentionedSchema, type ConceptMentionedEvent,
  SnapshotTakenSchema, type SnapshotTakenEvent,
  CompactionTriggeredSchema, type CompactionTriggeredEvent,
  ArtifactAttachedSchema, type ArtifactAttachedEvent,
} from './memory/index.js';

export function toJsonSchema() {
  // Cast needed: the root node_modules has Zod 4.x while this package targets 3.x.
  // zodToJsonSchema handles both at runtime; the cast resolves the type mismatch
  // until npm install properly resolves workspace-scoped zod@^3.23.0.
  return zodToJsonSchema(MemoryEventSchema as any, 'MemoryEvent');
}
