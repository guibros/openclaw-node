/**
 * tracer.js — Unified observability for the OpenClaw node protocol.
 *
 * Two modes:
 *   - "dev"   — logs every function call (~500 instrumentation points)
 *   - "smart" — only logs state transitions, errors, cross-node events, slow calls (>500ms)
 *
 * Transport: NATS publish to openclaw.trace.{nodeId}.{module} (primary)
 *            + in-memory ring buffer (fallback / local reads)
 *
 * Usage:
 *   const tracer = require('./tracer').createTracer('mesh-tasks');
 *   tracer.wrapClass(instance, ['claim', 'markRunning', ...], { tier: 1 });
 *   // or
 *   const fn = tracer.wrapAsync('myFn', async (a, b) => { ... }, { tier: 2 });
 */

'use strict';

const os = require('os');
const crypto = require('crypto');

// ── Configuration ──────────────────────────────────────

const NODE_ID = process.env.OPENCLAW_NODE_ID || os.hostname();
let _traceMode = process.env.OPENCLAW_TRACE_MODE || 'smart'; // 'dev' | 'smart'
let _natsConnection = null;
let _stringCodec = null;
const SLOW_THRESHOLD_MS = 500;

function setTraceMode(mode) {
  if (mode !== 'dev' && mode !== 'smart') return;
  _traceMode = mode;
}

function getTraceMode() {
  return _traceMode;
}

/**
 * Attach a NATS connection for trace publishing.
 * Call once after NATS connects in each daemon.
 */
function setNatsConnection(nc, sc) {
  _natsConnection = nc;
  _stringCodec = sc;
}

// ── Ring Buffer ────────────────────────────────────────

const RING_SIZE = 2000;
const _ringBuffer = new Array(RING_SIZE);
let _ringIndex = 0;
let _totalEvents = 0;

function pushToRing(event) {
  _ringBuffer[_ringIndex] = event;
  _ringIndex = (_ringIndex + 1) % RING_SIZE;
  _totalEvents++;
}

function getRecentEvents(limit = 100) {
  const events = [];
  const start = (_ringIndex - 1 + RING_SIZE) % RING_SIZE;
  for (let i = 0; i < Math.min(limit, RING_SIZE); i++) {
    const idx = (start - i + RING_SIZE) % RING_SIZE;
    if (_ringBuffer[idx]) events.push(_ringBuffer[idx]);
  }
  return events;
}

function getTotalEventCount() {
  return _totalEvents;
}

// ── Smart Sampling Filter ──────────────────────────────

const ALWAYS_LOG_CATEGORIES = new Set([
  'state_transition', 'error', 'cross_node', 'lifecycle'
]);

function shouldLog(event) {
  if (_traceMode === 'dev') return true;

  // Smart mode: always log tier 1
  if (event.tier === 1) return true;
  // Always log errors
  if (event.error) return true;
  // Always log critical categories
  if (ALWAYS_LOG_CATEGORIES.has(event.category)) return true;
  // Always log slow calls
  if (event.duration_ms > SLOW_THRESHOLD_MS) return true;

  return false;
}

// ── HTTP Fallback Transport ───────────────────────────
// When NATS is unavailable, batch events and POST to MC's ingest endpoint.

const MC_INGEST_URL = process.env.OPENCLAW_MC_URL
  ? `${process.env.OPENCLAW_MC_URL}/api/observability/ingest`
  : 'http://localhost:3000/api/observability/ingest';

let _httpBuffer = [];
let _httpFlushTimer = null;
const HTTP_BATCH_INTERVAL_MS = 3000;
const HTTP_MAX_BUFFER = 200;
let _httpFailCount = 0;
let _httpLastRetryReset = 0;
const HTTP_MAX_BACKOFF = 20; // pause after 20 consecutive failures, retry every 60s

