#!/usr/bin/env node
/**
 * dogfood-council.mjs — Dogfood harness for OpenClaw 3-node federation council
 *
 * Spawns 3 nodes locally (or accepts remote node configs), subscribes to
 * federation NATS subjects, and captures metrics to JSONL for analysis.
 *
 * Metrics tracked:
 *   - broadcast emit rate (count + timestamps)
 *   - offer count and offer-to-acceptance ratio
 *   - average round-trip time (broadcast → context.accepted)
 *   - signature failures
 *   - dead-peer events
 *
 * Usage:
 *   node bin/dogfood-council.mjs --node-ids alpha,bravo,charlie
 *   node bin/dogfood-council.mjs --node-ids alpha,bravo,charlie --duration 86400
 *   node bin/dogfood-council.mjs --stats --metrics-path ~/.openclaw/dogfood-metrics.jsonl
 *
 * Environment:
 *   DOGFOOD_METRICS_PATH — override metrics output path
 *   DOGFOOD_NATS_URL     — NATS server URL (default: nats://localhost:4222)
 *
 * @module bin/dogfood-council
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createWriteStream, readFileSync, existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { spawnNode, readNodeConfig } from './spawn-node.mjs';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default metrics output path. */
export const DEFAULT_METRICS_PATH = join(homedir(), '.openclaw', 'dogfood-metrics.jsonl');

/** Default NATS URL for the dogfood harness. */
export const DEFAULT_NATS_URL = 'nats://localhost:4222';

/** Default council size. */
export const COUNCIL_SIZE = 3;

/** NATS subjects monitored by the dogfood harness. */
export const MONITORED_SUBJECTS = Object.freeze([
  'context.broadcast.>',
  'context.offer.>',
  'context.accepted.>',
  'mesh.health.alerts',
]);

/** Metric event types written to JSONL. */
export const METRIC_TYPES = Object.freeze({
  BROADCAST: 'broadcast',
  OFFER: 'offer',
  ACCEPTED: 'accepted',
  SIGNATURE_FAILURE: 'signature_failure',
  DEAD_PEER: 'dead_peer',
  HARNESS_START: 'harness_start',
  HARNESS_STOP: 'harness_stop',
});

// ─── Metric Recording ────────────────────────────────────────────────────────

/**
 * Create a metric entry for JSONL output.
 *
 * @param {string} type — one of METRIC_TYPES values
 * @param {object} data — metric-specific payload
 * @param {string} [nodeId] — source node ID (if applicable)
 * @returns {{ ts: string, type: string, node_id?: string, data: object }}
 */
export function createMetricEntry(type, data, nodeId) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    ...(nodeId ? { node_id: nodeId } : {}),
    data,
  };
  return entry;
}

/**
 * Format a metric entry as a JSONL line (no trailing newline).
 *
 * @param {object} entry — metric entry from createMetricEntry
 * @returns {string}
 */
export function formatMetricLine(entry) {
  return JSON.stringify(entry);
}

/**
 * Calculate round-trip time between a broadcast and its acceptance.
 *
 * @param {string} broadcastTs — ISO timestamp of the broadcast
 * @param {string} acceptedTs — ISO timestamp of the accepted event
 * @returns {number} — round-trip time in milliseconds
 */
export function calculateRoundTripMs(broadcastTs, acceptedTs) {
  const start = new Date(broadcastTs).getTime();
  const end = new Date(acceptedTs).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return -1;
  return Math.max(0, end - start);
}

// ─── Stats Aggregation ──────────────────────────────────────────────────────

/**
 * Aggregate metrics from a JSONL file into summary statistics.
 *
 * @param {string} metricsPath — path to the JSONL file
 * @returns {{ broadcast_count: number, offer_count: number, accepted_count: number, offer_to_acceptance_ratio: number, avg_round_trip_ms: number, signature_failures: number, dead_peer_events: number, duration_sec: number, per_node: object }}
 */
export function aggregateMetrics(metricsPath) {
  const filePath = metricsPath || DEFAULT_METRICS_PATH;

  if (!existsSync(filePath)) {
    return emptyStats();
  }

  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return emptyStats();

  const lines = content.split('\n').filter(Boolean);
  return aggregateFromLines(lines);
}

