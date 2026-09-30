import { z } from 'zod';
export declare const MemoryExtractedSchema: z.ZodObject<{
    event_id: z.ZodString;
    event_version: z.ZodDefault<z.ZodNumber>;
    entity_id: z.ZodString;
    entity_type: z.ZodEnum<{
        task: "task";
        plan: "plan";
        collab: "collab";
        circling: "circling";
        session: "session";
        memory: "memory";
        system: "system";
        broadcast: "broadcast";
        offer: "offer";
        accepted: "accepted";
    }>;
    timestamp: z.ZodString;
    causation_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    correlation_id: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    actor: z.ZodObject<{
        type: z.ZodEnum<{
            system: "system";
            user: "user";
            agent: "agent";
            peer: "peer";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
    node_id: z.ZodString;
    idempotency_key: z.ZodString;
    signature: z.ZodOptional<z.ZodString>;
    signer_pubkey: z.ZodOptional<z.ZodString>;
    signer_node_id: z.ZodOptional<z.ZodString>;
    event_type: z.ZodLiteral<"memory.extracted">;
    data: z.ZodObject<{
        session_id: z.ZodString;
        entities_count: z.ZodNumber;
        themes_count: z.ZodNumber;
        mentions_count: z.ZodNumber;
        decisions_count: z.ZodNumber;
        entity_names: z.ZodOptional<z.ZodArray<z.ZodString>>;
        theme_labels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        decision_texts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        deduplicated: z.ZodOptional<z.ZodBoolean>;
        model: z.ZodString;
        duration_ms: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$loose>;
export type MemoryExtractedEvent = z.infer<typeof MemoryExtractedSchema>;
//# sourceMappingURL=extracted.d.ts.map