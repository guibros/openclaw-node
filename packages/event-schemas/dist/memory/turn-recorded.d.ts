import { z } from 'zod';
export declare const TurnRecordedSchema: z.ZodObject<{
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
    event_type: z.ZodLiteral<"memory.turn_recorded">;
    data: z.ZodObject<{
        session_id: z.ZodString;
        turn_index: z.ZodNumber;
        role: z.ZodEnum<{
            system: "system";
            user: "user";
            assistant: "assistant";
        }>;
        content_hash: z.ZodString;
        token_count: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$loose>;
export type TurnRecordedEvent = z.infer<typeof TurnRecordedSchema>;
//# sourceMappingURL=turn-recorded.d.ts.map