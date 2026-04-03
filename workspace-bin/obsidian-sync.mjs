#!/usr/bin/env node
/**
 * obsidian-sync.mjs — Push workspace artifacts to Obsidian vault
 *
 * Routes files by type: node-private (memory, state, lessons) go to
 * nodes/{nodeId}/, shared knowledge (lore, contracts, architecture) goes
 * to the appropriate domain folder.
 *
 * Usage:
 *   node bin/obsidian-sync.mjs [--dry-run] [--verbose] [--force]
 *
 * Called by memory-daemon Phase 2 (throttled, every 30 min).
 */

import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import os from 'os';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('obsidian-sync');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(__dirname);
const CONFIG_PATH = path.join(os.homedir(), '.openclaw/config/obsidian-sync.json');
const SYNC_STATE_PATH = path.join(WORKSPACE, '.tmp/obsidian-sync-state.json');

// ============================================================
// CONFIG
// ============================================================

function loadConfig() {
  const defaults = {
    enabled: true,
    vaultPath: 'projects/arcane-vault',
    apiPort: 27124,
    apiKeyFile: 'projects/arcane-vault/.obsidian-api-key',
    nodeId: 'daedalus',
    syncDirection: 'push',
    nodePrivateRoutes: [],
    sharedRoutes: [],
    excludePatterns: [],
    frontmatterDefaults: { status: 'draft', tags: ['auto-synced'] },
  };

  if (!fs.existsSync(CONFIG_PATH)) return defaults;

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return { ...defaults, ...raw };
  } catch {
    return defaults;
  }
}

// ============================================================
// GLOB MATCHING — minimal, zero dependencies
// ============================================================

/**
 * Convert a glob pattern to a regex.
 * Supports: *, **, ?, {a,b}
 */
function globToRegex(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any path segment(s)
        if (pattern[i + 2] === '/') {
          re += '(?:.+/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) {
        const alts = pattern.slice(i + 1, close).split(',');
        re += '(' + alts.map(a => escapeRegex(a)).join('|') + ')';
        i = close + 1;
      } else {
        re += '\\{';
        i++;
      }
    } else if ('.+^$|()[]\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesGlob(filePath, pattern) {
  return globToRegex(pattern).test(filePath);
}

function matchesAnyGlob(filePath, patterns) {
  return patterns.some(p => matchesGlob(filePath, p));
}

// ============================================================
// SYNC STATE — hash-based change detection
// ============================================================

