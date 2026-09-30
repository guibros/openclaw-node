import { z } from 'zod';
export declare const MemoryErrorSchema: z.ZodObject<{
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
    event_type: z.ZodLiteral<"memory.error">;
    data: z.ZodObject<{
        boundary: z.ZodEnum<{
            ingest: "ingest";
            extract: "extract";
            retrieve: "retrieve";
            inject: "inject";
            synthesize: "synthesize";
            decay: "decay";
            promote: "promote";
        }>;
        error_code: z.ZodString;
        error_message: z.ZodString;
        session_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$loose>;
export type MemoryErrorEvent = z.infer<typeof MemoryErrorSchema>;
//# sourceMappingURL=error.d.ts.map