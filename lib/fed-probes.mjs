/**
 * lib/fed-probes.mjs — federation health probes for node-watch (step 6.3).
 *
 * Honesty rules (NODE_WATCH_SPEC): WORKING only on an observed signal; BROKEN on
 * an observed failure; OFF when intentionally inactive (no grappe / no session /
 * role); UNKNOWN when unobservable (KV read failed, dependency absent). Never
 * green without evidence.
 *
 * The `grade*` functions are PURE (data in → verdict out) so they unit-test
 * without a live bus. The `probe*` functions fetch live data then grade.
 */

export const FED_STATUS = Object.freeze({ WORKING: 'WORKING', BROKEN: 'BROKEN', OFF: 'OFF', UNKNOWN: 'UNKNOWN' });

// ── Pure graders ────────────────────────────────────────────────────────────

/**
 * Cluster/bus quorum, graded from the AUTHORITATIVE raft signal: jsz `meta_cluster`.
 *
 * Raft elects a leader ONLY while a majority of the group is reachable, so the
 * presence of `leader` IS the quorum test. The previous implementation counted varz
 * `connect_urls`, which cannot see quorum loss: it includes the local server (so
 * `1 + min(routes, connect_urls.length)` counted self twice) and it reflects gossip,
 * not raft membership — with BOTH peers dead it still graded "quorum held 2/3".
 *
 * @param jszReachable  the :8222/jsz endpoint answered
 * @param jszParsed     its body parsed as JSON (false ⇒ unobservable ⇒ UNKNOWN, never green)
 * @param metaCluster   parsed `jsz.meta_cluster`, or null when the server reports no raft cluster
 */
export function gradeClusterQuorum({ jszReachable, jszParsed = true, metaCluster = null }) {
  if (!jszReachable) return { status: FED_STATUS.BROKEN, detail: 'NATS JetStream monitor (:8222/jsz) unreachable — bus down or no monitor' };
  if (!jszParsed) return { status: FED_STATUS.UNKNOWN, detail: 'jsz answered but its body was unparseable — cluster topology unobservable' };
  const size = metaCluster?.cluster_size ?? 1;
  if (!metaCluster || size <= 1) return { status: FED_STATUS.WORKING, detail: 'single-node JetStream bus up (no raft cluster)' };
  const needed = Math.floor(size / 2) + 1;
  return metaCluster.leader
    ? { status: FED_STATUS.WORKING, detail: `R=${size} quorum held — raft leader ${metaCluster.leader} (majority ≥${needed}/${size} reachable)` }
    : { status: FED_STATUS.BROKEN, detail: `R=${size} quorum LOST — no raft leader elected (need ${needed}/${size})` };
}

/** Grappe member heartbeat freshness. No grappe → OFF; a stale member → BROKEN. */
export function gradeGrappeMembers({ grappes, memberHealth = {}, now, freshMs = 90_000 }) {
  if (!Array.isArray(grappes)) return { status: FED_STATUS.UNKNOWN, detail: 'grappe registry unreadable' };
  if (grappes.length === 0) return { status: FED_STATUS.OFF, detail: 'no grappe formed on this node (on-demand)' };
  const stale = [];
  let total = 0;
  for (const g of grappes) {
    for (const m of g.members || []) {
      total++;
      const seenAt = memberHealth[m];
      if (seenAt == null || (now - seenAt) > freshMs) stale.push(`${g.id}/${m}`);
    }
  }
  return stale.length
    ? { status: FED_STATUS.BROKEN, detail: `${stale.length}/${total} member(s) heartbeat stale (>${Math.round(freshMs / 1000)}s): ${stale.slice(0, 3).join(', ')}` }
    : { status: FED_STATUS.WORKING, detail: `${grappes.length} grappe(s), ${total} member(s) all fresh` };
}

/** Collab session liveness. No active session → OFF; an active session not advancing → BROKEN. */
export function gradeSessionLiveness({ sessions, now, stallMs = 15 * 60_000 }) {
  if (!Array.isArray(sessions)) return { status: FED_STATUS.UNKNOWN, detail: 'session KV unreadable' };
  const active = sessions.filter((s) => s.status === 'active' || s.status === 'recruiting');
  if (active.length === 0) return { status: FED_STATUS.OFF, detail: 'no active collab session (grappes run on-demand)' };
  const stalled = active.filter((s) => s.lastActivityMs != null && (now - s.lastActivityMs) > stallMs);
  return stalled.length
    ? { status: FED_STATUS.BROKEN, detail: `${stalled.length}/${active.length} active session(s) STALLED (>${Math.round(stallMs / 60_000)}min no progress)` }
    : { status: FED_STATUS.WORKING, detail: `${active.length} active session(s), advancing` };
}

