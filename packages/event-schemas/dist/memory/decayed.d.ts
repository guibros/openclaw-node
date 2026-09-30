import { z } from 'zod';
export declare const MemoryDecayedSchema: z.ZodObject<{
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
    event_type: z.ZodLiteral<"memory.decayed">;
    data: z.ZodObject<{
        entities_decayed: z.ZodNumber;
        archived_count: z.ZodOptional<z.ZodNumber>;
        archived_names: z.ZodOptional<z.ZodArray<z.ZodString>>;
        archived_more: z.ZodOptional<z.ZodNumber>;
        decisions_archived: z.ZodOptional<z.ZodNumber>;
        themes_deleted: z.ZodOptional<z.ZodNumber>;
        prune_status: z.ZodOptional<z.ZodEnum<{
            ran: "ran";
            disabled: "disabled";
            no_backup: "no_backup";
            aborted: "aborted";
        }>>;
        backup_path: z.ZodOptional<z.ZodString>;
        removed: z.ZodOptional<z.ZodArray<z.ZodObject<{
            action: z.ZodEnum<{
                archived: "archived";
                deleted: "deleted";
            }>;
            kind: z.ZodEnum<{
                entity: "entity";
                decision: "decision";
                theme: "theme";
            }>;
            id: z.ZodNumber;
            label: z.ZodString;
        }, z.core.$strip>>>;
        removed_more: z.ZodOptional<z.ZodNumber>;
        duration_ms: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$loose>;
export type MemoryDecayedEvent = z.infer<typeof MemoryDecayedSchema>;
//# sourceMappingURL=decayed.d.ts.map