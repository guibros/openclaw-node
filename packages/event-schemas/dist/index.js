import { zodToJsonSchema } from 'zod-to-json-schema';
import { MemoryEventSchema } from './events.js';
export { EventEnvelopeSchema } from './envelope.js';
export { MemoryEventSchema, BroadcastEventSchema } from './events.js';
export { SessionStartedSchema, SessionEndedSchema, TurnRecordedSchema, FactExtractedSchema, ConceptMentionedSchema, SnapshotTakenSchema, CompactionTriggeredSchema, ArtifactAttachedSchema, MemoryIngestedSchema, MemoryExtractedSchema, MemoryRetrievedSchema, MemoryInjectedSchema, MemorySynthesizedSchema, MemoryDecayedSchema, MemoryPromotedSchema, MemoryErrorSchema, } from './memory/index.js';
export { ContextBroadcastSchema, ContextOfferSchema, ContextAcceptedSchema, } from './broadcast/index.js';
export function toJsonSchema() {
    // Cast needed: the root node_modules has Zod 4.x while this package targets 3.x.
    // zodToJsonSchema handles both at runtime; the cast resolves the type mismatch
    // until npm install properly resolves workspace-scoped zod@^3.23.0.
    return zodToJsonSchema(MemoryEventSchema, 'MemoryEvent');
}
//# sourceMappingURL=index.js.map