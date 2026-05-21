#!/usr/bin/env node
/**
 * migrate-companion-state.mjs — One-time migration for daemon state file rename.
 *
 * Detects old `.companion-state.md` written by the daemon (identified by
 * `## Session Status` / `last_flush` markers) and renames it to
 * `.daemon-state-${NODE_ID}.md` if the target doesn't already exist.
 *
 * Idempotent — safe to run multiple times:
 *   - If the target already exists, no-op.
 *   - If the source doesn't exist, no-op.
 *   - If the source exists but has no daemon markers, no-op (it's companion-bridge's file).
 *
 * Usage:
 *   node scripts/migrate-companion-state.mjs [--dry-run] [--verbose]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const WORKSPACE = process.env.OPENCLAW_WORKSPACE
  || path.join(os.homedir(), '.openclaw', 'workspace');
const NODE_ID = process.env.OPENCLAW_NODE_ID || os.hostname();

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

const oldPath = path.join(WORKSPACE, '.companion-state.md');
const newPath = path.join(WORKSPACE, `.daemon-state-${NODE_ID}.md`);

function log(msg) { if (VERBOSE) console.log(`[migrate] ${msg}`); }

function isDaemonFile(content) {
  // Daemon writes `## Session Status` and `last_flush` — companion-bridge does not.
  return /## Session Status/i.test(content) || /last_flush/i.test(content);
}

function run() {
  // 1. Target already exists → nothing to do.
  if (fs.existsSync(newPath)) {
    log(`Target already exists: ${newPath} — skipping.`);
    console.log('migrate: no-op (target exists)');
    return;
  }

  // 2. Source doesn't exist → nothing to do.
  if (!fs.existsSync(oldPath)) {
    log(`Source not found: ${oldPath} — skipping.`);
    console.log('migrate: no-op (source missing)');
    return;
  }

  // 3. Read source and check markers.
  const content = fs.readFileSync(oldPath, 'utf-8');
  if (!isDaemonFile(content)) {
    log(`Source exists but lacks daemon markers — belongs to companion-bridge. Skipping.`);
    console.log('migrate: no-op (not a daemon file)');
    return;
  }

  // 4. Rename.
  if (DRY_RUN) {
    console.log(`migrate: would rename ${oldPath} → ${newPath}`);
    return;
  }

  fs.renameSync(oldPath, newPath);
  console.log(`migrate: renamed ${oldPath} → ${newPath}`);
}

run();
