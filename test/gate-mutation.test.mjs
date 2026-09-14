import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ANALYSIS_TIMEOUT } from '../lib/llm-client.mjs';

// Gate mutation-tests (audits/gate_mutation): prove each CUSTOM gate still
// REJECTS known-bad input. Vendored tools don't rot; our glue does — grep
// patterns, shell guards, budget constants. Two live rot instances motivated
// this (inject probe budget, embed-benchmark load sensitivity).

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Tarball-smoke assertions ─────────────────────────────────────────────
// Replicates the workflow's three asserts against doctored pack listings. The
// drift-lock test pins the YAML so the replica can't silently diverge.

const MODULES = ['components', 'config', 'env', 'helpers', 'integrations', 'services', 'system-deps', 'verify', 'workspace'];
const goodListing = () => [
  'npm notice 6.0kB install.sh',
  ...MODULES.map(m => `npm notice 9.3kB scripts/install/${m}.sh`),
  'npm notice 1.2kB packages/event-schemas/dist/index.js',
  'npm notice 4.4kB uninstall.sh',
].join('\n');

function smokePasses(listing) {
  const hasInstall = / install\.sh/.test(listing);
  const moduleCount = (listing.match(/ scripts\/install\/.*\.sh/g) || []).length === 9;
  const hasDist = / packages\/event-schemas\/dist\//.test(listing);
  return hasInstall && moduleCount && hasDist;
}

describe('tarball-smoke gate rejects doctored listings', () => {
  it('accepts the healthy listing', () => {
    assert.equal(smokePasses(goodListing()), true);
  });
  it('rejects a listing missing one installer module', () => {
    assert.equal(smokePasses(goodListing().replace(/^.*scripts\/install\/env\.sh$/m, '')), false);
  });
  it('rejects a listing missing install.sh', () => {
    assert.equal(smokePasses(goodListing().replace(/^.*[^/]install\.sh$/m, '')), false);
  });
  it('rejects a listing missing the event-schemas dist', () => {
    assert.equal(smokePasses(goodListing().replace(/^.*event-schemas.*$/m, '')), false);
  });
  it('drift-lock: the workflow still carries the three assertion strings this replica mirrors', () => {
    const yml = readFileSync(join(REPO, '.github/workflows/test.yml'), 'utf8');
    assert.ok(yml.includes('grep -q " install.sh"'), 'install.sh grep changed — re-sync smokePasses()');
    assert.ok(yml.includes('grep -c " scripts/install/.*\\.sh"'), 'module-count grep changed — re-sync smokePasses()');
    assert.ok(yml.includes('grep -q " packages/event-schemas/dist/"'), 'dist grep changed — re-sync smokePasses()');
  });
});

// ── 2. scope-check.sh — the most load-bearing gate in the repo ──────────────
// Stable cases only: the BLOCK path (whose silent death would be a fail-open
// hole), the always-writeable escape valves, and the documented fail-opens.
// The allow-via-open-batch path is exercised by every real edit.

function runHook(payload) {
  try {
    execFileSync('bash', [join(REPO, '.claude/hooks/scope-check.sh')], {
      input: payload, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (e) {
    return e.status;
  }
}
const forPath = (p) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: p } });

describe('scope hook blocks out-of-scope writes', () => {
  it('blocks a path in no scope (exit 2)', () => {
    assert.equal(runHook(forPath('lib/definitely-not-in-any-scope-gate-mutation-probe.mjs')), 2);
  });
  it('blocks an absolute out-of-scope path', () => {
    assert.equal(runHook(forPath(join(REPO, 'bin/not-in-any-scope-probe.mjs'))), 2);
  });
  it('always allows plan OUT_OF_SCOPE.md (drift-capture escape valve)', () => {
    assert.equal(runHook(forPath('memory-plan/plans/federation/OUT_OF_SCOPE.md')), 0);
  });
  it('always allows plan SCOPE.md (operator scope-refresh escape valve)', () => {
    assert.equal(runHook(forPath('memory-plan/plans/federation/SCOPE.md')), 0);
  });
  // Review I4 (2026-09-06): these two were documented fail-OPENS — "can't
  // decide → allow" — on the only mechanically enforced write gate in the repo.
  // A write gate that cannot determine its target must refuse.
  it('fails CLOSED on pathless tool input', () => {
    assert.equal(runHook(JSON.stringify({ tool_name: 'Write', tool_input: {} })), 2);
  });
  it('fails CLOSED on empty stdin', () => {
    assert.equal(runHook(''), 2);
  });
  it("refuses a '..' traversal that would land on an escape valve", () => {
    assert.equal(runHook(forPath('lib/../memory-plan/plans/federation/OUT_OF_SCOPE.md')), 2);
  });
  it('does not govern a path outside the repo', () => {
    assert.equal(runHook(forPath('/tmp/scope-check-outside-probe.md')), 0);
  });
});

