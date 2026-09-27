/**
 * test/web-fetch-entrypoint.test.mjs — web-fetch runs however it is launched,
 * and never when imported.
 *
 * Same defect as the knowledge server (test/mcp-knowledge-entrypoint.test.mjs):
 * the entrypoint check compared the symlink-resolved module URL with argv[1]
 * as given, so launched through a symlinked bin/ the fetcher exited 0 without
 * fetching or refusing anything. Each launch asks for the cloud metadata
 * endpoint, which the P5-7 guard refuses before Playwright or the network.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BIN = fileURLToPath(new URL('../workspace-bin', import.meta.url));
const METADATA = 'http://169.254.169.254/latest/meta-data/';
const REFUSED = /refused: 169\.254\.169\.254 is a private\/reserved address/;

function run(args) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  return new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('web-fetch entrypoint', () => {
  let dir;
  let symlinked;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'web-fetch-entry-'));
    mkdirSync(join(dir, 'workspace'));
    symlinkSync(BIN, join(dir, 'workspace', 'bin'));
    symlinked = join(dir, 'workspace', 'bin', 'web-fetch.mjs');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('runs its guard when launched through a symlinked bin/', { timeout: 30_000 }, async () => {
    const r = await run([symlinked, METADATA]);
    assert.equal(r.code, 2, `main() never ran (exit ${r.code}); stderr: ${r.stderr || '(empty)'}`);
    assert.match(r.stderr, REFUSED);
  });

  it('runs its guard when launched by its real path', { timeout: 30_000 }, async () => {
    const r = await run([join(BIN, 'web-fetch.mjs'), METADATA]);
    assert.equal(r.code, 2, `main() never ran (exit ${r.code}); stderr: ${r.stderr || '(empty)'}`);
    assert.match(r.stderr, REFUSED);
  });

  it('does not run when imported through the symlink', { timeout: 30_000 }, async () => {
    const importer = join(dir, 'importer.mjs');
    writeFileSync(importer, 'const m = await import(process.argv[2]);\nconsole.log(typeof m.assertPublicUrl);\n');
    const r = await run([importer, pathToFileURL(symlinked).href]);
    assert.equal(r.code, 0, `importing ran main(); stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'function');
  });
});
