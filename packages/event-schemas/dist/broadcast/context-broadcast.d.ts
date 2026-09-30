import { z } from 'zod';
export declare const ContextBroadcastSchema: z.ZodObject<{
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
    event_type: z.ZodLiteral<"context.broadcast">;
    data: z.ZodObject<{
        themes: z.ZodArray<z.ZodString>;
        entities: z.ZodArray<z.ZodString>;
        problem_class: z.ZodOptional<z.ZodEnum<{
            debug: "debug";
            design: "design";
            research: "research";
            implement: "implement";
        }>>;
        intensity: z.ZodEnum<{
            passive: "passive";
            interested: "interested";
            actively_seeking: "actively_seeking";
        }>;
        ttl_minutes: z.ZodNumber;
        dedup_key: z.ZodString;
    }, z.core.$strip>;
}, z.core.$loose>;
export type ContextBroadcastEvent = z.infer<typeof ContextBroadcastSchema>;
//# sourceMappingURL=context-broadcast.d.ts.map