/**
 * logger.js — Shared structured logger for OpenClaw daemons.
 *
 * Replaces per-daemon `function log(msg)` definitions with a unified factory.
 * Output format matches the established pattern: [ISO] [module:NODE_ID] msg
 *
 * When a tracer is attached via `attachTracer(tracer)`, all log calls also emit
 * structured trace events into the observability pipeline (ring buffer → NATS →
 * SSE → UI). This bridges human-readable console output with the trace feed.
 *
 * Usage:
 *   const { info: log, warn, error, debug, attachTracer } = require('../lib/logger').createLogger('mesh-bridge');
 *   log('Connected to NATS');         // console + tracer
 *   warn('Task stale');               // console + tracer (category: 'error')
 *   error('Fatal: ...');              // console + tracer (category: 'error')
 *   debug('CAS attempt 2');           // only when OPENCLAW_LOG_LEVEL=debug
 *
 *   // Attach tracer for observability feed integration
 *   const tracer = createTracer('mesh-bridge');
 *   attachTracer(tracer);
 */

'use strict';

const os = require('os');

const NODE_ID = (process.env.OPENCLAW_NODE_ID || process.env.MESH_NODE_ID || os.hostname())
  .toLowerCase().replace(/[^a-z0-9-]/g, '-');

const LOG_LEVEL = (process.env.OPENCLAW_LOG_LEVEL || 'info').toLowerCase();
const DEBUG_ENABLED = LOG_LEVEL === 'debug';

function createLogger(module) {
  const prefix = `[${module}:${NODE_ID}]`;
  let _tracer = null;

  function emitTrace(level, msg) {
    if (!_tracer) return;
    try {
      _tracer.emit(`log.${level}`, {
        tier: level === 'error' ? 1 : level === 'warn' ? 1 : 2,
        category: level === 'error' || level === 'warn' ? 'error' : 'lifecycle',
        args_summary: msg.slice(0, 120),
        result_summary: level.toUpperCase(),
      });
    } catch {
      // Don't let tracer failures break logging
    }
  }

  function info(msg) {
    console.log(`[${new Date().toISOString()}] ${prefix} ${msg}`);
    emitTrace('info', msg);
  }

  function warn(msg) {
    console.warn(`[${new Date().toISOString()}] ${prefix} WARN ${msg}`);
    emitTrace('warn', msg);
  }

  function error(msg) {
    console.error(`[${new Date().toISOString()}] ${prefix} ERROR ${msg}`);
    emitTrace('error', msg);
  }

  function debug(msg) {
    if (DEBUG_ENABLED) {
      console.log(`[${new Date().toISOString()}] ${prefix} DEBUG ${msg}`);
      emitTrace('debug', msg);
    }
  }

  function attachTracer(tracer) {
    _tracer = tracer;
  }

  return { info, warn, error, debug, attachTracer };
}

module.exports = { createLogger, NODE_ID };
