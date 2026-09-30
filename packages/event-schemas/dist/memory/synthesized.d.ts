import { z } from 'zod';
export declare const MemorySynthesizedSchema: z.ZodObject<{
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
    event_type: z.ZodLiteral<"memory.synthesized">;
    data: z.ZodObject<{
        session_id: z.ZodString;
        trigger: z.ZodEnum<{
            manual: "manual";
            session_end: "session_end";
            interval: "interval";
            idle: "idle";
        }>;
        artifacts_written: z.ZodArray<z.ZodString>;
        duration_ms: z.ZodNumber;
        vault_integrity: z.ZodOptional<z.ZodObject<{
            notes: z.ZodNumber;
            links: z.ZodNumber;
            resolved: z.ZodNumber;
            slug_resolvable: z.ZodNumber;
            dangling: z.ZodNumber;
            orphans: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$loose>;
export type MemorySynthesizedEvent = z.infer<typeof MemorySynthesizedSchema>;
//# sourceMappingURL=synthesized.d.ts.map