/**
 * Aggregate from an array of JSONL lines.
 *
 * @param {string[]} lines
 * @returns {object}
 */
export function aggregateFromLines(lines) {
  let broadcastCount = 0;
  let offerCount = 0;
  let acceptedCount = 0;
  let signatureFailures = 0;
  let deadPeerEvents = 0;
  const roundTrips = [];
  let startTs = null;
  let stopTs = null;
  const perNode = {};

  /** @type {Map<string, string>} broadcastEventId → broadcastTs */
  const broadcastTimestamps = new Map();

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const nodeId = entry.node_id || 'unknown';
    if (!perNode[nodeId]) {
      perNode[nodeId] = { broadcasts: 0, offers: 0, accepted: 0, sig_failures: 0, dead_peers: 0 };
    }

    switch (entry.type) {
      case METRIC_TYPES.BROADCAST:
        broadcastCount++;
        perNode[nodeId].broadcasts++;
        if (entry.data?.event_id) {
          broadcastTimestamps.set(entry.data.event_id, entry.ts);
        }
        break;

      case METRIC_TYPES.OFFER:
        offerCount++;
        perNode[nodeId].offers++;
        break;

      case METRIC_TYPES.ACCEPTED:
        acceptedCount++;
        perNode[nodeId].accepted++;
        // Calculate round-trip if we have the original broadcast timestamp
        if (entry.data?.responding_to_broadcast) {
          const bcastTs = broadcastTimestamps.get(entry.data.responding_to_broadcast);
          if (bcastTs) {
            const rt = calculateRoundTripMs(bcastTs, entry.ts);
            if (rt >= 0) roundTrips.push(rt);
          }
        }
        break;

      case METRIC_TYPES.SIGNATURE_FAILURE:
        signatureFailures++;
        perNode[nodeId].sig_failures++;
        break;

      case METRIC_TYPES.DEAD_PEER:
        deadPeerEvents++;
        perNode[nodeId].dead_peers++;
        break;

      case METRIC_TYPES.HARNESS_START:
        if (!startTs) startTs = entry.ts;
        break;

      case METRIC_TYPES.HARNESS_STOP:
        stopTs = entry.ts;
        break;
    }
  }

  const avgRoundTrip = roundTrips.length > 0
    ? Math.round(roundTrips.reduce((a, b) => a + b, 0) / roundTrips.length)
    : 0;

  let durationSec = 0;
  if (startTs && stopTs) {
    durationSec = Math.round((new Date(stopTs).getTime() - new Date(startTs).getTime()) / 1000);
  } else if (startTs) {
    durationSec = Math.round((Date.now() - new Date(startTs).getTime()) / 1000);
  }

  return {
    broadcast_count: broadcastCount,
    offer_count: offerCount,
    accepted_count: acceptedCount,
    offer_to_acceptance_ratio: broadcastCount > 0
      ? Math.round((acceptedCount / broadcastCount) * 1000) / 1000
      : 0,
    avg_round_trip_ms: avgRoundTrip,
    signature_failures: signatureFailures,
    dead_peer_events: deadPeerEvents,
    round_trip_samples: roundTrips.length,
    duration_sec: durationSec,
    per_node: perNode,
  };
}

/**
 * Return an empty stats object.
 * @returns {object}
 */
export function emptyStats() {
  return {
    broadcast_count: 0,
    offer_count: 0,
    accepted_count: 0,
    offer_to_acceptance_ratio: 0,
    avg_round_trip_ms: 0,
    signature_failures: 0,
    dead_peer_events: 0,
    round_trip_samples: 0,
    duration_sec: 0,
    per_node: {},
  };
}

// ─── NATS Metric Collector ──────────────────────────────────────────────────

