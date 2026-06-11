/**
 * extraction-trigger.mjs — Agnostic extraction trigger via NATS
 *
 * Any LLM frontend can publish `mesh.memory.extract_request` to fire extraction.
 * The memory daemon subscribes and runs the flush pipeline on receipt.
 * A time-based idle fallback self-publishes if no event arrives within the
 * configured threshold (default 45 min / 2700s).
 *
 * Env: EXTRACTION_IDLE_THRESHOLD_SEC (default 2700)
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** NATS subject for extraction requests. */
export const EXTRACT_SUBJECT = 'mesh.memory.extract_request';

/** Default idle threshold in seconds (45 minutes). */
export const DEFAULT_IDLE_THRESHOLD_SEC = 2700;

/**
 * Publish an extraction request to the NATS subject.
 *
 * @param {import('nats').NatsConnection} nc - NATS connection
 * @param {string} nodeId - publishing node's ID
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy] - identifier for the trigger source
 * @returns {{ subject: string, payload: object }}
 */
export function publishExtractRequest(nc, nodeId, opts = {}) {
  const payload = {
    node_id: nodeId,
    triggered_by: opts.triggeredBy || 'manual',
    timestamp: new Date().toISOString(),
  };
  nc.publish(EXTRACT_SUBJECT, encoder.encode(JSON.stringify(payload)));
  return { subject: EXTRACT_SUBJECT, payload };
}

/**
 * Create an extraction trigger that subscribes to NATS extract requests
 * and manages an idle timer for self-triggering.
 *
 * @param {import('nats').NatsConnection} nc - NATS connection
 * @param {string} nodeId - this node's ID
 * @param {object} opts
 * @param {function} opts.onExtract - callback(payload) invoked on each extract request
 * @param {number} [opts.idleThresholdSec] - override idle threshold (env takes priority)
 * @returns {{ start: function, stop: function, resetIdleTimer: function }}
 */
export function createExtractionTrigger(nc, nodeId, opts = {}) {
  const envThreshold = parseFloat(process.env.EXTRACTION_IDLE_THRESHOLD_SEC);
  const thresholdSec = (envThreshold > 0 ? envThreshold : null)
    || opts.idleThresholdSec
    || DEFAULT_IDLE_THRESHOLD_SEC;
  const thresholdMs = thresholdSec * 1000;
  const onExtract = opts.onExtract || (() => {});

  let sub = null;
  let idleTimer = null;
  let running = false;

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function startIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      if (running) {
        publishExtractRequest(nc, nodeId, { triggeredBy: 'idle-timer' });
      }
    }, thresholdMs);
  }

  function resetIdleTimer() {
    if (running) {
      startIdleTimer();
    }
  }

  async function start() {
    if (running) return;
    running = true;

    sub = nc.subscribe(EXTRACT_SUBJECT);
    startIdleTimer();

    // Process messages in background
    (async () => {
      for await (const msg of sub) {
        try {
          const payload = JSON.parse(decoder.decode(msg.data));
          // R40 fix (repair 4.5): an idle-timer ping must NOT re-arm the
          // timer — the self-subscription made it a permanent 45-min publish
          // loop with zero session activity. The timer re-arms on real
          // activity (resetIdleTimer from the daemon) or on requests from
          // non-idle triggers (a frontend asking for extraction IS activity).
          if (payload.triggered_by !== 'idle-timer') {
            startIdleTimer();
          }
          onExtract(payload);
        } catch {
          // Malformed message — skip callback; leave re-arming to real activity.
        }
      }
    })().catch(() => {}); // subscription ends on drain/close
  }

  function stop() {
    running = false;
    clearIdleTimer();
    if (sub) {
      sub.unsubscribe();
      sub = null;
    }
  }

  return { start, stop, resetIdleTimer };
}
