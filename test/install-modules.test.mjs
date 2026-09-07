import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // The Node >= 22 check moved into prereqs.sh (node_ok); system-deps.sh now
  // delegates to it rather than carrying its own version comparison.
  assert.ok(moduleSrc['system-deps.sh'].includes('PREREQ_SCRIPT'));
  assert.ok(moduleSrc['helpers.sh'].includes('echo "  [dry-run] $*"'));
  assert.ok(moduleSrc['verify.sh'].includes('node-acceptance.mjs'));
  // --skip-llm must reach the gate as --skip-axis llm, or every documented
  // model-less install is rejected by its own acceptance step.
  assert.ok(moduleSrc['verify.sh'].includes('--skip-axis llm'));
  // P5-4: an INCOMPLETE gate (exit 2) under --skip-llm is a loud warning, not
  // a failed install; a REJECTED gate (exit 1) still fails it.
  assert.ok(moduleSrc['verify.sh'].includes('"$GATE_RC" -eq 2 ] && $SKIP_LLM'));
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

// mesh-install.sh treats the join-token payload as untrusted: an expired token
// or one steering the clone at a foreign repo must die before touching the
// machine (no node install, no git clone). Both checks run at script top level,
// before any package manager is invoked, so they are safe to exercise here.
const MESH_INSTALL = join(ROOT, 'mesh-install.sh');
const b64url = obj => Buffer.from(JSON.stringify({ p: obj, s: 'deadbeef' })).toString('base64url');
const runMeshInstall = token => spawnSync('bash', [MESH_INSTALL], {
  encoding: 'utf8',
  env: { ...process.env, MESH_JOIN_TOKEN: token, HOME: join(ROOT, 'test', '.no-such-home') },
});

test('mesh-install.sh refuses an expired join token', () => {
  const r = runMeshInstall(b64url({ v: 3, repo: 'https://github.com/moltyguibros-design/openclaw-node.git', expires: Date.now() - 60_000 }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /expired/);
});

test('mesh-install.sh refuses a join token pointing at a repo outside the allowlist', () => {
  const r = runMeshInstall(b64url({ v: 3, repo: 'https://github.com/evil/openclaw-node.git', expires: Date.now() + 3_600_000 }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /unrecognised repo/);
  assert.doesNotMatch(r.stdout + r.stderr, /Cloning/);
});

// P4-3: --dry-run must be dry. Run the whole installer against an empty HOME
// in sandbox mode and assert nothing under it was created. The heredoc
// writers (write_file), generate_config, service renders, sed -i edits,
// chmods and launchctl/systemctl calls all used to bypass run().
test('install.sh --dry-run writes nothing under $HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-dry-'));
  mkdirSync(join(home, '.openclaw'), { recursive: true });
  const r = spawnSync('bash', [INSTALL_SH, '--dry-run', '--sandbox'], {
    encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, HOME: home, OPENCLAW_HOME: join(home, '.openclaw') },
  });
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(home);
  assert.deepEqual(files, [], `dry-run created files: ${files.join(', ')}\n--- tail ---\n${r.stdout.slice(-1500)}`);
  assert.equal(r.status, 0, `dry-run must complete: exit ${r.status}\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-500)}`);
  assert.doesNotMatch(r.stdout, /SOURCE MISSING/);
});

// P7-0: the deploy/operator trust allowlists must be seeded with the RAW base64
// identity pubkey (what trustedDeployKeys() compares), not the SPKI PEM text of
// identity.pub — that mismatch made strict signed deploy refuse every trigger on
// installed nodes. Run the exact shell functions config.sh uses, against a temp
// identity, then prove a trigger signed by that identity verifies under the
// seeded allowlist. Merge semantics: operator-added keys survive, no duplicates.
test('config.sh seeds trust allowlists with the raw base64 identity pubkey and merges', async () => {
  const { getOrCreateIdentity } = await import('../lib/node-identity.mjs');
  const { signDeployTrigger, verifyDeployTrigger } = await import('../lib/deploy-trigger-auth.mjs');
  const cfg = moduleSrc['config.sh'];
  const start = cfg.indexOf('identity_pubkey_base64() {');
  const end = cfg.indexOf('# Deploy-trigger trust');
  assert.ok(start > 0 && end > start, 'seeding helpers must exist in config.sh');
  const helpers = cfg.slice(start, end);

  const root = mkdtempSync(join(tmpdir(), 'openclaw-trust-'));
  const identity = getOrCreateIdentity(root);
  const envFile = join(root, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_DEPLOY_TRUSTED_KEYS=operatorKeyAAA\n');

  const script = `
    set -euo pipefail
    run() { "$@"; }
    ${helpers}
    SELF="$(identity_pubkey_base64)"
    merge_trusted_key OPENCLAW_DEPLOY_TRUSTED_KEYS "$SELF"
    merge_trusted_key OPENCLAW_DEPLOY_TRUSTED_KEYS "$SELF"
    merge_trusted_key OPENCLAW_OPERATOR_TRUSTED_KEYS "$SELF"
    printf '%s' "$SELF"
  `;
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, OPENCLAW_ROOT: root, REPO_DIR: ROOT, NODE_BIN: process.execPath, ENV_FILE: envFile },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, identity.publicKeyBase64);
  assert.equal(r.stdout.length, 44);
  assert.doesNotMatch(r.stdout, /BEGIN PUBLIC KEY/);

  const env = readFileSync(envFile, 'utf8');
  const deploy = env.match(/^OPENCLAW_DEPLOY_TRUSTED_KEYS=(.*)$/m)[1];
  assert.equal(deploy, `operatorKeyAAA,${identity.publicKeyBase64}`, 'merge keeps operator keys, adds ours once');
  assert.equal(env.match(/^OPENCLAW_OPERATOR_TRUSTED_KEYS=(.*)$/m)[1], identity.publicKeyBase64);

  const signed = signDeployTrigger({ sha: 'abc123', node_id: 'ci' }, { identityDir: root });
  const ok = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: deploy.split(','), seenIds: null });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const pem = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [readFileSync(join(root, 'identity.pub'), 'utf8').replace(/\n/g, '')], seenIds: null });
  assert.equal(pem.ok, false, 'the PEM text must NOT be accepted as a trusted key (the old bug)');
});
