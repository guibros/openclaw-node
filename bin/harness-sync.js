#!/usr/bin/env node
/**
 * harness-sync.js — Smart merge for harness-rules.json
 *
 * Compares source (config/harness-rules.json) against deployed
 * (~/.openclaw/harness-rules.json) by rule id, merges structurally.
 *
 * Usage:
 *   harness-sync status              Show diff report (default)
 *   harness-sync apply               Merge source into deployed
 *   harness-sync apply --dry-run     Show what would change without writing
 *   harness-sync apply --force       Overwrite user edits with source values
 *
 * Options:
 *   --src <path>    Override source path
 *   --dst <path>    Override deployed path
 */

const fs = require('fs');
const path = require('path');

// ── Paths ────────────────────────────────────────────

const REPO_DIR = path.resolve(__dirname, '..');
const DEFAULT_SRC = path.join(REPO_DIR, 'config', 'harness-rules.json');
const DEFAULT_DST = path.join(process.env.HOME || '', '.openclaw', 'harness-rules.json');

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = (args[0] && !args[0].startsWith('-')) ? args[0] : 'status';
  const flags = {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    src: flagVal(args, '--src') || DEFAULT_SRC,
    dst: flagVal(args, '--dst') || DEFAULT_DST,
  };
  return { cmd, ...flags };
}

function flagVal(args, flag) {
  const idx = args.indexOf(flag);
  return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : null;
}

// ── Field ownership ──────────────────────────────────

// Source-owned: infrastructure fields that should always sync from source
const SOURCE_OWNED = new Set([
  'scope', 'mesh_enforcement', 'mesh_scan_patterns', 'mesh_pre_checks',
  'mesh_validate_command', '_mesh_note',
]);

// User-owned: fields that should not be overwritten if user modified them
const USER_OWNED = new Set([
  'content', 'active', 'activateOn', 'tags', 'description',
]);

// Fields to skip in diff display (noise)
const SKIP_DIFF = new Set(['_note', '_mesh_note']);

// ── Core logic ───────────────────────────────────────

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function indexById(rules) {
  const map = new Map();
  for (const r of rules) {
    if (r.id) map.set(r.id, r);
  }
  return map;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Diff two rule sets. Returns a structured report.
 */
function diffRules(srcRules, dstRules) {
  const srcMap = indexById(srcRules);
  const dstMap = indexById(dstRules);
  const report = { newRules: [], fieldUpdates: [], userEdits: [], userOnly: [] };

  // Rules in source not in deployed
  for (const [id, srcRule] of srcMap) {
    if (!dstMap.has(id)) {
      report.newRules.push(srcRule);
      continue;
    }

    const dstRule = dstMap.get(id);
    const updates = [];
    const edits = [];

    // Check all source fields
    for (const key of Object.keys(srcRule)) {
      if (key === 'id') continue;
      if (SKIP_DIFF.has(key)) continue;

      const srcVal = srcRule[key];
      const dstVal = dstRule[key];

      if (deepEqual(srcVal, dstVal)) continue;

      if (SOURCE_OWNED.has(key)) {
        // Source-owned field differs or missing in deployed
        updates.push({ key, src: srcVal, dst: dstVal });
      } else if (USER_OWNED.has(key)) {
        if (dstVal !== undefined && !deepEqual(srcVal, dstVal)) {
          edits.push({ key, src: srcVal, dst: dstVal });
        } else if (dstVal === undefined) {
          updates.push({ key, src: srcVal, dst: undefined });
        }
      }
    }

    // Check fields in source but not in deployed (new infra fields)
    for (const key of Object.keys(srcRule)) {
      if (key === 'id' || SKIP_DIFF.has(key)) continue;
      if (!(key in dstRule) && !updates.some(u => u.key === key) && !edits.some(e => e.key === key)) {
        updates.push({ key, src: srcRule[key], dst: undefined });
      }
    }

    if (updates.length > 0) report.fieldUpdates.push({ id, updates });
    if (edits.length > 0) report.userEdits.push({ id, edits });
  }

  // Rules in deployed not in source (user additions)
  for (const [id, dstRule] of dstMap) {
    if (!srcMap.has(id)) {
      report.userOnly.push(dstRule);
    }
  }

  return report;
}

/**
 * Merge source into deployed, respecting field ownership.
 */
function mergeRules(srcRules, dstRules, force) {
  const srcMap = indexById(srcRules);
  const dstMap = indexById(dstRules);
  const merged = [];

  // Process existing deployed rules (preserve order)
  for (const dstRule of dstRules) {
    if (!dstRule.id || !srcMap.has(dstRule.id)) {
      merged.push({ ...dstRule });
      continue;
    }

    const srcRule = srcMap.get(dstRule.id);
    const result = { ...dstRule };

    for (const [key, val] of Object.entries(srcRule)) {
      if (key === 'id') continue;

      if (SOURCE_OWNED.has(key)) {
        // Always sync from source
        result[key] = val;
      } else if (USER_OWNED.has(key)) {
        if (force) {
          result[key] = val;
        } else if (!(key in dstRule)) {
          // New field, safe to add
          result[key] = val;
        }
        // else: user-owned, keep deployed value
      } else if (!(key in dstRule)) {
        // Unknown new field from source, add it
        result[key] = val;
      }
    }

    merged.push(result);
  }

  // Append new rules from source (not in deployed)
  for (const srcRule of srcRules) {
    if (!dstMap.has(srcRule.id)) {
      merged.push({ ...srcRule });
    }
  }

  return merged;
}

// ── Display ──────────────────────────────────────────

function fmt(val) {
  if (val === undefined) return '(missing)';
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === 'string' && val.length > 60) return val.slice(0, 57) + '...';
  return String(val);
}

