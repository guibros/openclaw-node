---

## F1 — `issued_at` → `timestamp`; `event_id` attribution

**Rationale:** `lib/node-identity.mjs:419-432` `checkEventFreshness` reads `event.timestamp`, not `event.issued_at`; `lib/node-identity.mjs:374-404` `signEvent` returns `{signature, signer_pubkey}` only — `event_id` is assembled by the caller before `signEvent` is invoked.

**SS5.1 corrected envelope block (line 338 region):**
```json
{
  "event_id": "<caller-generated UUID>",
  "timestamp": "<ISO-8601 UTC>",
  "type": "...",
  "payload": { "..." },
  "signature": "<base64>",
  "signer_pubkey": "<base64 Ed25519 public key>"
}
```
> Note: `event_id` is injected by the caller prior to signing. `signEvent` contributes only `signature` and `signer_pubkey`. `timestamp` (not `issued_at`) is the field checked by `checkEventFreshness`.

**SS5.2 corrected envelope block (line 365 region):** same substitution — replace `issued_at` with `timestamp`; update the `event_id` note identically.

**SS5.3 corrected envelope block (line 404 region):** same substitution.

---

## F2 — Add `signer_node_id` to all envelopes

**Rationale:** `lib/node-identity.mjs:374-404` `verifyEvent` accepts `opts.expectedNodeId` to guard against registry impersonation; without `signer_node_id` in the envelope, receivers cannot supply that argument and the defense is uncallable.

**SS5.1 / SS5.2 / SS5.3 corrected envelope block (add field after `signer_pubkey`):**
```json
{
  "event_id": "<caller-generated UUID>",
  "timestamp": "<ISO-8601 UTC>",
  "type": "...",
  "payload": { "..." },
  "signature": "<base64>",
  "signer_pubkey": "<base64 Ed25519 public key>",
  "signer_node_id": "<node identity string matching registry entry>"
}
```
> Note: receivers MUST pass `signer_node_id` as `opts.expectedNodeId` to `verifyEvent` to exercise the registry-impersonation defense.

---

## F4 — `session.architecture` / `session.type` → `session.mode`

**Rationale:** `lib/mesh-collab.js:54-59` `createSession` writes `session.mode`; `lib/mesh-collab.js:34` defines `CIRCLING_STRATEGY = "circling_strategy"`. No field named `architecture` or `type` is written by the real constructor.

**SS3 prose correction:** Replace every occurrence of `session.architecture` with `session.mode`.

**SS3.1 / SS3.2 / SS3.3 / SS4.1 corrected discriminator block:**
```json
{
  "session": {
    "id": "<uuid>",
    "mode": "circling_strategy | cooperative | collaborative | management",
    "..."
  }
}
```
Replace `session.architecture` (SS3.1/SS3.2/SS3.3) and `session.type` (SS4.1) with `session.mode` using the four literal values above. All branching logic in SS3/SS4 that switches on this field must reference `session.mode`.