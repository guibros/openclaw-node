/**
 * lib/nats-cluster-config.js — pure helpers for multi-machine NATS cluster
 * config generation + KV replica resolution (federation step 1.5).
 *
 * The point of the whole exercise: real failsafe is BETWEEN machines. One NATS
 * node per machine, clustered over the network (Tailscale/LAN), with the mesh KV
 * buckets replicated R=3 across those machines — so losing a whole machine loses
 * 1 of 3 copies, not everything. These helpers are pure (peers in → config/count
 * out) so correctness is unit-tested without any live bus or real machines.
 *
 * CommonJS on purpose: the mesh-task-daemon (CJS) and the shared-event-stream
 * (ESM) both consume it — Node's ESM can import these named exports from CJS.
 */

const CLUSTER_PORT = 6222;
/** Standard council quorum size — 3 machines tolerates 1 loss (2/3 majority). */
const MAX_REPLICAS = 3;

/** Parse a peer list ("100.64.0.2, 100.64.0.3" | array) into clean host[:port] tokens. */
function parsePeers(raw) {
  if (raw == null) return [];
  const s = Array.isArray(raw) ? raw.join(',') : String(raw);
  return s.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}

/** One peer token → a `nats-route://host:port` URL. A bare host gets the cluster port. */
function peerToRoute(peer, port = CLUSTER_PORT) {
  const t = String(peer).trim().replace(/^nats-route:\/\//, '');
  // already has :port  (ipv4 host:port, or bracketed ipv6 [::1]:6222)
  const hasPort = /^\[.+\]:\d+$/.test(t) || (!t.startsWith('[') && /:\d+$/.test(t));
  return `nats-route://${hasPort ? t : `${t}:${port}`}`;
}

/** Peers → the indented `routes = [ … ]` block body for the cluster config template. */
function renderClusterRoutes(peers, { port = CLUSTER_PORT, indent = '    ' } = {}) {
  return parsePeers(peers).map((p) => `${indent}${peerToRoute(p, port)}`).join('\n');
}

/** Council replica target from a peer COUNT: self + peers, floored at 1, capped at MAX. */
function replicasForPeers(peerCount, max = MAX_REPLICAS) {
  const n = (Number(peerCount) || 0) + 1;
  return Math.min(Math.max(n, 1), max);
}

/** Clamp any configured replica count into a valid JetStream stream range [1, 5]. */
function clampReplicas(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(Math.max(Math.trunc(v), 1), 5);
}

/**
 * Resolve the replica count for KV buckets / streams at creation time. Install
 * writes OPENCLAW_KV_REPLICAS from the cluster size; a solo box has no such env
 * and correctly gets 1 (creating an R>1 stream on a lone server would fail).
 */
function resolveKvReplicas(env = process.env) {
  return clampReplicas(env.OPENCLAW_KV_REPLICAS ?? 1);
}

module.exports = {
  CLUSTER_PORT, MAX_REPLICAS,
  parsePeers, peerToRoute, renderClusterRoutes,
  replicasForPeers, clampReplicas, resolveKvReplicas,
};
