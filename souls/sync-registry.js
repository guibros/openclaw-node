#!/usr/bin/env node
/**
 * sync-registry.js — Generate registry.json from individual capabilities.json files.
 * Single source of truth: each soul's capabilities.json.
 * Run after modifying any soul's capabilities.
 *
 * Usage: node souls/sync-registry.js
 */

const fs = require('fs');
const path = require('path');

const SOULS_DIR = __dirname;
const REGISTRY_PATH = path.join(SOULS_DIR, 'registry.json');

// Read existing registry for metadata (specializations, type, dates, etc.)
let existing = { version: '1.0.0', souls: [] };
try {
  existing = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
} catch { /* first run */ }

const existingMap = new Map(existing.souls.map(s => [s.id, s]));

// Discover soul directories (any dir with capabilities.json)
const entries = fs.readdirSync(SOULS_DIR, { withFileTypes: true });
const soulDirs = entries
  .filter(e => e.isDirectory())
  .filter(e => fs.existsSync(path.join(SOULS_DIR, e.name, 'capabilities.json')));

const souls = [];
for (const dir of soulDirs) {
  const capPath = path.join(SOULS_DIR, dir.name, 'capabilities.json');
  const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'));
  const prev = existingMap.get(dir.name);

  souls.push({
    id: dir.name,
    type: prev?.type || (dir.name === 'daedalus' ? 'orchestrator' : 'specialist'),
    basePath: `~/.openclaw/souls/${dir.name}`,
    capabilities: {
      skills: cap.skills || [],
      tools: cap.tools || [],
      mcpServers: cap.mcpServers || [],
    },
    specializations: prev?.specializations || [],
    evolutionEnabled: prev?.evolutionEnabled ?? true,
    parentSoul: prev?.parentSoul ?? (dir.name === 'daedalus' ? null : 'daedalus'),
    createdAt: prev?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

// Sort: orchestrator first, then alphabetical
souls.sort((a, b) => {
  if (a.type === 'orchestrator') return -1;
  if (b.type === 'orchestrator') return 1;
  return a.id.localeCompare(b.id);
});

const registry = { version: existing.version || '1.0.0', souls };
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
console.log(`Synced ${souls.length} souls to registry.json`);
for (const s of souls) {
  console.log(`  ${s.id}: ${s.capabilities.skills.length} skills, ${s.capabilities.tools.length} tools`);
}
