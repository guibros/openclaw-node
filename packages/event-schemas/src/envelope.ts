import { z } from 'zod';

// Charset constraints per F-P404/F-P405: cap allocation and shape; reject
// payloads that would let a peer DoS the parser by stuffing 10MB strings
// into envelope fields. Bounds are generous for any legitimate use.
const NODE_ID_RE = /^[A-Za-z0-9._-]+$/;          // hostname-ish + underscore + dot
const PUBKEY_B64_RE = /^[A-Za-z0-9+/=]+$/;        // base64 alphabet
const SIG_B64_RE = /^[A-Za-z0-9+/=]+$/;

// F-P413/F-P414: include broadcast-shaped types + 'peer' actor so federation
// events no longer have to lie. Older sessions still pass with the existing
// values.
export const EventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string().min(1).max(128),
  event_version: z.number().int().positive().default(1),
  entity_id: z.string().min(1).max(256),
  entity_type: z.enum([
    'task', 'plan', 'collab', 'circling', 'session', 'memory', 'system',
    'broadcast', 'offer', 'accepted',
  ]),
  timestamp: z.string().datetime(),
  causation_id: z.string().uuid().nullable().default(null),
  correlation_id: z.string().uuid().nullable().default(null),
  actor: z.object({
    type: z.enum(['user', 'agent', 'system', 'peer']),
    id: z.string().min(1).max(256),
  }),
  node_id: z.string().min(1).max(128).regex(NODE_ID_RE),
  idempotency_key: z.string().min(1).max(256),
  // ed25519 pubkey is exactly 44 base64 chars including padding; sig is 88.
  // F-P405: format + length bounds prevent megabyte-payload DoS before
  // verifyEvent's downstream length check.
  signature: z.string().regex(SIG_B64_RE).max(128).optional(),
  signer_pubkey: z.string().regex(PUBKEY_B64_RE).length(44).optional(),
  // F2: signer_node_id enables opts.expectedNodeId check in verifyEvent().
  // Optional for backward-compat with events signed before this field was added.
  signer_node_id: z.string().min(1).max(128).regex(NODE_ID_RE).optional(),
}).passthrough();
// F-P403 fix: .passthrough() preserves unknown keys on parse. Previously the
// default .strip() silently dropped signature/signer_pubkey on the boundary
// parse in offerer/acceptor (we call parse AFTER verifyEvent, which is sound;
// but anything downstream that re-verifies an already-parsed event needs the
// sig fields to still be there). It also unblocks forward-compat: a v2
// peer can add new fields and v1 nodes round-trip them through federation
// without silent data loss. Trade-off: a malicious peer can inject extra
// keys, but they don't pass any consumer's allowlist downstream.

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
