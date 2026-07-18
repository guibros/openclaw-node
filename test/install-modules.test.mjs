import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_SH = join(ROOT, 'install.sh');

const MODULES = [
  'helpers.sh',
  'system-deps.sh',
  'env.sh',
  'workspace.sh',
  'config.sh',
  'components.sh',
  'services.sh',
  'integrations.sh',
  'verify.sh',
];

const FLAGS = [
  '--dry-run',
  '--update',
  '--skip-mesh',
  '--enable-services',
  '--skip-llm',
  '--skip-verify',
  '--skip-frontend',
  '--verify-frontend',
  '--sandbox',
  '--role=',
  '--cluster-peers=',
  '--cluster-bind=',
];

const installSrc = readFileSync(INSTALL_SH, 'utf8');
const moduleSrc = Object.fromEntries(
  MODULES.map((m) => [m, readFileSync(join(ROOT, 'scripts/install', m), 'utf8')]),
);

function bashN(file) {
  return spawnSync('bash', ['-n', file], { encoding: 'utf8' });
}

test('install.sh passes bash -n', () => {
  const r = bashN(INSTALL_SH);
  assert.equal(r.status, 0, r.stderr);
});

test('every module passes bash -n', () => {
  for (const m of MODULES) {
    const r = bashN(join(ROOT, 'scripts/install', m));
    assert.equal(r.status, 0, `${m}: ${r.stderr}`);
  }
});

test('install.sh sources every module, in order', () => {
  let last = -1;
  for (const m of MODULES) {
    const idx = installSrc.indexOf(`source "$REPO_DIR/scripts/install/${m}"`);
    assert.notEqual(idx, -1, `install.sh does not source ${m}`);
    assert.ok(idx > last, `${m} sourced out of order`);
    last = idx;
  }
});

test('flag parser still accepts the full flag inventory', () => {
  const r = spawnSync('bash', [INSTALL_SH, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of FLAGS) {
    assert.ok(r.stdout.includes(f), `--help output missing ${f}`);
    assert.ok(installSrc.includes(`${f}`), `parser case missing ${f}`);
  }
  assert.match(installSrc, /--help\|-h\)/);
});

test('the 3 unit-render dry-run guards live in services.sh', () => {
  const guard = /\[dry-run\] would render \$TEMPLATE -> \$DEST/g;
  assert.equal(moduleSrc['services.sh'].match(guard)?.length, 3);
  assert.equal(installSrc.match(guard), null);
});

test('cluster dry-run guard and cluster security live in config.sh', () => {
  const cfg = moduleSrc['config.sh'];
  assert.ok(cfg.includes('[dry-run] would render cluster nats.conf'));
  assert.ok(cfg.includes('Refusing to bind 0.0.0.0.'));
  assert.ok(cfg.includes('tailscale ip -4'));
  assert.ok(cfg.includes('OPENCLAW_NATS_CLUSTER_PASS="$(openssl rand -hex 32)"'));
  assert.ok(cfg.includes('OPENCLAW_DEPLOY_TRUSTED_KEYS'));
});

test('preserved behaviors sit in their modules', () => {
  assert.ok(moduleSrc['env.sh'].includes('claude_project_path() {'));
  assert.ok(moduleSrc['env.sh'].includes("sed 's|[/.]|-|g'"));
  assert.ok(moduleSrc['system-deps.sh'].includes('"$NODE_VERSION" -ge 22'));
  assert.ok(moduleSrc['helpers.sh'].includes('echo "  [dry-run] $*"'));
  assert.ok(moduleSrc['verify.sh'].includes('node-acceptance.mjs'));
});
