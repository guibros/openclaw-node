#!/usr/bin/env node
/**
 * spawn-node.mjs — create an isolated openclaw node tree at ~/.openclaw-<nodeid>/.
 *
 * Each spawned node gets its own state.db, config, workspace, obsidian vault,
 * artifacts store, and logs directory. This enables running N independent
 * openclaw instances on one dev machine without containers.
 *
 * Usage:
 *   node bin/spawn-node.mjs --id alpha
 *   node bin/spawn-node.mjs --id alpha --port 7900 --nats-url nats://localhost:4222
 *   node bin/spawn-node.mjs --id alpha --base-dir /tmp/openclaw-nodes
 *
 * Environment:
 *   OPENCLAW_SPAWN_BASE   — override base directory (default: ~/.openclaw-)
 *
 * @module bin/spawn-node
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default NATS port used when --port not specified. */
export const DEFAULT_PORT = 7900;

/** Default NATS server URL. */
export const DEFAULT_NATS_URL = 'nats://localhost:4222';

/** Subdirectories created inside each node root. */
export const NODE_SUBDIRS = [
  'workspace',
  'workspace/memory',
  'config',
  'obsidian-local',
  'obsidian-local/concepts',
  'obsidian-local/decisions',
  'obsidian-local/sessions',
  'obsidian-local/themes',
  'obsidian-local/daily',
  'artifacts',
  'logs',
  'state',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if a path exists and is a directory.
 * @param {string} p
 * @returns {Promise<boolean>}
 */
async function dirExists(p) {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists.
 * @param {string} p
 * @returns {Promise<boolean>}
 */
async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a node ID string.
 * Must be 1-32 lowercase alphanumeric + hyphens, no leading/trailing hyphen.
 *
 * @param {string} id
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateNodeId(id) {
  if (!id || typeof id !== 'string') {
    return { valid: false, reason: 'Node ID is required' };
  }
  if (id.length > 32) {
    return { valid: false, reason: 'Node ID must be 32 characters or fewer' };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id) && !/^[a-z0-9]$/.test(id)) {
    return {
      valid: false,
      reason: 'Node ID must be lowercase alphanumeric + hyphens, no leading/trailing hyphen',
    };
  }
  return { valid: true };
}

/**
 * Resolve the node root path.
 *
 * @param {string} nodeId
 * @param {{ baseDir?: string }} [opts]
 * @returns {string}
 */
export function resolveNodeRoot(nodeId, opts = {}) {
  const base = opts.baseDir
    || process.env.OPENCLAW_SPAWN_BASE
    || join(homedir(), '.openclaw-');
  // If base ends with '-' (the default prefix pattern), append nodeId directly
  // Otherwise treat it as a parent directory
  if (base.endsWith('-')) {
    return `${base}${nodeId}`;
  }
  return join(base, nodeId);
}

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * Create an isolated openclaw node tree. Idempotent — existing directories
 * and config files are preserved (never overwritten).
 *
 * @param {{ id: string, port?: number, natsUrl?: string, baseDir?: string }} opts
 * @returns {Promise<{ nodeRoot: string, created: string[], configPath: string, dbPath: string, alreadyExisted: boolean }>}
 */
export async function spawnNode(opts) {
  const { id, port = DEFAULT_PORT, natsUrl = DEFAULT_NATS_URL, baseDir } = opts;

  const validation = validateNodeId(id);
  if (!validation.valid) {
    throw new Error(`Invalid node ID "${id}": ${validation.reason}`);
  }

  const nodeRoot = resolveNodeRoot(id, { baseDir });
  const alreadyExisted = await dirExists(nodeRoot);
  const created = [];

  // Create all subdirectories
  for (const subdir of NODE_SUBDIRS) {
    const dirPath = join(nodeRoot, subdir);
    const existed = await dirExists(dirPath);
    await mkdir(dirPath, { recursive: true });
    if (!existed) {
      created.push(subdir);
    }
  }

  // Write config/node.json (only if it doesn't exist — never overwrite)
  const configPath = join(nodeRoot, 'config', 'node.json');
  if (!(await fileExists(configPath))) {
    const config = {
      id,
      port,
      nats_url: natsUrl,
      created_at: new Date().toISOString(),
      openclaw_home: nodeRoot,
    };
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    created.push('config/node.json');
  }

  // Initialize state.db (only if it doesn't exist)
  const dbPath = join(nodeRoot, 'state.db');
  if (!(await fileExists(dbPath))) {
    try {
      const { openStore } = await import('../lib/sqlite-store.mjs');
      const db = openStore(dbPath);
      db.close();
      created.push('state.db');
    } catch (err) {
      // better-sqlite3 unavailable — create an empty placeholder
      await writeFile(dbPath, '', 'utf8');
      created.push('state.db (placeholder)');
    }
  }

  return { nodeRoot, created, configPath, dbPath, alreadyExisted };
}

/**
 * Read a spawned node's config.
 *
 * @param {string} nodeId
 * @param {{ baseDir?: string }} [opts]
 * @returns {Promise<object|null>}
 */
export async function readNodeConfig(nodeId, opts = {}) {
  const nodeRoot = resolveNodeRoot(nodeId, opts);
  const configPath = join(nodeRoot, 'config', 'node.json');
  try {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      port: { type: 'string' },
      'nats-url': { type: 'string' },
      'base-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: node bin/spawn-node.mjs --id <nodeid> [--port <port>] [--nats-url <url>] [--base-dir <dir>]

Options:
  --id        Node identifier (required, lowercase alphanumeric + hyphens)
  --port      Base port number (default: ${DEFAULT_PORT})
  --nats-url  NATS server URL (default: ${DEFAULT_NATS_URL})
  --base-dir  Override base directory (default: ~/.openclaw-)
  -h, --help  Show this help`);
    process.exit(0);
  }

  if (!values.id) {
    console.error('error: --id is required');
    process.exit(1);
  }

  try {
    const result = await spawnNode({
      id: values.id,
      port: values.port ? parseInt(values.port, 10) : undefined,
      natsUrl: values['nats-url'],
      baseDir: values['base-dir'],
    });

    if (result.alreadyExisted && result.created.length === 0) {
      console.log(`Node "${values.id}" already exists at ${result.nodeRoot} (no changes)`);
    } else if (result.alreadyExisted) {
      console.log(`Node "${values.id}" updated at ${result.nodeRoot}`);
      console.log(`  Created: ${result.created.join(', ')}`);
    } else {
      console.log(`Node "${values.id}" spawned at ${result.nodeRoot}`);
      console.log(`  Config: ${result.configPath}`);
      console.log(`  DB:     ${result.dbPath}`);
      console.log(`  Created: ${result.created.join(', ')}`);
    }

    console.log(`\nTo run this node:`);
    console.log(`  OPENCLAW_HOME=${result.nodeRoot} OPENCLAW_NODE_ID=${values.id} node workspace-bin/memory-daemon.mjs`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

// Run CLI if invoked directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('/spawn-node.mjs')
  || process.argv[1].endsWith('\\spawn-node.mjs')
);
if (isMain) {
  main();
}