/**
 * Create a metric collector that subscribes to NATS subjects and records events.
 *
 * @param {object} nc — NATS connection (nats.js v2 API)
 * @param {object} opts
 * @param {string} opts.metricsPath — path to write JSONL
 * @param {string[]} opts.nodeIds — node IDs in the council
 * @param {Function} [opts.log] — logging function
 * @returns {{ start: Function, stop: Function, getStats: Function, recordMetric: Function }}
 */
export function createMetricCollector(nc, opts = {}) {
  const metricsPath = opts.metricsPath || DEFAULT_METRICS_PATH;
  const nodeIds = opts.nodeIds || [];
  const log = opts.log || (() => {});
  const subscriptions = [];
  const lines = [];
  let stopped = false;

  /**
   * Record a metric entry — append to JSONL and track in-memory.
   *
   * @param {string} type
   * @param {object} data
   * @param {string} [nodeId]
   */
  async function recordMetric(type, data, nodeId) {
    if (stopped) return;
    const entry = createMetricEntry(type, data, nodeId);
    const line = formatMetricLine(entry) + '\n';
    lines.push(line.trim());
    try {
      await appendFile(metricsPath, line, 'utf8');
    } catch (err) {
      log(`[dogfood] metric write failed: ${err.message}`);
    }
  }

  /**
   * Process a received NATS message and classify it as a metric event.
   *
   * @param {string} subject — NATS subject
   * @param {object} data — decoded event data
   */
  async function processMessage(subject, data) {
    if (!data || typeof data !== 'object') return;

    const sourceNode = data.source_node_id || data.node_id || 'unknown';

    if (subject.startsWith('context.broadcast.')) {
      await recordMetric(METRIC_TYPES.BROADCAST, {
        event_id: data.event_id,
        themes: data.data?.themes,
        entities: data.data?.entities,
        intensity: data.data?.intensity,
        dedup_key: data.data?.dedup_key,
      }, sourceNode);
    } else if (subject.startsWith('context.offer.')) {
      // Check for signature failure indicator
      if (data._signature_rejected) {
        await recordMetric(METRIC_TYPES.SIGNATURE_FAILURE, {
          event_id: data.event_id,
          reason: 'bad_signature',
        }, sourceNode);
      } else {
        await recordMetric(METRIC_TYPES.OFFER, {
          event_id: data.event_id,
          responding_to: data.data?.responding_to,
          artifact_count: data.data?.artifacts?.length || 0,
        }, sourceNode);
      }
    } else if (subject.startsWith('context.accepted.')) {
      await recordMetric(METRIC_TYPES.ACCEPTED, {
        event_id: data.event_id,
        responding_to_broadcast: data.data?.responding_to,
        accepted_artifacts: data.data?.accepted_artifacts?.length || 0,
      }, sourceNode);
    } else if (subject === 'mesh.health.alerts') {
      // Check for dead-peer mentions in health alerts
      const detail = JSON.stringify(data.data || data);
      if (/dead.?peer|peer.?offline|peer.?unreachable/i.test(detail)) {
        await recordMetric(METRIC_TYPES.DEAD_PEER, {
          alert: data.data || {},
        }, sourceNode);
      }
    }
  }

  /**
   * Start collecting metrics — subscribe to monitored NATS subjects.
   */
  async function start() {
    await recordMetric(METRIC_TYPES.HARNESS_START, {
      node_ids: nodeIds,
      metrics_path: metricsPath,
    });

    // Subscribe to each monitored subject pattern
    for (const subjectPattern of MONITORED_SUBJECTS) {
      try {
        const sub = nc.subscribe(subjectPattern);
        subscriptions.push(sub);

        // Process messages asynchronously
        (async () => {
          for await (const msg of sub) {
            try {
              const decoded = JSON.parse(new TextDecoder().decode(msg.data));
              await processMessage(msg.subject, decoded);
            } catch {
              // Malformed message — skip
            }
          }
        })();
      } catch (err) {
        log(`[dogfood] subscribe to ${subjectPattern} failed: ${err.message}`);
      }
    }

    log(`[dogfood] metric collector started — monitoring ${subscriptions.length} subjects`);
  }

  /**
   * Stop collecting and write final metrics.
   */
  async function stop() {
    stopped = true;
    for (const sub of subscriptions) {
      try {
        sub.unsubscribe();
      } catch { /* ignore */ }
    }

    await recordMetric(METRIC_TYPES.HARNESS_STOP, {
      total_lines: lines.length,
    });

    log('[dogfood] metric collector stopped');
  }

  /**
   * Get current aggregated stats from in-memory lines.
   * @returns {object}
   */
  function getStats() {
    return aggregateFromLines(lines);
  }

  return { start, stop, getStats, recordMetric, processMessage };
}

