/**
 * Per-node Obsidian vault structure setup.
 *
 * Creates and manages the local vault directory layout at
 * ~/.openclaw/obsidian-local/ (or OBSIDIAN_VAULT_PATH override).
 */

import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';

/** Legacy default vault path — per-node, outside the repo. */
export const DEFAULT_VAULT_PATH = join(homedir(), '.openclaw', 'obsidian-local');

/** Subdirectories that make up the vault structure. */
export const VAULT_SUBDIRS = ['concepts', 'decisions', 'sessions', 'themes', 'daily'];

// Vault fusion (2026-07-04, operator decision): the memory pipeline can live
// INSIDE the operator's real Obsidian vault. `memoryVaultPath` in
// ~/.openclaw/config/obsidian-sync.json points the whole pipeline (writers,
// graph, probes) at that subtree — workspace-relative like the file's other
// paths, or absolute. Cached per process: daemons must restart to repoint.
let configuredVaultPath;
function configVaultPath() {
  if (configuredVaultPath === undefined) {
    configuredVaultPath = null;
    const configPath = process.env.OPENCLAW_OBSIDIAN_SYNC_CONFIG
      || join(homedir(), '.openclaw', 'config', 'obsidian-sync.json');
    try {
      const p = JSON.parse(readFileSync(configPath, 'utf8')).memoryVaultPath;
      if (p) {
        const workspace = process.env.OPENCLAW_WORKSPACE || join(homedir(), '.openclaw', 'workspace');
        configuredVaultPath = isAbsolute(p) ? p : join(workspace, p);
      }
    } catch { /* no config / no key → legacy default */ }
  }
  return configuredVaultPath;
}
export function _resetVaultPathCache() { configuredVaultPath = undefined; }

/**
 * Resolve the vault path: explicit option > env override > configured fused
 * vault (obsidian-sync.json memoryVaultPath) > legacy obsidian-local default.
 * @param {{ vaultPath?: string }} [opts]
 * @returns {string}
 */
export function getVaultPath(opts = {}) {
  return opts.vaultPath || process.env.OBSIDIAN_VAULT_PATH || configVaultPath() || DEFAULT_VAULT_PATH;
}

/**
 * Ensure the vault root and all subdirectories exist.
 * Idempotent — safe to call repeatedly.
 *
 * @param {string} [vaultPath] — resolved vault path (defaults via getVaultPath)
 * @returns {Promise<{ vaultPath: string, created: string[] }>}
 */
export async function ensureVaultStructure(vaultPath) {
  const resolved = vaultPath || getVaultPath();
  const created = [];

  for (const subdir of ['.', ...VAULT_SUBDIRS]) {
    const dirPath = subdir === '.' ? resolved : join(resolved, subdir);
    const existed = await dirExists(dirPath);
    await mkdir(dirPath, { recursive: true });
    if (!existed) {
      created.push(subdir === '.' ? resolved : subdir);
    }
  }

  return { vaultPath: resolved, created };
}

/**
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
