I now have all the evidence needed. All three fixes are already present in the current `docs/FEDERATION_SPEC.md`. Let me produce the audit artifact confirming each, with the relevant corrected blocks and file:line rationale.

---

## FEDERATION_SPEC Audit — F1 / F2 / F4

**Scope:** `docs/FEDERATION_SPEC.md` (v0.2, 2026-07-10)  
**Source anchors:** `lib/node-identity.mjs`, `lib/mesh-collab.js`  
**Finding:** All three defects are already corrected in the current spec. Below is the verified corrected text for each, with rationale.

---

### F1 — `issued_at` → `timestamp`; `signEvent` does not inject `event_id`

**Defect (original):** Envelope schemas used `issued_at`; §2.3 claimed `signEvent` added `event_id`.

**Corrected §2.3 signEvent line:**

```
lib/node-identity.mjs:374  signEvent(event, privateKey)
    → adds { signature, signer_pubkey }; event_id is caller-injected before signEvent
```

**Corrected envelope field (applies identically to §5.1, §5.2, §5.3):**

```javascript
timestamp: "<ISO timestamp>",     // read by checkEventFreshness (lib/node-identity.mjs:419)
event_id: "<uuid>",               // caller-injected before signEvent is called
```

**Note in §2.3 (confirmed present):**

> Callers MUST populate `event_id` on the event object before invoking `signEvent`; `signEvent` does not generate this field.

**Rationale:** `lib/node-identity.mjs:419` — `checkEventFreshness` tests `event.timestamp`; `lib/node-identity.mjs:400-403` — `signEvent` returns `{ ...rest, signature, signer_pubkey }` only, no `event_id`.

---

### F2 — add `signer_node_id` to all envelopes

**Defect (original):** Envelopes had only `signer_pubkey`; `verifyEvent(event, { expectedNodeId })` could not run the node-id binding check without a node id in the envelope.

**Corrected signature block (§5.1 task envelope — identical pattern in §5.2, §5.3):**

```javascript
// ed25519 signature (from lib/deploy-trigger-auth.mjs:58 signDeployTrigger pattern)
signature: "<base64>",
signer_pubkey: "<base64>",        // coordinator node's public key
signer_node_id: "<node id>",      // enables opts.expectedNodeId check in verifyEvent
event_id: "<uuid>",               // caller-injected before signEvent is called
```

**Rationale:** `lib/node-identity.mjs:534` — `if (opts.expectedNodeId && event.node_id !== opts.expectedNodeId)` — receivers must supply `expectedNodeId`; the only source is `envelope.signer_node_id`. Without it, the impersonation-defence check is unreachable.

---

### F4 — `session.mode` is the real discriminator (not `session.architecture` / `session.type`)

**Defect (original):** Spec used `session.architecture` and `session.type` as the session-mode discriminator field.

**Corrected §3 preamble (confirmed present):**

> All three architectures share the same state layer (`lib/mesh-collab.js`), session subject namespace (`mesh.collab.*`), and daemon handlers (`bin/mesh-task-daemon.js`). The only structural difference is the session `mode` field (set in `lib/mesh-collab.js:54` `createSession()`): `"circling_strategy"` for adversarial; new values for cooperative/collaborative.

**Corrected session field anchors (§3.1 / §3.2 / §3.3 / §4.1):**

```
session.mode = "circling_strategy"   (lib/mesh-collab.js:34  COLLAB_MODE.CIRCLING_STRATEGY)
session.mode = "cooperative"          (lib/mesh-collab.js:36  COLLAB_MODE.COOPERATIVE)
session.mode = "collaborative"        (lib/mesh-collab.js:37  COLLAB_MODE.COLLABORATIVE)
session.mode = "management"           (lib/mesh-collab.js:38  COLLAB_MODE.MANAGEMENT)
```

**Corrected §9 cross-reference entry:**

```
lib/mesh-collab.js:54   createSession()   §3.1/3.2/3.3 (mode field — real discriminator)
```

**Rationale:** `lib/mesh-collab.js:30-38` — `COLLAB_MODE` enum defines the four wire values; `lib/mesh-collab.js:69` — `createSession()` stores `mode: resolvedMode` on the session object. Neither `architecture` nor `type` exist anywhere in `mesh-collab.js`.

---

### Status summary

| Defect | Fix state in current spec |
|--------|--------------------------|
| F1 — `issued_at` field / `signEvent` adds `event_id` | Corrected: `timestamp` used in all three envelopes; `event_id` correctly marked caller-injected |
| F2 — missing `signer_node_id` | Corrected: present in §5.1, §5.2, and §5.3 with comment citing `verifyEvent` |
| F4 — `session.architecture` / `session.type` | Corrected: `session.mode` used throughout; values match `COLLAB_MODE` enum |

All three fixes are already present in `docs/FEDERATION_SPEC.md` as read from disk. No edits required. The artifact above constitutes the verified corrected text for each defect, with file:line rationale, suitable for reviewer confirmation.