function printReport(report) {
  const clean = report.newRules.length === 0 &&
    report.fieldUpdates.length === 0 &&
    report.userEdits.length === 0 &&
    report.userOnly.length === 0;

  if (clean) {
    console.log('harness-rules: in sync.');
    return;
  }

  if (report.newRules.length > 0) {
    console.log(`\n  NEW RULES (${report.newRules.length}):`);
    for (const r of report.newRules) {
      console.log(`    + ${r.id}  — ${r.description}`);
    }
  }

  if (report.fieldUpdates.length > 0) {
    console.log(`\n  FIELD UPDATES (${report.fieldUpdates.length} rules):`);
    for (const { id, updates } of report.fieldUpdates) {
      console.log(`    ~ ${id}`);
      for (const { key, src, dst } of updates) {
        console.log(`        ${key}: ${fmt(dst)} → ${fmt(src)}`);
      }
    }
  }

  if (report.userEdits.length > 0) {
    console.log(`\n  USER EDITS (preserved, ${report.userEdits.length} rules):`);
    for (const { id, edits } of report.userEdits) {
      console.log(`    ! ${id}`);
      for (const { key, src, dst } of edits) {
        console.log(`        ${key}: yours=${fmt(dst)}  upstream=${fmt(src)}`);
      }
    }
  }

  if (report.userOnly.length > 0) {
    console.log(`\n  USER-ONLY RULES (${report.userOnly.length}):`);
    for (const r of report.userOnly) {
      console.log(`    * ${r.id}  — ${r.description || '(no description)'}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);

  if (!fs.existsSync(opts.src)) {
    console.error(`error: source not found: ${opts.src}`);
    process.exit(1);
  }

  const srcRules = loadJson(opts.src);

  // First deploy — just copy
  if (!fs.existsSync(opts.dst)) {
    if (opts.cmd === 'status') {
      console.log(`No deployed rules at ${opts.dst} — run 'apply' to deploy.`);
      console.log(`Source has ${srcRules.length} rules.`);
      return;
    }
    if (opts.dryRun) {
      console.log(`[dry-run] Would copy ${srcRules.length} rules to ${opts.dst}`);
      return;
    }
    fs.mkdirSync(path.dirname(opts.dst), { recursive: true });
    fs.copyFileSync(opts.src, opts.dst);
    console.log(`Deployed ${srcRules.length} rules to ${opts.dst}`);
    return;
  }

  const dstRules = loadJson(opts.dst);
  const report = diffRules(srcRules, dstRules);

  if (opts.cmd === 'status') {
    console.log(`source: ${opts.src} (${srcRules.length} rules)`);
    console.log(`deploy: ${opts.dst} (${dstRules.length} rules)`);
    printReport(report);
    return;
  }

  if (opts.cmd === 'apply') {
    const clean = report.newRules.length === 0 &&
      report.fieldUpdates.length === 0;

    if (clean && !opts.force) {
      console.log('harness-rules: already in sync (nothing to apply).');
      return;
    }

    const merged = mergeRules(srcRules, dstRules, opts.force);

    if (opts.dryRun) {
      console.log('[dry-run] Would produce:');
      printReport(report);
      console.log(`\n  Result: ${merged.length} rules (was ${dstRules.length})`);
      return;
    }

    // Backup
    const bakPath = opts.dst + '.bak';
    fs.copyFileSync(opts.dst, bakPath);

    // Write merged
    fs.writeFileSync(opts.dst, JSON.stringify(merged, null, 2) + '\n');

    console.log(`Backup: ${bakPath}`);
    printReport(report);
    console.log(`\nApplied: ${opts.dst} now has ${merged.length} rules (was ${dstRules.length}).`);
    return;
  }

  console.error(`Unknown command: ${opts.cmd}`);
  console.error('Usage: harness-sync [status|apply] [--dry-run] [--force]');
  process.exit(1);
}

main();
