#!/usr/bin/env node

/**
 * openclaw-node CLI — entry point for `npx openclaw-node-harness`
 *
 * Routes to the appropriate installer:
 *   npx openclaw-node-harness              → full install (install.sh)
 *   npx openclaw-node-harness --update     → update existing install (install.sh --update)
 *   npx openclaw-node-harness --mesh-only  → mesh join only (openclaw-node-init.js)
 *
 * The full install deploys everything: identity, skills, souls, MC, services, rules.
 * --mesh-only is for worker nodes that just need the agent + NATS connection.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PKG_ROOT = __dirname;
const INSTALL_SCRIPT = path.join(PKG_ROOT, 'install.sh');
const MESH_INIT_SCRIPT = path.join(PKG_ROOT, 'bin', 'openclaw-node-init.js');

const args = process.argv.slice(2);
const meshOnly = args.includes('--mesh-only');

if (meshOnly) {
  // Mesh-only join — lightweight, no full install
  if (!fs.existsSync(MESH_INIT_SCRIPT)) {
    console.error('ERROR: bin/openclaw-node-init.js not found at', MESH_INIT_SCRIPT);
    process.exit(1);
  }
  const filteredArgs = args.filter(a => a !== '--mesh-only');
  const result = spawnSync(process.execPath, [MESH_INIT_SCRIPT, ...filteredArgs], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  process.exit(result.status || 0);
} else {
  // Full install or update — runs install.sh
  if (!fs.existsSync(INSTALL_SCRIPT)) {
    console.error('ERROR: install.sh not found at', INSTALL_SCRIPT);
    console.error('Package may be corrupted. Reinstall with: npx openclaw-node-harness@latest');
    process.exit(1);
  }

  // Forward args (--update, --dry-run, --enable-services, etc.)
  const result = spawnSync('bash', [INSTALL_SCRIPT, ...args], {
    stdio: 'inherit',
    cwd: PKG_ROOT,
    env: { ...process.env, REPO_DIR: PKG_ROOT },
  });
  process.exit(result.status || 0);
}
