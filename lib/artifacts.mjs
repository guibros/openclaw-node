/**
 * Content-addressed artifact store.
 *
 * Layout:  <base>/sha256/<ref[0:2]>/<ref[2:4]>/<ref>
 * Sidecar: <base>/sha256/<ref[0:2]>/<ref[2:4]>/<ref>.meta.json
 *
 * Local-only for now. Peer NATS RPC (artifacts.fetch.<hash>) deferred to Block 4.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_BASE = join(homedir(), '.openclaw', 'artifacts');

/**
 * Resolve a sha256 ref to its sharded file path.
 * @param {string} ref - SHA-256 hex string (64 chars).
 * @param {string} baseDir - Root artifacts directory.
 * @returns {string} Absolute path to the artifact file.
 */
function refToPath(ref, baseDir) {
  return join(baseDir, 'sha256', ref.slice(0, 2), ref.slice(2, 4), ref);
}

/**
 * Recursively create a directory if it doesn't exist.
 * @param {string} dir
 */
async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Store bytes in the content-addressed store.
 *
 * Idempotent: if an artifact with the same hash already exists, returns
 * the existing ref without overwriting.
 *
 * @param {Buffer|Uint8Array} bytes - Raw artifact bytes.
 * @param {object} opts
 * @param {string} [opts.mime_type] - MIME type (e.g. 'text/plain').
 * @param {string} [opts.filename] - Original filename.
 * @param {string} [opts.baseDir] - Override default artifacts directory.
 * @returns {Promise<{ref: string, size: number, path: string}>}
 */
export async function putArtifact(bytes, { mime_type, filename, baseDir } = {}) {
  const base = baseDir || process.env.OPENCLAW_ARTIFACTS_DIR || DEFAULT_BASE;
  const ref = createHash('sha256').update(bytes).digest('hex');
  const artifactPath = refToPath(ref, base);
  const metaPath = artifactPath + '.meta.json';
  const dir = join(artifactPath, '..');

  // Idempotent: skip write if file already exists
  const exists = await access(artifactPath).then(() => true, () => false);
  if (!exists) {
    await ensureDir(dir);
    await writeFile(artifactPath, bytes);
    await writeFile(metaPath, JSON.stringify({
      ref,
      size: bytes.length,
      mime_type: mime_type || null,
      filename: filename || null,
      created_at: new Date().toISOString(),
      encoding: null,
    }, null, 2) + '\n');
  }

  return { ref, size: bytes.length, path: artifactPath };
}

/**
 * Read artifact bytes from the local store.
 *
 * @param {string} ref - SHA-256 hex string.
 * @param {object} [opts]
 * @param {string} [opts.baseDir] - Override default artifacts directory.
 * @returns {Promise<Buffer>}
 * @throws {Error} If artifact is not found locally.
 */
export async function getArtifact(ref, { baseDir } = {}) {
  const base = baseDir || process.env.OPENCLAW_ARTIFACTS_DIR || DEFAULT_BASE;
  const artifactPath = refToPath(ref, base);
  try {
    return await readFile(artifactPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Artifact not found: ${ref}`);
    }
    throw err;
  }
}

/**
 * Check whether an artifact exists locally.
 *
 * @param {string} ref - SHA-256 hex string.
 * @param {object} [opts]
 * @param {string} [opts.baseDir] - Override default artifacts directory.
 * @returns {Promise<boolean>}
 */
export async function hasArtifact(ref, { baseDir } = {}) {
  const base = baseDir || process.env.OPENCLAW_ARTIFACTS_DIR || DEFAULT_BASE;
  const artifactPath = refToPath(ref, base);
  return access(artifactPath).then(() => true, () => false);
}

/**
 * Re-hash stored bytes and confirm the hash matches the ref.
 *
 * @param {string} ref - SHA-256 hex string.
 * @param {object} [opts]
 * @param {string} [opts.baseDir] - Override default artifacts directory.
 * @returns {Promise<{valid: boolean, ref: string, computedRef: string}>}
 * @throws {Error} If artifact is not found locally.
 */
export async function validateArtifact(ref, { baseDir } = {}) {
  const base = baseDir || process.env.OPENCLAW_ARTIFACTS_DIR || DEFAULT_BASE;
  const bytes = await getArtifact(ref, { baseDir: base });
  const computedRef = createHash('sha256').update(bytes).digest('hex');
  return { valid: computedRef === ref, ref, computedRef };
}
