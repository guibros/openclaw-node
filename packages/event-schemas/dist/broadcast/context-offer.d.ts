import { z } from 'zod';
export declare const ContextOfferSchema: z.ZodObject<{
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
    event_type: z.ZodLiteral<"context.offer">;
    data: z.ZodObject<{
        responding_to: z.ZodString;
        offerer_node_id: z.ZodString;
        artifacts: z.ZodArray<z.ZodObject<{
            artifact_ref: z.ZodString;
            relevance_score: z.ZodNumber;
            provenance: z.ZodObject<{
                source_node: z.ZodString;
                source_type: z.ZodString;
            }, z.core.$strip>;
            summary: z.ZodString;
        }, z.core.$strip>>;
        expires_at: z.ZodString;
    }, z.core.$strip>;
}, z.core.$loose>;
export type ContextOfferEvent = z.infer<typeof ContextOfferSchema>;
//# sourceMappingURL=context-offer.d.ts.map