// ── 2b. The expiry latch (D10) ──────────────────────────────────────────────
// An `active` scope whose Expires has passed denies every write, exactly like
// having no scope at all — and for three incidents it REPORTED the same thing
// ("no active scope"), sending operators to look for a Status they had already
// set. federation lost 2026-08-24, repair 2026-08-26, protocol four silent days
// from 2026-09-10.
//
// These run the hook out of a throwaway repo tree rather than the real one:
// REPO_ROOT is derived from the script's own location ($0/../..), so a copy of
// the hook under <tmp>/.claude/hooks/ roots itself at <tmp> and reads only the
// fixture SCOPE.md. No env seam is introduced — an env var that redirected the
// scope directory would be a fail-open on the repo's only write gate.

function fixtureRepo({ status, expires }) {
  const root = mkdtempSync(join(tmpdir(), 'scope-expiry-'));
  mkdirSync(join(root, '.claude/hooks'), { recursive: true });
  mkdirSync(join(root, 'memory-plan/plans/demo'), { recursive: true });
  mkdirSync(join(root, 'lib'), { recursive: true });
  copyFileSync(join(REPO, '.claude/hooks/scope-check.sh'), join(root, '.claude/hooks/scope-check.sh'));
  writeFileSync(join(root, 'memory-plan/plans/demo/SCOPE.md'),
    `# SCOPE — demo plan\n\n**Status:** ${status}\n**Goal:** fixture\n` +
    `**Expires:** ${expires}\n\n\`\`\`files demo-batch\nlib/target.mjs\n\`\`\`\n`);
  return root;
}

// Run the fixture's own copy of the hook; return both halves of the verdict.
function runFixture(root, relPath = 'lib/target.mjs') {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(root, relPath) } });
  try {
    execFileSync('bash', [join(root, '.claude/hooks/scope-check.sh')], {
      input: payload, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr ?? '') };
  }
}