function flushHttpBuffer() {
  if (_httpBuffer.length === 0) return;
  if (_httpFailCount >= HTTP_MAX_BACKOFF) {
    // Retry every 60s instead of giving up permanently
    if (Date.now() - _httpLastRetryReset < 60000) {
      _httpBuffer = [];
      return;
    }
    _httpFailCount = 0;
    _httpLastRetryReset = Date.now();
    console.warn(`[tracer] HTTP transport: retrying after backoff (${_httpBuffer.length} buffered)`);
  }
  const batch = _httpBuffer.splice(0);
  // Fire-and-forget HTTP POST
  const http = require('http');
  const url = new URL(MC_INGEST_URL);
  const body = JSON.stringify(batch);
  const req = http.request({
    hostname: url.hostname,
    port: url.port || 3000,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 5000,
  }, (res) => {
    if (res.statusCode === 200) _httpFailCount = 0;
    else _httpFailCount++;
    res.resume(); // drain
  });
  req.on('error', (err) => {
    _httpFailCount++;
    if (_httpFailCount <= 3 || _httpFailCount % 10 === 0) {
      console.warn(`[tracer] HTTP ingest failed (${_httpFailCount}): ${err.message}`);
    }
  });
  req.on('timeout', () => {
    req.destroy();
    _httpFailCount++;
    if (_httpFailCount <= 3) console.warn(`[tracer] HTTP ingest timeout (${_httpFailCount})`);
  });
  req.end(body);
}

function pushToHttpBuffer(event) {
  _httpBuffer.push(event);
  if (_httpBuffer.length >= HTTP_MAX_BUFFER) flushHttpBuffer();
  if (!_httpFlushTimer) {
    _httpFlushTimer = setInterval(flushHttpBuffer, HTTP_BATCH_INTERVAL_MS);
    // Don't keep the process alive just for trace flushing
    if (_httpFlushTimer.unref) _httpFlushTimer.unref();
  }
}

// ── Event Emission ─────────────────────────────────────

function emit(event) {
  // Always push to ring buffer (for local reads)
  pushToRing(event);

  // Apply smart sampling filter for publishing
  if (!shouldLog(event)) return;

  // Primary transport: NATS (when connected)
  if (_natsConnection && _stringCodec) {
    try {
      const subject = `openclaw.trace.${NODE_ID}.${event.module}`;
      const payload = _stringCodec.encode(JSON.stringify(event));
      _natsConnection.publish(subject, payload);
      return; // NATS succeeded — done
    } catch { // Intentional: fall through to HTTP transport
    }
  }

  // Fallback transport: HTTP POST to MC's ingest endpoint
  pushToHttpBuffer(event);
}

// ── Arg/Result Summarization ───────────────────────────

function summarizeArgs(args, maxLen = 120) {
  if (!args || args.length === 0) return '';
  try {
    const parts = args.map((a, i) => {
      if (a === null || a === undefined) return `arg${i}=null`;
      if (typeof a === 'string') return a.length > 40 ? a.slice(0, 37) + '...' : a;
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      if (typeof a === 'object') {
        // Extract ID-like fields for summary
        const id = a.task_id || a.taskId || a.session_id || a.sessionId || a.plan_id || a.planId || a.id;
        if (id) return `{id:${id}}`;
        const keys = Object.keys(a);
        return `{${keys.slice(0, 3).join(',')}}`;
      }
      return typeof a;
    });
    const result = parts.join(', ');
    return result.length > maxLen ? result.slice(0, maxLen - 3) + '...' : result;
  } catch {
    return '[summarize error]';
  }
}

function summarizeResult(result, maxLen = 80) {
  if (result === null || result === undefined) return 'null';
  if (typeof result === 'string') return result.length > maxLen ? result.slice(0, maxLen - 3) + '...' : result;
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  if (Array.isArray(result)) return `[${result.length} items]`;
  if (typeof result === 'object') {
    const id = result.task_id || result.taskId || result.session_id || result.sessionId || result.plan_id || result.id;
    const status = result.status;
    if (id && status) return `{id:${id}, status:${status}}`;
    if (id) return `{id:${id}}`;
    if (status) return `{status:${status}}`;
    return `{${Object.keys(result).slice(0, 4).join(',')}}`;
  }
  return typeof result;
}

