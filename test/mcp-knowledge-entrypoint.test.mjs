/**
 * test/mcp-knowledge-entrypoint.test.mjs — the knowledge server starts however
 * it is launched, and never when imported.
 *
 * .mcp.json launches server.mjs through ~/.openclaw/workspace/lib, a symlink to
 * the checkout's lib/. Node resolves symlinks in the main module's URL but keeps
 * argv[1] as given, so the entrypoint check that compared the two never ran
 * main(): the process exited 0 with no output and every Claude Code session on
 * the node logged `knowledge (CONNECTION_CLOSED)` (2026-09-26).
 *
 * "Started" means main() reached createKnowledgeEngine, which logs the
 * workspace before indexing — so no embedding model is needed, and the child
 * is killed at that line.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIB = fileURLToPath(new URL('../lib', import.meta.url));
const STARTED = '[mcp-knowledge] workspace:';

function run(args, env) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => {
    stderr += d;
    if (stderr.includes(STARTED)) child.kill();
  });
  return new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, started: stderr.includes(STARTED), stdout, stderr }));
  });
}

describe('mcp-knowledge server entrypoint', () => {
  let dir;
  let symlinked;
  const env = (db) => ({
    KNOWLEDGE_ROOT: join(dir, 'root'),
    KNOWLEDGE_DB: join(dir, db),
    KNOWLEDGE_SUMMARY_LLM: '0',
    KNOWLEDGE_POLL_MS: '0',
  });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-knowledge-entry-'));
    mkdirSync(join(dir, 'root'));
    mkdirSync(join(dir, 'workspace'));
    symlinkSync(LIB, join(dir, 'workspace', 'lib'));
    symlinked = join(dir, 'workspace', 'lib', 'mcp-knowledge', 'server.mjs');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('starts when launched through a symlinked lib/ (the .mcp.json path)', { timeout: 60_000 }, async () => {
    const r = await run([symlinked], env('symlinked.db'));
    assert.ok(r.started, `main() never ran (exit ${r.code}); stderr: ${r.stderr || '(empty)'}`);
  });

  it('starts when launched by its real path', { timeout: 60_000 }, async () => {
    const r = await run([join(LIB, 'mcp-knowledge', 'server.mjs')], env('real.db'));
    assert.ok(r.started, `main() never ran (exit ${r.code}); stderr: ${r.stderr || '(empty)'}`);
  });

  it('does not start when imported through the symlink', { timeout: 60_000 }, async () => {
    const importer = join(dir, 'importer.mjs');
    writeFileSync(importer, 'const m = await import(process.argv[2]);\nconsole.log(typeof m.checkHttpOrigin);\n');
    const r = await run([importer, pathToFileURL(symlinked).href], env('imported.db'));
    assert.equal(r.started, false, `importing ran main(); stderr: ${r.stderr}`);
    assert.equal(r.code, 0, `importer failed; stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'function');
  });
});
