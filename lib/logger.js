/**
 * logger.js — Shared structured logger for OpenClaw daemons.
 *
 * Replaces per-daemon `function log(msg)` definitions with a unified factory.
 * Output format matches the established pattern: [ISO] [module:NODE_ID] msg
 *
 * Usage:
 *   const { info: log, warn, error, debug } = require('../lib/logger').createLogger('mesh-bridge');
 *   log('Connected to NATS');         // [2026-04-03T...] [mesh-bridge:node-1] Connected to NATS
 *   warn('Task stale');               // [2026-04-03T...] [mesh-bridge:node-1] WARN Task stale
 *   error('Fatal: ...);               // [2026-04-03T...] [mesh-bridge:node-1] ERROR Fatal: ...
 *   debug('CAS attempt 2');           // only when OPENCLAW_LOG_LEVEL=debug
 */

'use strict';

const os = require('os');

const NODE_ID = (process.env.OPENCLAW_NODE_ID || process.env.MESH_NODE_ID || os.hostname())
  .toLowerCase().replace(/[^a-z0-9-]/g, '-');

const LOG_LEVEL = (process.env.OPENCLAW_LOG_LEVEL || 'info').toLowerCase();
const DEBUG_ENABLED = LOG_LEVEL === 'debug';

function createLogger(module) {
  const prefix = `[${module}:${NODE_ID}]`;

  function info(msg) {
    console.log(`[${new Date().toISOString()}] ${prefix} ${msg}`);
  }

  function warn(msg) {
    console.warn(`[${new Date().toISOString()}] ${prefix} WARN ${msg}`);
  }

  function error(msg) {
    console.error(`[${new Date().toISOString()}] ${prefix} ERROR ${msg}`);
  }

  function debug(msg) {
    if (DEBUG_ENABLED) {
      console.log(`[${new Date().toISOString()}] ${prefix} DEBUG ${msg}`);
    }
  }

  return { info, warn, error, debug };
}

module.exports = { createLogger, NODE_ID };
