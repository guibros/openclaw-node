#!/usr/bin/env node

/**
 * openclaw-node CLI — entry point for `npx openclaw-node-harness`
 *
 * Spawns bin/openclaw-node-init.js directly (no shell wrapper).
 * Forwards CLI args and exit code.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Package paths ──
const PKG_ROOT = __dirname;
const INIT_SCRIPT = path.join(PKG_ROOT, 'bin', 'openclaw-node-init.js');

// ── Sanity checks ──
if (!fs.existsSync(INIT_SCRIPT)) {
  console.error('ERROR: bin/openclaw-node-init.js not found at', INIT_SCRIPT);
  console.error('Package may be corrupted. Reinstall with: npx openclaw-node-harness@latest');
  process.exit(1);
}

// ── Forward CLI args to init script ──
const userArgs = process.argv.slice(2);

const result = spawnSync(process.execPath, [INIT_SCRIPT, ...userArgs], {
  stdio: 'inherit',
  env: { ...process.env },
});

process.exit(result.status || 0);
