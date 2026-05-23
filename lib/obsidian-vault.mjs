/**
 * Per-node Obsidian vault structure setup.
 *
 * Creates and manages the local vault directory layout at
 * ~/.openclaw/obsidian-local/ (or OBSIDIAN_VAULT_PATH override).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';

/** Default vault path — per-node, outside the repo. */
export const DEFAULT_VAULT_PATH = join(homedir(), '.openclaw', 'obsidian-local');

/** Subdirectories that make up the vault structure. */
export const VAULT_SUBDIRS = ['concepts', 'decisions', 'sessions', 'themes', 'daily'];

/**
 * Resolve the vault path from options, env var, or default.
 * @param {{ vaultPath?: string }} [opts]
 * @returns {string}
 */
export function getVaultPath(opts = {}) {
  return opts.vaultPath || process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT_PATH;
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