// ─── Dogfood Harness ────────────────────────────────────────────────────────

/**
 * Create the dogfood harness — sets up nodes and metric collection.
 *
 * @param {object} opts
 * @param {string[]} opts.nodeIds — 3 node identifiers
 * @param {string} [opts.natsUrl] — NATS server URL
 * @param {string} [opts.metricsPath] — metrics JSONL output path
 * @param {string} [opts.baseDir] — base directory for spawned nodes
 * @param {number} [opts.durationSec] — auto-stop after N seconds (0 = manual stop)
 * @param {Function} [opts.log] — logging function
 * @returns {Promise<{ start: Function, stop: Function, getStats: Function, nodes: object[] }>}
 */
export async function createDogfoodHarness(opts = {}) {
  const nodeIds = opts.nodeIds || ['alpha', 'bravo', 'charlie'];
  const natsUrl = opts.natsUrl || process.env.DOGFOOD_NATS_URL || DEFAULT_NATS_URL;
  const metricsPath = opts.metricsPath || process.env.DOGFOOD_METRICS_PATH || DEFAULT_METRICS_PATH;
  const baseDir = opts.baseDir;
  const durationSec = opts.durationSec || 0;
  const log = opts.log || console.log;

  if (nodeIds.length < COUNCIL_SIZE) {
    throw new Error(`Council requires at least ${COUNCIL_SIZE} nodes, got ${nodeIds.length}`);
  }

  // Spawn or verify node trees
  const nodes = [];
  for (const id of nodeIds) {
    const result = await spawnNode({ id, natsUrl, baseDir });
    const config = await readNodeConfig(id, { baseDir });
    nodes.push({ id, ...result, config });
    log(`[dogfood] node "${id}" ready at ${result.nodeRoot}`);
  }

  let nc = null;
  let collector = null;
  let durationTimer = null;

  /**
   * Start the harness — connect to NATS and begin metric collection.
   */
  async function start() {
    // Connect to NATS
    try {
      const { connect } = await import('nats');
      nc = await connect({ servers: natsUrl });
      log(`[dogfood] connected to NATS at ${natsUrl}`);
    } catch (err) {
      log(`[dogfood] NATS connection failed: ${err.message} — running in offline mode`);
      nc = null;
    }

    if (nc) {
      collector = createMetricCollector(nc, { metricsPath, nodeIds, log });
      await collector.start();
    }

    if (durationSec > 0) {
      durationTimer = setTimeout(async () => {
        log(`[dogfood] duration ${durationSec}s elapsed — stopping`);
        await stop();
      }, durationSec * 1000);
      durationTimer.unref();
    }

    log('[dogfood] harness started');
  }

  /**
   * Stop the harness — disconnect from NATS and flush metrics.
   */
  async function stop() {
    if (durationTimer) {
      clearTimeout(durationTimer);
      durationTimer = null;
    }

    if (collector) {
      await collector.stop();
    }

    if (nc) {
      try {
        await nc.drain();
      } catch { /* ignore */ }
      nc = null;
    }

    log('[dogfood] harness stopped');
  }

  /**
   * Get current stats.
   * @returns {object}
   */
  function getStats() {
    if (collector) return collector.getStats();
    return aggregateMetrics(metricsPath);
  }

  return { start, stop, getStats, nodes };
}

/**
 * Format aggregated stats as a human-readable report.
 *
 * @param {object} stats — from aggregateMetrics or getStats
 * @returns {string}
 */