function loadSyncState() {
  if (!fs.existsSync(SYNC_STATE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSyncState(state) {
  fs.mkdirSync(path.dirname(SYNC_STATE_PATH), { recursive: true });
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ============================================================
// FRONTMATTER — YAML-lite parser/injector
// ============================================================

const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse YAML frontmatter (simple key: value, arrays, strings).
 * Not a full YAML parser — handles the subset Obsidian actually uses.
 */
function parseFrontmatter(content) {
  const match = content.match(FM_REGEX);
  if (!match) return { meta: {}, body: content };

  const yaml = match[1];
  const body = content.slice(match[0].length);
  const meta = {};

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // Inline array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    } else if (value.startsWith('"') && value.endsWith('"')) {
      meta[key] = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      meta[key] = value.slice(1, -1);
    } else if (value === 'true') {
      meta[key] = true;
    } else if (value === 'false') {
      meta[key] = false;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      meta[key] = value; // keep dates as strings
    } else if (value === '') {
      meta[key] = '';
    } else {
      meta[key] = value;
    }
  }

  return { meta, body };
}

/**
 * Serialize frontmatter back to YAML string.
 */
function serializeFrontmatter(meta) {
  const lines = [];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string' && value.includes(':')) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

/**
 * Inject/merge frontmatter into file content.
 * Preserves existing fields, adds missing defaults.
 */
function injectFrontmatter(content, injected) {
  const { meta: existing, body } = parseFrontmatter(content);

  // Merge: existing wins for fields already set, injected fills gaps
  const merged = { ...injected, ...existing };

  // Always update 'updated' timestamp
  merged.updated = new Date().toISOString().split('T')[0];

  // Set created if missing
  if (!merged.created) {
    merged.created = merged.updated;
  }

  return `---\n${serializeFrontmatter(merged)}\n---\n${body}`;
}

// ============================================================
// FILE ROUTING — classify workspace files → vault destinations
// ============================================================

/**
 * Convert SCREAMING_SNAKE or PascalCase filename to kebab-case.
 * ARCHITECTURE → architecture, BiomeOracle → biome-oracle,
 * TECH_ARCHITECTURE → tech-architecture, ManaWell → mana-well
 */
function toKebabCase(filename) {
  const ext = path.extname(filename);
  let base = filename.replace(/\.[^.]+$/, ''); // strip extension

  // Handle dotfiles (keep leading dot)
  const leadingDot = base.startsWith('.') ? '.' : '';
  if (leadingDot) base = base.slice(1);

  return leadingDot + base
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')     // camelCase/PascalCase boundaries
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')   // ERC4337Account → ERC4337-Account
    .replace(/_/g, '-')                            // underscores → hyphens
    .replace(/--+/g, '-')                          // collapse doubles
    .replace(/^-/, '')                             // no leading hyphen
    .toLowerCase()
    + ext;
}

/**
 * Route a workspace-relative file path to its vault destination.
 * Returns { dest, domain, type: 'private'|'shared' } or null if excluded.
 */
function routeFile(relPath, config) {
  // Check excludes
  if (matchesAnyGlob(relPath, config.excludePatterns)) return null;

  // Check node-private routes first (more specific)
  for (const route of config.nodePrivateRoutes) {
    if (matchesGlob(relPath, route.pattern)) {
      const destDir = route.dest.replace('{nodeId}', config.nodeId);
      const filename = toKebabCase(path.basename(relPath));
      return {
        dest: path.join(destDir, filename),
        domain: null,
        type: 'private',
      };
    }
  }

  // Check shared routes
  for (const route of config.sharedRoutes) {
    if (matchesGlob(relPath, route.pattern)) {
      const domainDir = route.domain;
      const subfolder = route.subfolder || '';
      const filename = toKebabCase(path.basename(relPath));
      return {
        dest: path.join(domainDir, subfolder, filename),
        domain: domainDir.replace(/^\d+-/, ''), // strip number prefix for frontmatter
        type: 'shared',
      };
    }
  }

  return null; // no route matched — skip
}

// ============================================================
// FILE DISCOVERY — walk workspace for syncable files
// ============================================================

function walkDir(dir, base, results = []) {
  if (!fs.existsSync(dir)) return results;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);

    if (entry.isDirectory()) {
      // Skip common junk directories
      if (['node_modules', '.git', '.next', '.npm-cache', '.tmp'].includes(entry.name)) continue;
      walkDir(fullPath, base, results);
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Discover all workspace files that match any route.
 */
function discoverFiles(config) {
  const allPatterns = [
    ...config.nodePrivateRoutes.map(r => r.pattern),
    ...config.sharedRoutes.map(r => r.pattern),
  ];

  // Extract top-level directories to scan from patterns
  const dirsToScan = new Set();
  for (const pattern of allPatterns) {
    const firstSeg = pattern.split('/')[0];
    if (firstSeg.startsWith('.')) {
      // Dotfiles at workspace root
      const fullPath = path.join(WORKSPACE, firstSeg);
      if (fs.existsSync(fullPath)) {
        if (fs.statSync(fullPath).isDirectory()) {
          dirsToScan.add(firstSeg);
        } else {
          // Single dotfile
          dirsToScan.add('.');
        }
      }
    } else {
      dirsToScan.add(firstSeg);
    }
  }

  // Also add 'memory' which is at workspace root
  dirsToScan.add('memory');
  dirsToScan.add('.learnings');
  dirsToScan.add('.'); // for root-level files like ARCHITECTURE.md, .companion-state.md

  const allFiles = [];
  for (const dir of dirsToScan) {
    if (dir === '.') {
      // Only root-level files, not recursive
      try {
        const entries = fs.readdirSync(WORKSPACE, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile()) allFiles.push(e.name);
        }
      } catch { /* skip */ }
    } else {
      walkDir(path.join(WORKSPACE, dir), WORKSPACE, allFiles);
    }
  }

  return [...new Set(allFiles)];
}

// ============================================================
// OBSIDIAN API CLIENT — REST API with file fallback
// ============================================================

/**
 * Load API key from file.
 */
function loadApiKey(config) {
  const keyPath = path.join(WORKSPACE, config.apiKeyFile);
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf-8').trim();
  }
  return process.env.OBSIDIAN_API_KEY || '';
}

/**
 * PUT file content to Obsidian REST API.
 * Returns true on success, false on failure.
 */
function apiPut(notePath, content, apiKey, port) {
  return new Promise(resolve => {
    const encodedPath = notePath.split('/').map(encodeURIComponent).join('/');
    const options = {
      hostname: '127.0.0.1',
      port,
      path: `/vault/${encodedPath}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'text/markdown',
        'Content-Length': Buffer.byteLength(content, 'utf-8'),
      },
      rejectUnauthorized: false, // self-signed cert
      timeout: 5000,
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(res.statusCode < 300));
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(content);
    req.end();
  });
}

/**
 * Check if Obsidian API is reachable.
 */
function apiHealthCheck(apiKey, port) {
  return new Promise(resolve => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      rejectUnauthorized: false,
      timeout: 3000,
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(res.statusCode < 300));
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Write file directly to vault directory (fallback when API unreachable).
 */
function directWrite(vaultRoot, notePath, content) {
  const fullPath = path.join(vaultRoot, notePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return true;
}

// ============================================================
// NODE DIRECTORY SCAFFOLDING
// ============================================================

function ensureNodeDirs(vaultRoot, nodeId) {
  const nodeBase = path.join(vaultRoot, 'nodes', nodeId);
  const subdirs = [
    'daily', 'recaps', 'lessons', 'state', 'trust', 'archive',
    'handoffs', 'observations', 'reflections', 'preferences', 'decisions', 'patterns',
  ];

  for (const sub of subdirs) {
    const dir = path.join(nodeBase, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create _index.md if missing
    const indexPath = path.join(dir, '_index.md');
    if (!fs.existsSync(indexPath)) {
      const domain = 'meta';
      const content = `---
title: "${nodeId} — ${sub}"
domain: ${domain}
type: index
status: living
created: ${new Date().toISOString().split('T')[0]}
updated: ${new Date().toISOString().split('T')[0]}
source_node: ${nodeId}
tags: [auto-synced, node-private]
---

# ${nodeId} / ${sub}

> Auto-generated index for node-private ${sub} data.

\`\`\`dataview
LIST FROM "${path.posix.join('nodes', nodeId, sub)}"
WHERE file.name != "_index"
SORT file.mtime DESC
\`\`\`
`;
      fs.writeFileSync(indexPath, content, 'utf-8');
    }
  }

  // Node root _index.md
  const rootIndex = path.join(nodeBase, '_index.md');
  if (!fs.existsSync(rootIndex)) {
    const content = `---
title: "Node: ${nodeId}"
domain: meta
type: index
status: living
created: ${new Date().toISOString().split('T')[0]}
updated: ${new Date().toISOString().split('T')[0]}
source_node: ${nodeId}
tags: [auto-synced, node-private]
---

# Node: ${nodeId}

> Private workspace data for the ${nodeId} agent node.

## Sections

- [[${path.posix.join('nodes', nodeId, 'daily', '_index')}|Daily Memory]]
- [[${path.posix.join('nodes', nodeId, 'recaps', '_index')}|Session Recaps]]
- [[${path.posix.join('nodes', nodeId, 'lessons', '_index')}|Lessons & Errors]]
- [[${path.posix.join('nodes', nodeId, 'state', '_index')}|Companion State]]
- [[${path.posix.join('nodes', nodeId, 'trust', '_index')}|Trust Registry]]
- [[${path.posix.join('nodes', nodeId, 'archive', '_index')}|Archive]]
`;
    fs.writeFileSync(rootIndex, content, 'utf-8');
  }

  // Ensure nodes/ _index exists too
  const nodesIndex = path.join(vaultRoot, 'nodes', '_index.md');
  if (!fs.existsSync(nodesIndex)) {
    fs.mkdirSync(path.join(vaultRoot, 'nodes'), { recursive: true });
    const content = `---
title: "Agent Nodes"
domain: meta
type: index
status: living
created: ${new Date().toISOString().split('T')[0]}
updated: ${new Date().toISOString().split('T')[0]}
tags: [auto-synced, infrastructure]
---

# Agent Nodes

> Per-node private data. Each agent has its own namespace.

\`\`\`dataview
LIST FROM "nodes"
WHERE file.name = "_index" AND file.folder != "nodes"
SORT file.name ASC
\`\`\`
`;
    fs.writeFileSync(nodesIndex, content, 'utf-8');
  }
}

// ============================================================
// MAIN SYNC ORCHESTRATOR
// ============================================================

// ── Tracer wrapping ──────────────────────────────────
apiPut = tracer.wrapAsync('apiPut', apiPut, { tier: 3 });

/**
 * Run a full sync cycle.
 * @param {object} opts - { dryRun, verbose, force }
 * @returns {Promise<{ synced: number, skipped: number, errors: number, method: string }>}
 */
export async function syncToObsidian(opts = {}) {
  const { dryRun = false, verbose = false, force = false } = opts;
  const config = loadConfig();

  if (!config.enabled) {
    if (verbose) console.log('Obsidian sync disabled in config');
    return { synced: 0, skipped: 0, errors: 0, method: 'disabled' };
  }

  const vaultRoot = path.join(WORKSPACE, config.vaultPath);
  if (!fs.existsSync(vaultRoot)) {
    if (verbose) console.log(`Vault not found at ${vaultRoot}`);
    return { synced: 0, skipped: 0, errors: 0, method: 'vault-missing' };
  }

  // Load sync state (hash tracking)
  const syncState = force ? {} : loadSyncState();
  const newState = { ...syncState };

  // Ensure node directories exist
  if (!dryRun) {
    ensureNodeDirs(vaultRoot, config.nodeId);
  }

  // Check API availability
  const apiKey = loadApiKey(config);
  const apiAvailable = apiKey ? await apiHealthCheck(apiKey, config.apiPort) : false;
  const method = apiAvailable ? 'api' : 'file';

  if (verbose) {
    console.log(`Sync method: ${method}${apiAvailable ? ` (port ${config.apiPort})` : ' (direct write)'}`);
  }

  // Discover and route files
  const allFiles = discoverFiles(config);
  let synced = 0, skipped = 0, errors = 0;

  for (const relPath of allFiles) {
    const absPath = path.join(WORKSPACE, relPath);
    if (!fs.existsSync(absPath)) continue;

    // Skip non-text files by extension
    const ext = path.extname(relPath).toLowerCase();
    if (['.zip', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.woff', '.woff2', '.ttf'].includes(ext)) continue;

    const route = routeFile(relPath, config);
    if (!route) continue;

    // Check if file has changed since last sync
    let currentHash;
    try {
      currentHash = fileHash(absPath);
    } catch {
      continue; // unreadable
    }

    if (!force && syncState[relPath] === currentHash) {
      skipped++;
      continue;
    }

    // Read source content
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      errors++;
      continue;
    }

    // Inject frontmatter for markdown files
    if (ext === '.md' || ext === '.txt') {
      const fmFields = {
        title: path.basename(relPath, ext).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        type: 'reference',
        status: config.frontmatterDefaults.status || 'draft',
        tags: config.frontmatterDefaults.tags || ['auto-synced'],
        source_node: config.nodeId,
        source_path: relPath,
      };

      if (route.domain) {
        fmFields.domain = route.domain;
      }
      if (route.type === 'private') {
        fmFields.tags = [...(fmFields.tags || []), 'node-private'];
      }

      content = injectFrontmatter(content, fmFields);
    }

    if (dryRun) {
      console.log(`  [dry] ${relPath} → ${route.dest} (${route.type})`);
      synced++;
      newState[relPath] = currentHash;
      continue;
    }

    // Write to vault
    let ok = false;
    if (apiAvailable) {
      ok = await apiPut(route.dest, content, apiKey, config.apiPort);
      if (!ok && verbose) {
        console.log(`  [api-fail] ${route.dest} — falling back to file write`);
      }
    }

    if (!ok) {
      try {
        ok = directWrite(vaultRoot, route.dest, content);
      } catch (e) {
        if (verbose) console.log(`  [error] ${route.dest}: ${e.message}`);
        errors++;
        continue;
      }
    }

    if (ok) {
      synced++;
      newState[relPath] = currentHash;
      if (verbose) console.log(`  [synced] ${relPath} → ${route.dest} (${route.type})`);
    } else {
      errors++;
      if (verbose) console.log(`  [failed] ${relPath} → ${route.dest}`);
    }
  }

  // Save sync state
  if (!dryRun) {
    saveSyncState(newState);
  }

  // Cross-soul lesson propagation: merge shareable lessons → shared vault
  if (!dryRun) {
    const propagated = propagateSharedLessons(vaultRoot, config, verbose);
    if (verbose && propagated > 0) {
      console.log(`  [lessons] ${propagated} shared lessons propagated to 00-meta/shared-lessons.md`);
    }
  }

  return { synced, skipped, errors, method };
}

// ============================================================
// CROSS-SOUL LESSON PROPAGATION
// ============================================================

/**
 * Shareable lesson tags. Preferences and workflows are node-private.
 * Errors, patterns, and corrections benefit all nodes.
 */
const SHAREABLE_TAGS = new Set(['error', 'pattern', 'correction']);

/**
 * Parse lesson entries from a lessons.md file.
 * Returns [{tag, text, date, sourceNode}].
 */
function parseLessons(content, sourceNode) {
  const lessons = [];
  const lineRegex = /^\[(\w+)\]\s+(.+?)(?:\s+\((\d{4}-\d{2}-\d{2})\))?$/;

  for (const line of content.split('\n')) {
    const match = line.trim().match(lineRegex);
    if (!match) continue;

    const [, tag, text, date] = match;
    lessons.push({ tag, text, date: date || 'unknown', sourceNode });
  }

  return lessons;
}

/**
 * Scan all node lesson files in vault, extract shareable lessons,
 * write merged file to 00-meta/shared-lessons.md.
 *
 * Returns number of lessons written.
 */
function propagateSharedLessons(vaultRoot, config, verbose = false) {
  const nodesDir = path.join(vaultRoot, 'nodes');
  if (!fs.existsSync(nodesDir)) return 0;

  const allLessons = [];

  // Scan each node's lessons directory
  let nodeDirs;
  try {
    nodeDirs = fs.readdirSync(nodesDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('_'));
  } catch {
    return 0;
  }

  for (const nodeDir of nodeDirs) {
    const nodeId = nodeDir.name;
    const lessonsDir = path.join(nodesDir, nodeId, 'lessons');
    if (!fs.existsSync(lessonsDir)) continue;

    // Read all .md files in lessons dir
    let files;
    try {
      files = fs.readdirSync(lessonsDir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(lessonsDir, file), 'utf-8');
        // Strip frontmatter before parsing
        const body = content.replace(FM_REGEX, '');
        const lessons = parseLessons(body, nodeId);
        allLessons.push(...lessons);
      } catch {
        if (verbose) console.log(`  [lessons] failed to read ${nodeId}/lessons/${file}`);
      }
    }
  }

  // Also read workspace .learnings/lessons.md directly (covers current node before sync)
  const workspaceLessons = path.join(WORKSPACE, '.learnings', 'lessons.md');
  if (fs.existsSync(workspaceLessons)) {
    try {
      const content = fs.readFileSync(workspaceLessons, 'utf-8');
      const lessons = parseLessons(content, config.nodeId);
      allLessons.push(...lessons);
    } catch { /* skip */ }
  }

  // Filter to shareable lessons only
  const shareable = allLessons.filter(l => SHAREABLE_TAGS.has(l.tag));

  // Deduplicate by text (case-insensitive, first 80 chars)
  const seen = new Set();
  const unique = [];
  for (const lesson of shareable) {
    const key = lesson.text.toLowerCase().slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(lesson);
    }
  }

  if (unique.length === 0) return 0;

  // Sort: most recent first
  unique.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Generate shared lessons file
  const today = new Date().toISOString().split('T')[0];
  const lines = [
    '---',
    'title: Shared Lessons (Cross-Soul)',
    'domain: meta',
    'type: reference',
    'status: living',
    `updated: ${today}`,
    'tags: [auto-synced, cross-soul, lessons]',
    '---',
    '',
    '# Shared Lessons',
    '',
    '> Auto-generated by obsidian-sync. Shareable lessons extracted from all agent nodes.',
    `> Last updated: ${today} | ${unique.length} lessons from ${new Set(unique.map(l => l.sourceNode)).size} node(s)`,
    '',
  ];

  for (const lesson of unique) {
    lines.push(`- [${lesson.tag}] ${lesson.text} _(${lesson.sourceNode}, ${lesson.date})_`);
  }

  const content = lines.join('\n') + '\n';
  const destPath = path.join(vaultRoot, '00-meta', 'shared-lessons.md');

  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf-8');
    return unique.length;
  } catch (e) {
    if (verbose) console.log(`  [lessons] failed to write shared-lessons.md: ${e.message}`);
    return 0;
  }
}

// ============================================================
// CLI
// ============================================================

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const force = args.includes('--force');

  console.log('Obsidian Sync');
  console.log(`Workspace: ${WORKSPACE}`);
  console.log('');

  syncToObsidian({ dryRun, verbose, force })
    .then(result => {
      console.log(`\nResult: ${result.synced} synced, ${result.skipped} unchanged, ${result.errors} errors (method: ${result.method})`);
      if (result.errors > 0) process.exit(1);
    })
    .catch(e => {
      console.error(`Sync failed: ${e.message}`);
      process.exit(1);
    });
}