describe('scope hook names an expired scope instead of calling it absent', () => {
  it('still BLOCKS on an expired scope (the gate does not loosen)', () => {
    const root = fixtureRepo({ status: 'active', expires: '2026-09-10T00:00:00Z' });
    try {
      assert.equal(runFixture(root).status, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('reports EXPIRED — not "no active scope" — and names the lapsed plan', () => {
    const root = fixtureRepo({ status: 'active', expires: '2026-09-10T00:00:00Z' });
    try {
      const { stderr } = runFixture(root);
      assert.match(stderr, /scope EXPIRED/);
      assert.match(stderr, /memory-plan\/plans\/demo\/SCOPE\.md/);
      assert.match(stderr, /2026-09-10T00:00:00Z/);       // the operator's own timestamp, verbatim
      // The latch itself: the headline must not repeat the old misdiagnosis.
      assert.doesNotMatch(stderr.split('\n')[0], /no active scope/);
      assert.doesNotMatch(stderr, /BLOCKED by scope-check\.sh: no active scope/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('an unparseable Expires is reported as such, not silently swallowed', () => {
    const root = fixtureRepo({ status: 'active', expires: 'next tuesday' });
    try {
      const { status, stderr } = runFixture(root);
      assert.equal(status, 2);
      assert.match(stderr, /not ISO-8601 UTC/);
      assert.doesNotMatch(stderr.split('\n')[0], /no active scope/);
      assert.doesNotMatch(stderr, /BLOCKED by scope-check\.sh: no active scope/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('a genuinely idle scope still reports "no active scope"', () => {
    const root = fixtureRepo({ status: 'idle', expires: '2099-01-01T00:00:00Z' });
    try {
      const { status, stderr } = runFixture(root);
      assert.equal(status, 2);
      assert.match(stderr, /no active scope/);
      assert.doesNotMatch(stderr, /scope EXPIRED/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('an unexpired active scope allows its listed file (positive control)', () => {
    const root = fixtureRepo({ status: 'active', expires: '2099-01-01T00:00:00Z' });
    try {
      assert.equal(runFixture(root).status, 0);
      assert.equal(runFixture(root, 'lib/unlisted.mjs').status, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// ── 3. Inject probe budget vs server design ─────────────────────────────────
// The relationship that rotted once: the probe's HTTP budget must clear the
// inject server's DESIGNED worst case (analysis fallback wait + retrieval),
// or a live-but-loaded server grades BROKEN.

describe('MEM-L2-INJECT budget clears the designed worst case', () => {
  const src = readFileSync(join(REPO, 'lib/node-acceptance-probes.mjs'), 'utf8');
  const block = src.slice(src.indexOf("id: 'MEM-L2-INJECT'"), src.indexOf("id: 'MEM-L4-ROUNDTRIP'"));
  const probeTimeout = Number(block.match(/timeoutMs:\s*(\d+)/)[1]);
  const httpTimeout = Number(block.match(/timeoutMs:\s*(\d+)/g)[1].match(/(\d+)/)[1]);

  it('HTTP budget ≥ 2× the analysis fallback wait', () => {
    assert.ok(httpTimeout >= DEFAULT_ANALYSIS_TIMEOUT * 2,
      `httpTimeout ${httpTimeout} < 2×analysis ${DEFAULT_ANALYSIS_TIMEOUT} — a loaded live server will grade BROKEN again`);
  });
  it('probe budget exceeds its own HTTP budget', () => {
    assert.ok(probeTimeout > httpTimeout, `probe ${probeTimeout} must outlive its HTTP call ${httpTimeout}`);
  });
});

// ── 4. MC eslint gate vacuity ───────────────────────────────────────────────
// Rot mode: the flat config's ignores silently swallowing src/ — the gate then
// passes because nothing is linted. Assert eslint still scans a real file AND
// still rejects a seeded error-level violation. Skips visibly where MC deps
// aren't installed (CI's unit-tests job installs root deps only).

const MC = join(REPO, 'mission-control');
const ESLINT = join(MC, 'node_modules/.bin/eslint');
const MC_SKIP = existsSync(ESLINT) ? false : 'mission-control node_modules not installed';

describe('mission-control eslint gate is not vacuous', { skip: MC_SKIP }, () => {
  it('actually scans real source (not ignored away)', () => {
    const out = execFileSync(ESLINT, ['--format', 'json', 'src/lib/config.ts'], { cwd: MC, encoding: 'utf8' });
    const results = JSON.parse(out);
    assert.equal(results.length, 1);
    assert.notEqual(results[0].messages?.some?.(m => m.ruleId === null && /ignored/i.test(m.message)), true,
      'config.ts is being ignored — the lint gate is passing vacuously');
  });
  it('rejects a seeded error-level violation', () => {
    const scratch = join(MC, 'src', '__gate-mutation-scratch.ts');
    // ban-ts-comment is severity-2 in this config (probed); core no-dupe-keys
    // is off for TS files (tsc owns it), so it can't serve as the seed.
    writeFileSync(scratch, '// @ts-ignore\nexport const x: number = 1;\n');
    try {
      let status = 0;
      try {
        execFileSync(ESLINT, ['--format', 'json', 'src/__gate-mutation-scratch.ts'], { cwd: MC, encoding: 'utf8' });
      } catch (e) {
        status = e.status;
      }
      assert.equal(status, 1, 'eslint accepted a duplicate-key error — the gate would too');
    } finally {
      rmSync(scratch, { force: true });
    }
  });
});
