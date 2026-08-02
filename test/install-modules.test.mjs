import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const rootLock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const heartbeatLaunchd = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.scheduler-heartbeat.plist'), 'utf8');
const heartbeatSystemd = readFileSync(join(ROOT, 'services/systemd/openclaw-scheduler-heartbeat.service'), 'utf8');

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

test('mcp-knowledge is owned by the root dependency workspace', () => {
  assert.ok(rootPackage.workspaces.includes('lib/mcp-knowledge'));
  assert.ok(rootLock.packages['lib/mcp-knowledge']);
  assert.equal(rootLock.packages['node_modules/@openclaw/mcp-knowledge'].link, true);
  assert.equal(existsSync(join(ROOT, 'lib/mcp-knowledge/package-lock.json')), false);

  const rootRequire = createRequire(join(ROOT, 'package.json'));
  const sharp = rootRequire('sharp');
  assert.ok(Number(sharp.versions.sharp.split('.')[1]) >= 35, `Sharp ${sharp.versions.sharp} is below 0.35`);
  assert.equal(existsSync(join(ROOT, 'lib/mcp-knowledge/node_modules/sharp')), false);
});

test('installer never creates or copies nested mcp-knowledge dependencies', () => {
  const workspace = moduleSrc['workspace.sh'];
  assert.doesNotMatch(workspace, /mcp-knowledge\/node_modules/);
  assert.doesNotMatch(workspace, /cd \"\$WORKSPACE\/lib\/mcp-knowledge\"/);
  assert.doesNotMatch(workspace, /cd \"\$MESH_LIB\/mcp-knowledge\"/);
  assert.ok(workspace.includes("run rsync -av --exclude='node_modules' \\\n  \"$REPO_DIR/lib/\" \"$WORKSPACE/lib/\""));
  assert.ok(workspace.includes("run rsync -av --exclude='node_modules' \"$REPO_DIR/lib/\" \"$MESH_LIB/\""));
});

test('installer links scoped packages into both deployed parent trees', () => {
  const workspace = moduleSrc['workspace.sh'];
  assert.ok(workspace.includes('for scoped_dir in "$pkgdir"*/'));
  assert.ok(workspace.includes('link_dependency_tree "$MESH_NM" "$WS_NM"'));
  assert.ok(workspace.includes('link_dependency_tree "$MESH_NM" "$MESH_HOME_NM"'));
  assert.ok(moduleSrc['components.sh'].includes('$WORKSPACE/node_modules/@huggingface/transformers'));
  assert.ok(!moduleSrc['components.sh'].includes('$WORKSPACE/lib/mcp-knowledge/node_modules'));
});

test('scheduler heartbeat helper is installer-owned and both units invoke it', () => {
  assert.ok(moduleSrc['workspace.sh'].includes('scheduler-heartbeat.mjs'));
  assert.ok(heartbeatLaunchd.includes('${NODE_BIN}'));
  assert.ok(heartbeatLaunchd.includes('${OPENCLAW_WORKSPACE}/bin/scheduler-heartbeat.mjs'));
  assert.ok(heartbeatSystemd.includes('${NODE_BIN} ${OPENCLAW_WORKSPACE}/bin/scheduler-heartbeat.mjs'));
  assert.doesNotMatch(heartbeatLaunchd, /\/usr\/bin\/curl/);
  assert.doesNotMatch(heartbeatSystemd, /\/usr\/bin\/curl/);
  assert.doesNotMatch(`${heartbeatLaunchd}\n${heartbeatSystemd}`, /Authorization|Bearer/);
});
