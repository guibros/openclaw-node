#!/usr/bin/env node

/**
 * openclaw-node CLI — entry point for `npx openclaw-node-harness`
 *
 * Flow:
 *   1. Resolve install.sh relative to this package
 *   2. Spawn install.sh with forwarded CLI args
 *   3. Forward exit code
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Package paths ──
const PKG_ROOT = __dirname;
const INSTALL_SCRIPT = path.join(PKG_ROOT, 'install.sh');

// ── Sanity checks ──
if (!fs.existsSync(INSTALL_SCRIPT)) {
  console.error('ERROR: install.sh not found at', INSTALL_SCRIPT);
  console.error('Package may be corrupted. Reinstall with: npx openclaw-node-harness');
  process.exit(1);
}

// ── Forward CLI args to install.sh ──
const userArgs = process.argv.slice(2);

const result = spawnSync('bash', [INSTALL_SCRIPT, ...userArgs], {
  stdio: 'inherit',
  env: { ...process.env },
});

process.exit(result.status || 0);