// ── Tracer Factory ─────────────────────────────────────

function createTracer(moduleName) {
  const tracer = {
    module: moduleName,

    /**
     * Wrap a synchronous function with tracing.
     */
    wrap(fnName, fn, opts = {}) {
      const tier = opts.tier || 2;
      const category = opts.category || 'compute';
      return function tracedSync(...args) {
        const start = Date.now();
        let error = null;
        let result;
        try {
          result = fn.apply(this, args);
          return result;
        } catch (err) {
          error = err;
          throw err;
        } finally {
          emit({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            node_id: NODE_ID,
            module: moduleName,
            function: fnName,
            tier,
            category: error ? 'error' : category,
            args_summary: summarizeArgs(args),
            result_summary: error ? null : summarizeResult(result),
            duration_ms: Date.now() - start,
            error: error ? (error.message || String(error)) : null,
            meta: opts.meta || null,
          });
        }
      };
    },

    /**
     * Wrap an async function with tracing.
     */
    wrapAsync(fnName, fn, opts = {}) {
      const tier = opts.tier || 2;
      const category = opts.category || 'compute';
      return async function tracedAsync(...args) {
        const start = Date.now();
        let error = null;
        let result;
        try {
          result = await fn.apply(this, args);
          return result;
        } catch (err) {
          error = err;
          throw err;
        } finally {
          emit({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            node_id: NODE_ID,
            module: moduleName,
            function: fnName,
            tier,
            category: error ? 'error' : category,
            args_summary: summarizeArgs(args),
            result_summary: error ? null : summarizeResult(result),
            duration_ms: Date.now() - start,
            error: error ? (error.message || String(error)) : null,
            meta: opts.meta || null,
          });
        }
      };
    },

    /**
     * Bulk-wrap methods on a class instance.
     * Replaces each named method with a traced version.
     */
    wrapClass(instance, methodNames, opts = {}) {
      for (const name of methodNames) {
        if (typeof instance[name] !== 'function') continue;
        const original = instance[name].bind(instance);
        // Detect if method is async
        if (original.constructor.name === 'AsyncFunction' ||
            original.toString().includes('__awaiter') ||
            original[Symbol.toStringTag] === 'AsyncFunction') {
          instance[name] = tracer.wrapAsync(name, original, opts);
        } else {
          instance[name] = tracer.wrap(name, original, opts);
        }
      }
    },

    /**
     * Manually emit a trace event.
     */
    emit(fnName, data = {}) {
      emit({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        node_id: NODE_ID,
        module: moduleName,
        function: fnName,
        tier: data.tier || 2,
        category: data.category || 'lifecycle',
        args_summary: data.args_summary || '',
        result_summary: data.result_summary || '',
        duration_ms: data.duration_ms || 0,
        error: data.error || null,
        meta: data.meta || null,
      });
    },

    /**
     * Log a message to both console and the trace pipeline.
     * Bridges human-readable logs into the observability feed.
     *
     * @param {'info'|'warn'|'error'} level
     * @param {string} msg
     */
    log(level, msg) {
      const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      consoleFn(`[${moduleName}] ${msg}`);
      emit({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        node_id: NODE_ID,
        module: moduleName,
        function: `log.${level}`,
        tier: level === 'error' || level === 'warn' ? 1 : 2,
        category: level === 'error' || level === 'warn' ? 'error' : 'lifecycle',
        args_summary: msg.slice(0, 120),
        result_summary: level.toUpperCase(),
        duration_ms: 0,
        error: level === 'error' ? msg.slice(0, 200) : null,
        meta: null,
      });
    },
  };

  return tracer;
}

// ── Exports ────────────────────────────────────────────

module.exports = {
  createTracer,
  setTraceMode,
  getTraceMode,
  setNatsConnection,
  getRecentEvents,
  getTotalEventCount,
  NODE_ID,
};
