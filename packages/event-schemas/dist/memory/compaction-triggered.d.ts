import { z } from 'zod';
export declare const CompactionTriggeredSchema: z.ZodObject<{
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
    event_type: z.ZodLiteral<"memory.compaction_triggered">;
    data: z.ZodObject<{
        session_id: z.ZodString;
        trigger: z.ZodEnum<{
            budget_exceeded: "budget_exceeded";
            manual: "manual";
            scheduled: "scheduled";
        }>;
        entries_before: z.ZodNumber;
        entries_after: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$loose>;
export type CompactionTriggeredEvent = z.infer<typeof CompactionTriggeredSchema>;
//# sourceMappingURL=compaction-triggered.d.ts.map