/**
 * MESH_NODE_HEALTH rows → `{ nodeId: seenAtMs }`. Pure, so the FIELD MAPPING is
 * unit-testable against the shape the publisher really writes.
 *
 * This mapping is where a live grappe silently died: it read `node_id` /
 * `timestamp` / `updated_at`, none of which any writer produces (the publisher
 * writes `nodeId` + `reportedAt`), so every member had no seenAt ⇒ stale ⇒ BROKEN
 * was the only reachable verdict. Written from assumption, never checked against a
 * real heartbeat — hence this function exists to be tested with one.
 */
export function toMemberHealth(rows) {
  const out = {};
  for (const h of rows || []) {
    const nodeId = h.value?.nodeId || h.value?.node_id || h.key;
    const ts = h.value?.reportedAt || h.value?.timestamp || h.value?.updated_at;
    if (!nodeId || !ts) continue;
    const ms = new Date(ts).getTime();
    if (Number.isFinite(ms)) out[nodeId] = ms;
  }
  return out;
}

/** Coordinator (mesh-task-daemon) presence. Not loaded → OFF (role/standalone). */
export function gradeCoordinator({ loaded }) {
  return loaded
    ? { status: FED_STATUS.WORKING, detail: 'mesh-task-daemon loaded (coordinator up)' }
    : { status: FED_STATUS.OFF, detail: 'mesh-task-daemon not loaded (worker/standalone node)' };
}

// ── Live fetchers ───────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/** Connect to NATS briefly; run fn(nc); always close. Returns null on any failure. */
async function withBus(fn, timeoutMs = 4000) {
  let nc;
  try {
    const { connect } = require('nats');
    const { natsConnectOpts } = require('./nats-resolve');
    const opts = typeof natsConnectOpts === 'function' ? natsConnectOpts() : {};
    nc = await connect({ ...opts, servers: 'nats://127.0.0.1:4222', timeout: timeoutMs });
    return await fn(nc);
  } catch {
    return null;
  } finally {
    if (nc) try { await nc.close(); } catch { /* ignore */ }
  }
}

/**
 * Read every entry of a bucket. `bindOnly` matters: plain `views.kv(name)` CREATES
 * the bucket when absent — a watcher probe must never mutate what it observes (an
 * earlier version of this is the likely reason GRAPPE_REGISTRY reappeared empty).
 * Absent bucket ⇒ [] (nothing formed yet), which the graders read as OFF, not green.
 */
async function readKvAll(nc, bucket) {
  let kv;
  try {
    kv = await nc.jetstream().views.kv(bucket, { bindOnly: true });
  } catch (err) {
    if (/not found|no bucket|stream not found/i.test(err?.message || '')) return [];
    throw err;
  }
  const out = [];
  for await (const k of await kv.keys()) {
    const e = await kv.get(k).catch(() => null);
    if (!e) continue;
    try { out.push({ key: k, value: JSON.parse(new TextDecoder().decode(e.value)) }); } catch { /* skip */ }
  }
  return out;
}

export async function probeGrappeMembers(now = Date.now()) {
  const data = await withBus(async (nc) => {
    const registry = await readKvAll(nc, 'GRAPPE_REGISTRY').catch(() => null);
    if (!registry) return null;
    const health = await readKvAll(nc, 'MESH_NODE_HEALTH').catch(() => []);
    const memberHealth = toMemberHealth(health);
    const grappes = registry.map((r) => ({ id: r.value?.id || r.key, members: r.value?.members || [] }));
    return { grappes, memberHealth };
  });
  if (!data) return { status: FED_STATUS.UNKNOWN, detail: 'grappe registry unreadable (bus down or no GRAPPE_REGISTRY)' };
  return gradeGrappeMembers({ ...data, now });
}

export async function probeSessionLiveness(now = Date.now()) {
  const data = await withBus(async (nc) => {
    const rows = await readKvAll(nc, 'MESH_COLLAB').catch(() => null);
    if (!rows) return null;
    return rows.map((r) => {
      const s = r.value || {};
      const last = s.circling?.step_started_at || s.rounds?.[s.rounds.length - 1]?.started_at || s.updated_at || s.created_at;
      return { status: s.status, lastActivityMs: last ? new Date(last).getTime() : null };
    });
  });
  if (!data) return { status: FED_STATUS.UNKNOWN, detail: 'session KV unreadable (bus down or no MESH_COLLAB)' };
  return gradeSessionLiveness({ sessions: data, now });
}
