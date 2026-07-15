Harden FEDERATION_SPEC envelope + session schemas (audit F1/F2/F4)
Fix three documented defects in docs/FEDERATION_SPEC.md. Do NOT change any section not listed. For each defect, produce the corrected text block and a one-line rationale citing the real interface at file:line.

F1 — envelopes (SS5.1 line 338, SS5.2 line 365, SS5.3 line 404) use issued_at, but lib/node-identity.mjs:419-432 checkEventFreshness reads event.timestamp. Also SS5.1 line 343 / SS5.2 line 369 attribute event_id to signEvent, but lib/node-identity.mjs:374-404 signEvent returns {signature, signer_pubkey} only; event_id is caller-injected before signEvent. Fix: issued_at -> timestamp; correct the event_id note.

F2 — envelopes carry signer_pubkey but no signer_node_id; verifyEvent accepts opts.expectedNodeId (registry impersonation defense) which receivers cannot run without it. Fix: add signer_node_id alongside signer_pubkey in SS5.1/SS5.2/SS5.3.

F4 — SS3 prose + SS3.1/SS3.2/SS3.3 anchors use session.architecture; SS4.1 uses session.type. Real discriminator is session.mode (lib/mesh-collab.js:54-59 createSession; :34 CIRCLING_STRATEGY="circling_strategy"). Fix: session.mode everywhere with circling_strategy/cooperative/collaborative/management values.

Acceptance: for each of F1/F2/F4, a corrected schema/text block + one-line rationale citing file:line. No changes outside these three defects.