export function formatStatsReport(stats) {
  const lines = [];
  lines.push('# Dogfood Council — Metrics Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Broadcasts emitted | ${stats.broadcast_count} |`);
  lines.push(`| Offers received | ${stats.offer_count} |`);
  lines.push(`| Accepted | ${stats.accepted_count} |`);
  lines.push(`| Offer-to-acceptance ratio | ${stats.offer_to_acceptance_ratio} |`);
  lines.push(`| Avg round-trip (ms) | ${stats.avg_round_trip_ms} |`);
  lines.push(`| Round-trip samples | ${stats.round_trip_samples} |`);
  lines.push(`| Signature failures | ${stats.signature_failures} |`);
  lines.push(`| Dead-peer events | ${stats.dead_peer_events} |`);
  lines.push(`| Duration (sec) | ${stats.duration_sec} |`);

  if (Object.keys(stats.per_node).length > 0) {
    lines.push('');
    lines.push('## Per-Node Breakdown');
    lines.push('');
    lines.push('| Node | Broadcasts | Offers | Accepted | Sig Failures | Dead Peers |');
    lines.push('|------|-----------|--------|----------|-------------|-----------|');
    for (const [nodeId, data] of Object.entries(stats.per_node)) {
      lines.push(`| ${nodeId} | ${data.broadcasts} | ${data.offers} | ${data.accepted} | ${data.sig_failures} | ${data.dead_peers} |`);
    }
  }

  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      'node-ids': { type: 'string' },
      'nats-url': { type: 'string' },
      'metrics-path': { type: 'string' },
      'base-dir': { type: 'string' },
      duration: { type: 'string' },
      stats: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: node bin/dogfood-council.mjs [options]

Options:
  --node-ids <a,b,c>     Comma-separated node identifiers (default: alpha,bravo,charlie)
  --nats-url <url>       NATS server URL (default: nats://localhost:4222)
  --metrics-path <path>  Metrics JSONL output path (default: ~/.openclaw/dogfood-metrics.jsonl)
  --base-dir <dir>       Base directory for spawned nodes
  --duration <sec>       Auto-stop after N seconds (default: run until SIGINT)
  --stats                Print aggregated stats from existing metrics file and exit
  -h, --help             Show this help

Metrics File:
  The harness writes JSONL to the metrics path. Each line is a JSON object with:
    ts        — ISO timestamp
    type      — broadcast | offer | accepted | signature_failure | dead_peer | harness_start | harness_stop
    node_id   — source node identifier
    data      — metric-specific payload

See docs/DOGFOOD_PROTOCOL.md for interpretation guide.`);
    process.exit(0);
  }

  // --stats mode: print stats and exit
  if (values.stats) {
    const metricsPath = values['metrics-path'] || process.env.DOGFOOD_METRICS_PATH || DEFAULT_METRICS_PATH;
    const stats = aggregateMetrics(metricsPath);
    console.log(formatStatsReport(stats));
    process.exit(0);
  }

  const nodeIds = values['node-ids']
    ? values['node-ids'].split(',').map(s => s.trim()).filter(Boolean)
    : ['alpha', 'bravo', 'charlie'];

  if (nodeIds.length < COUNCIL_SIZE) {
    console.error(`error: council requires at least ${COUNCIL_SIZE} node IDs`);
    process.exit(1);
  }

  try {
    const harness = await createDogfoodHarness({
      nodeIds,
      natsUrl: values['nats-url'],
      metricsPath: values['metrics-path'],
      baseDir: values['base-dir'],
      durationSec: values.duration ? parseInt(values.duration, 10) : 0,
    });

    await harness.start();

    // Graceful shutdown on SIGINT/SIGTERM
    const shutdown = async (sig) => {
      console.log(`\n[dogfood] ${sig} received — shutting down`);
      await harness.stop();
      const stats = harness.getStats();
      console.log('\n' + formatStatsReport(stats));
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    console.log(`[dogfood] council running with nodes: ${nodeIds.join(', ')}`);
    console.log('[dogfood] press Ctrl+C to stop and see metrics');
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

// Run CLI if invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('/dogfood-council.mjs')
  || process.argv[1].endsWith('\\dogfood-council.mjs')
);
if (isMain) {
  main();
}
