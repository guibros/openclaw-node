/**
 * deploy-pinned-sha.test.mjs — a deploy installs what changed; a failed deploy
 * rolls back to preSha and stays there.
 *
 * 2026-09-26 audit of main df503b3: the listener fast-forwarded the tree, then
 * ran `mesh-deploy.js --local`, whose own fetch-and-diff saw HEAD == origin and
 * deployed nothing (success reported, nothing restarted); its rollback re-ran
 * that fetching deploy and fast-forwarded straight back onto the failed commit.
 *
 * Real git end to end: a bare origin, a node clone driven by the listener's
 * runDeploy — which runs the clone's own bin/mesh-deploy.js, the file under
 * test copied in — a throwaway HOME as the runtime tree, and launchctl /
 * systemctl / npm stubs on PATH that log what the deploy asked of them.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-pinned-')));
const HOME = path.join(ROOT, 'home');
const ORIGIN = path.join(ROOT, 'origin.git');
const SEED = path.join(ROOT, 'seed');
const NODE = path.join(ROOT, 'node');
const FAKEBIN = path.join(ROOT, 'fakebin');
const CALLS = path.join(ROOT, 'calls.log');
const IS_MAC = process.platform === 'darwin';

// Where mesh-deploy installs on a lead, all derived from HOME.
const RT = {
  bin: path.join(HOME, 'openclaw', 'bin'),
  skills: path.join(HOME, '.openclaw', 'skills'),
  workspace: path.join(HOME, '.openclaw', 'workspace'),
  mc: path.join(HOME, '.openclaw', 'workspace', 'projects', 'mission-control'),
  state: path.join(HOME, '.openclaw', '.deploy-state.json'),
};

// Before the listener loads: it reads REPO_DIR/HOME/role at require time and
// hands this environment to the deploy script it spawns.
Object.assign(process.env, {
  HOME,
  OPENCLAW_REPO_DIR: NODE,
  OPENCLAW_NODE_ROLE: 'lead',
  OPENCLAW_NODE_ID: 'deploy-test-node',
  // As the service units set it: the clone has no node_modules of its own.
  NODE_PATH: path.join(REPO, 'node_modules'),
  PATH: `${FAKEBIN}${path.delimiter}${process.env.PATH}`,
  DEPLOY_TEST_CALLS: CALLS,
  DEPLOY_TEST_UNITS: 'openclaw-mesh-agent openclaw-mission-control',
  GIT_AUTHOR_NAME: 'deploy-test',
  GIT_AUTHOR_EMAIL: 'deploy-test@example.invalid',
  GIT_COMMITTER_NAME: 'deploy-test',
  GIT_COMMITTER_EMAIL: 'deploy-test@example.invalid',
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function stub(name, body) {
  write(FAKEBIN, name, `#!/bin/sh\necho "${name} $* @ $(pwd -P)" >> "$DEPLOY_TEST_CALLS"\n${body}\n`);
  fs.chmodSync(path.join(FAKEBIN, name), 0o755);
}
function commit(message) {
  git(SEED, 'add', '-A');
  git(SEED, 'commit', '-q', '-m', message);
  git(SEED, 'push', '-q', 'origin', 'main');
  return git(SEED, 'rev-parse', 'HEAD');
}

// A daemon built from a tree whose mesh-agent.js says BREAK_DEPLOY fails to start.
// DEPLOY_TEST_UNITS: systemd units installed here. DEPLOY_TEST_STOPPED: units
// or launchd labels installed but stopped, as the service manager reports them.
const broken = 'grep -q BREAK_DEPLOY "$OPENCLAW_REPO_DIR/bin/mesh-agent.js" 2>/dev/null';
stub('systemctl', `case "$*" in
  *LoadState*) for u in $DEPLOY_TEST_UNITS; do [ "$u" = "$6" ] && { echo loaded; exit 0; }; done; echo not-found; exit 0 ;;
  *is-active*) for u in $DEPLOY_TEST_STOPPED; do [ "$u" = "$3" ] && { echo inactive; exit 3; }; done; echo active; exit 0 ;;
esac
if ${broken}; then echo "Job for $3.service failed" >&2; exit 1; fi`);
stub('launchctl', `case "$1" in
  print) for u in $DEPLOY_TEST_STOPPED; do [ "$u" = "\${2##*/}" ] && { echo "state = not running"; exit 0; }; done; printf 'state = running\\npid = 4242\\n' ;;
  kickstart) if ${broken}; then echo "kickstart: service failed to start" >&2; exit 1; fi ;;
esac`);
// The registry has a newer openclaw than the installed CLI: what made the old
// fetching deploy run `npm update -g openclaw` on its own.
stub('npm', 'case "$*" in "view openclaw version") echo 9.9.9 ;; esac');
stub('openclaw', 'echo 1.0.0');
if (IS_MAC) {
  for (const label of ['ai.openclaw.mesh-agent', 'ai.openclaw.mission-control']) {
    write(HOME, `Library/LaunchAgents/${label}.plist`, '<plist/>\n');
  }
}

// What a node's clone needs to run bin/mesh-deploy.js.
const DEPLOY_SCRIPT_FILES = [
  'bin/mesh-deploy.js', 'bin/mesh-deploy-listener.js', 'bin/schema-deploy-transition.js',
  'lib/tracer.js', 'lib/obs-db.js', 'lib/node-id.js', 'lib/nats-resolve.js', 'lib/mesh-roles.js',
  'lib/deploy-trigger-auth.mjs', 'lib/node-identity.mjs', 'lib/atomic-write.mjs',
];
git(ROOT, 'init', '-q', '--bare', '-b', 'main', ORIGIN);
git(ROOT, 'init', '-q', '-b', 'main', SEED);
git(SEED, 'remote', 'add', 'origin', ORIGIN);
for (const rel of DEPLOY_SCRIPT_FILES) {
  write(SEED, rel, fs.readFileSync(path.join(REPO, rel)));
}
write(SEED, 'bin/mesh-agent.js', '// agent v0\n');
write(SEED, 'skills/demo/SKILL.md', '# demo v0\n');
write(SEED, 'skills/demo/old-name.md', 'renamed in v1\n');
write(SEED, 'skills/retired/SKILL.md', '# retired in v1\n');
write(SEED, 'workspace-docs/SOUL.md', '# soul v0\n');
write(SEED, 'mission-control/package.json', '{ "name": "mission-control" }\n');
write(SEED, 'mission-control/src/app/page.tsx', "export default () => 'v0';\n");
const S0 = commit('v0');
git(ROOT, 'clone', '-q', ORIGIN, NODE);

const require = createRequire(import.meta.url);
const { runDeploy } = require('../bin/mesh-deploy-listener.js');

const read = p => fs.readFileSync(p, 'utf8');
const calls = () => (fs.existsSync(CALLS) ? read(CALLS) : '');
const head = () => git(NODE, 'rev-parse', 'HEAD');
const state = () => JSON.parse(read(RT.state));
const trigger = (sha, extra = {}) => ({ sha: sha.slice(0, 7), branch: 'main', components: ['all'], initiator: 'lead-test', ...extra });
const restartOf = svc => (IS_MAC
  ? `launchctl kickstart -k gui/${process.getuid()}/ai.openclaw.${svc}`
  : `systemctl --user try-restart openclaw-${svc}`);

// File-level: the describes below all use ROOT's stubs and fixtures.
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('pinned-sha deploy through the listener (bare origin + node clone)', () => {
  let S1, S2, S3;

  it('bootstraps every role component when a Git clone has no deploy record', async () => {
    assert.equal(fs.existsSync(RT.state), false);
    const r = await runDeploy(trigger(S0));
    assert.equal(r.status, 'success', r.errors.join('; '));
    assert.equal(r.preSha, null);
    assert.ok(r.componentsDeployed.some(c => c.id === 'mesh-daemons'));
    assert.ok(r.componentsDeployed.some(c => c.id === 'shared-lib'));
    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v0\n');
    assert.equal(state().deployedSha, S0);
  });

  it('--force reinstalls every component at the signed sha even when nothing changed', async () => {
    const r = await runDeploy(trigger(S0, { force: true }));
    assert.equal(r.status, 'success', r.errors.join('; '));
    assert.equal(head(), S0);
    const ids = r.componentsDeployed.map(c => c.id);
    for (const id of ['mesh-daemons', 'mesh-cli', 'shared-lib', 'mc', 'skills', 'workspace-docs']) {
      assert.ok(ids.includes(id), `${id} deployed (got ${ids.join(', ')})`);
    }
    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v0\n');
    assert.equal(read(path.join(RT.skills, 'retired', 'SKILL.md')), '# retired in v1\n');
    assert.equal(state().deployedSha, S0);
    assert.equal(state().lastSha, null, 'a same-sha reinstall is not a version to roll back to');
  });

  it('deploys the diff from the last deployed sha: copies, deletions, renames, MC build, restarts', async () => {
    write(RT.workspace, 'SOUL.md', '# soul, edited on this node\n');
    fs.rmSync(CALLS, { force: true });
    write(SEED, 'bin/mesh-agent.js', '// agent v1\n');
    write(SEED, 'skills/demo/SKILL.md', '# demo v1\n');
    git(SEED, 'mv', 'skills/demo/old-name.md', 'skills/demo/new-name.md');
    git(SEED, 'rm', '-q', 'skills/retired/SKILL.md');
    write(SEED, 'workspace-docs/SOUL.md', '# soul v1\n');
    write(SEED, 'mission-control/src/app/page.tsx', "export default () => 'v1';\n");
    S1 = commit('v1');

    const r = await runDeploy(trigger(S1));
    assert.equal(r.status, 'success', r.errors.join('; '));
    assert.equal(head(), S1, 'the node checked out the signed sha');
    assert.deepEqual(r.componentsDeployed.map(c => c.id).sort(), ['mc', 'mesh-daemons', 'skills']);

    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v1\n');
    assert.equal(read(path.join(RT.skills, 'demo', 'SKILL.md')), '# demo v1\n');
    assert.ok(fs.existsSync(path.join(RT.skills, 'demo', 'new-name.md')), 'rename target installed');
    assert.ok(!fs.existsSync(path.join(RT.skills, 'demo', 'old-name.md')), 'rename source removed');
    assert.ok(!fs.existsSync(path.join(RT.skills, 'retired')), 'deleted skill removed and its empty dir pruned');
    assert.equal(read(path.join(RT.mc, 'src', 'app', 'page.tsx')), "export default () => 'v1';\n");
    assert.ok(calls().includes(`npm run build @ ${RT.mc}`), calls());
    assert.ok(calls().includes(restartOf('mesh-agent')), calls());
    assert.ok(calls().includes(restartOf('mission-control')), calls());

    assert.equal(read(path.join(RT.workspace, 'SOUL.md')), '# soul, edited on this node\n', 'preInstall veto kept the operator edit');
    assert.equal(read(path.join(RT.workspace, 'SOUL.md.repo')), '# soul v1\n');
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, S0);
  });

  it('a deploy whose daemon fails to restart rolls back to preSha and stays there', async () => {
    fs.rmSync(CALLS, { force: true });
    write(SEED, 'bin/mesh-agent.js', '// agent v2 BREAK_DEPLOY\n');
    write(SEED, 'skills/demo/SKILL.md', '# demo v2\n');
    S2 = commit('v2: its mesh-agent fails to start');

    const r = await runDeploy(trigger(S2));
    assert.equal(r.status, 'failed');
    assert.match(r.errors[0], /restart \S*mesh-agent\S* failed/);
    assert.equal(r.rolledBack, true, r.errors.join('; '));
    assert.equal(r.rollbackSha, S1.slice(0, 7));

    assert.equal(head(), S1, 'the tree is back on preSha');
    assert.equal(git(NODE, 'rev-parse', 'origin/main'), S2, 'the failed commit is still the branch tip — the rollback did not fetch its way back to it');
    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v1\n');
    assert.equal(read(path.join(RT.skills, 'demo', 'SKILL.md')), '# demo v1\n');
    assert.equal(calls().split(restartOf('mesh-agent')).length - 1, 2, 'failed restart, then the rollback restart');
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, S0, 'rolling back off a failed sha does not make it the --rollback target');
  });

  it('a run that deploys nothing leaves lastSha alone', async () => {
    const r = await runDeploy(trigger(S1));
    assert.equal(r.status, 'success', r.errors.join('; '));
    assert.deepEqual(r.componentsDeployed, []);
    assert.equal(head(), S1);
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, S0);
  });

  it('catch-up never moves a node backward', async () => {
    const r = await runDeploy(trigger(S0), { forwardOnly: true });
    assert.equal(r.status, 'skipped');
    assert.equal(head(), S1);
  });

  it('a tree the pre-fix listener already fast-forwarded still deploys the diff from the recorded sha', () => {
    write(SEED, 'bin/mesh-agent.js', '// agent v3\n');
    write(SEED, 'skills/demo/SKILL.md', '# demo v3\n');
    S3 = commit('v3');
    // What the old listener did before handing over to `mesh-deploy.js --local`.
    git(NODE, 'fetch', '-q', 'origin', 'main');
    git(NODE, 'merge', '-q', '--ff-only', 'origin/main');
    execFileSync(process.execPath, [path.join(NODE, 'bin', 'mesh-deploy.js'), '--local'], { cwd: NODE, stdio: 'pipe' });

    assert.equal(head(), S3);
    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v3\n');
    assert.equal(read(path.join(RT.skills, 'demo', 'SKILL.md')), '# demo v3\n');
    assert.equal(state().deployedSha, S3);
    assert.equal(state().lastSha, S1);
  });

  it('refuses a checkout whose tracked files differ from the signed sha, before anything moves', async () => {
    write(SEED, 'bin/mesh-agent.js', '// agent v4\n');
    const S4 = commit('v4');
    // The lead's listener runs on the operator's working checkout, at the HEAD it published.
    git(NODE, 'fetch', '-q', 'origin', 'main');
    git(NODE, 'checkout', '-q', '--detach', S4);
    write(NODE, 'bin/mesh-agent.js', '// WIP, uncommitted\n');
    try {
      const r = await runDeploy(trigger(S4));
      assert.equal(r.status, 'failed', 'an uncommitted edit is not deployed as the signed sha');
      assert.match(r.errors[0], /tracked files differ from the commit \(M bin\/mesh-agent\.js\)/);
      assert.equal(r.rolledBack, undefined, 'refused before anything was touched, so nothing to roll back');
      assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v3\n', 'the edit never reached the runtime');
      assert.equal(state().deployedSha, S3);
    } finally {
      git(NODE, 'checkout', '-q', '--', 'bin/mesh-agent.js');
      git(NODE, 'checkout', '-q', '--detach', S3);
    }
  });

  it('refuses a foreign-linked daemon before checkout without attempting rollback', async () => {
    write(HOME, 'other-checkout/memory-daemon.mjs', '// operator edit\n');
    fs.mkdirSync(path.join(RT.workspace, 'bin'), { recursive: true });
    const linked = path.join(RT.workspace, 'bin', 'memory-daemon.mjs');
    fs.symlinkSync(path.join(HOME, 'other-checkout', 'memory-daemon.mjs'), linked);
    write(SEED, 'workspace-bin/memory-daemon.mjs', '// new daemon\n');
    const target = commit('daemon update');
    try {
      const r = await runDeploy(trigger(target));
      assert.equal(r.status, 'refused');
      assert.match(r.errors[0], /points outside this deployed revision/);
      assert.equal(r.rolledBack, undefined);
      assert.equal(head(), S3);
      assert.equal(state().deployedSha, S3);
      assert.equal(read(path.join(HOME, 'other-checkout', 'memory-daemon.mjs')), '// operator edit\n');
    } finally {
      fs.rmSync(linked);
    }
  });

  it('refuses a sha that is not on origin, and a checkout carrying unpushed commits', async () => {
    const unknown = await runDeploy(trigger('0123456789abcdef0123456789abcdef01234567'));
    assert.equal(unknown.status, 'failed');
    assert.match(unknown.errors[0], /not on origin\/main/);
    assert.equal(unknown.rolledBack, undefined, 'nothing was touched, so nothing to roll back');
    assert.equal(head(), S3);

    write(NODE, 'local.txt', 'work in progress\n');
    git(NODE, 'add', 'local.txt');
    git(NODE, 'commit', '-q', '-m', 'local work');
    const local = head();
    const r = await runDeploy(trigger(S2));
    assert.equal(r.status, 'failed');
    assert.match(r.errors[0], /not on origin\/main — refusing to move this checkout/);
    assert.equal(head(), local, 'the checkout was left where it was');
  });

  it('refuses a copied source tree without Git before changing its files', async () => {
    const priorHead = head();
    const savedGit = path.join(NODE, '.git.saved');
    fs.renameSync(path.join(NODE, '.git'), savedGit);
    try {
      const before = read(path.join(NODE, 'bin', 'mesh-agent.js'));
      const r = await runDeploy(trigger(S2));
      assert.equal(r.status, 'refused');
      assert.match(r.errors[0], /no Git checkout/);
      assert.equal(r.rolledBack, undefined);
      assert.equal(read(path.join(NODE, 'bin', 'mesh-agent.js')), before);
      assert.equal(fs.existsSync(path.join(NODE, '.git')), false);
    } finally {
      fs.renameSync(savedGit, path.join(NODE, '.git'));
    }
    assert.equal(head(), priorHead);
  });

  it('bootstraps an older clean clone at a newer signed sha with no deploy record', () => {
    const bootNode = path.join(ROOT, 'bootstrap-node');
    const bootHome = path.join(ROOT, 'bootstrap-home');
    git(ROOT, 'clone', '-q', ORIGIN, bootNode);
    git(bootNode, 'checkout', '-q', '--detach', S3);
    const target = git(SEED, 'rev-parse', 'HEAD');
    const code = `require(${JSON.stringify(path.join(REPO, 'bin', 'mesh-deploy-listener.js'))}).runDeploy({sha:${JSON.stringify(target.slice(0, 7))},branch:'main',components:['all']}).then(r=>console.log('RESULTJSON '+JSON.stringify(r)))`;
    const run = spawnSync(process.execPath, ['-e', code], {
      cwd: bootNode, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, HOME: bootHome, OPENCLAW_REPO_DIR: bootNode, DEPLOY_TEST_CALLS: path.join(ROOT, 'bootstrap-calls.log') },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const outcome = JSON.parse(run.stdout.split('\n').find((line) => line.startsWith('RESULTJSON ')).slice(11));
    assert.equal(outcome.status, 'success', outcome.errors.join('; '));
    assert.equal(git(bootNode, 'rev-parse', 'HEAD'), target);
    assert.equal(JSON.parse(read(path.join(bootHome, '.openclaw', '.deploy-state.json'))).deployedSha, target);
  });

  for (const [name, deployedSha] of [
    ['null', null],
    ['unknown', 'f'.repeat(40)],
  ]) {
    it(`bootstraps an older clone whose deploy state has a ${name} sha`, () => {
      const bootNode = path.join(ROOT, `bootstrap-${name}-node`);
      const bootHome = path.join(ROOT, `bootstrap-${name}-home`);
      git(ROOT, 'clone', '-q', ORIGIN, bootNode);
      git(bootNode, 'checkout', '-q', '--detach', S3);
      write(bootHome, '.openclaw/.deploy-state.json', JSON.stringify({ deployedSha, lastSha: null, components: {} }));
      const target = git(SEED, 'rev-parse', 'HEAD');
      const code = `require(${JSON.stringify(path.join(REPO, 'bin', 'mesh-deploy-listener.js'))}).runDeploy({sha:${JSON.stringify(target.slice(0, 7))},branch:'main',components:['all']}).then(r=>console.log('RESULTJSON '+JSON.stringify(r)))`;
      const run = spawnSync(process.execPath, ['-e', code], {
        cwd: bootNode, encoding: 'utf8', timeout: 120000,
        env: { ...process.env, HOME: bootHome, OPENCLAW_REPO_DIR: bootNode, DEPLOY_TEST_CALLS: path.join(ROOT, `bootstrap-${name}-calls.log`) },
      });
      assert.equal(run.status, 0, run.stderr || run.stdout);
      const outcome = JSON.parse(run.stdout.split('\n').find((line) => line.startsWith('RESULTJSON ')).slice(11));
      assert.equal(outcome.status, 'success', outcome.errors.join('; '));
      assert.equal(outcome.preSha, null);
      assert.equal(git(bootNode, 'rev-parse', 'HEAD'), target);
      assert.equal(JSON.parse(read(path.join(bootHome, '.openclaw', '.deploy-state.json'))).deployedSha, target);
    });
  }
});

// ── Independent nodes, bin/mesh-deploy.js run directly ──────────────────────
// Each case below gets its own origin, clone and runtime HOME, and runs the
// clone's deploy script as the listener does (`--local --to <sha>`) or as
// `mesh deploy` does on the node itself (`--local`). The preload makes
// os.platform() answer DEPLOY_TEST_PLATFORM, so the launchd and the systemd
// restart paths both run on any host.
const PRELOAD = path.join(ROOT, 'platform.cjs');
write(ROOT, 'platform.cjs', "if (process.env.DEPLOY_TEST_PLATFORM) require('os').platform = () => process.env.DEPLOY_TEST_PLATFORM;\n");

function makeNode(name, files) {
  const dir = path.join(ROOT, name);
  const fx = {
    home: path.join(dir, 'home'), origin: path.join(dir, 'origin.git'), seed: path.join(dir, 'seed'),
    node: path.join(dir, 'node'), callLog: path.join(dir, 'calls.log'),
  };
  fx.rt = rel => path.join(fx.home, rel);
  fx.commit = (message, changed) => {
    for (const [rel, content] of Object.entries(changed)) write(fx.seed, rel, content);
    git(fx.seed, 'add', '-A');
    git(fx.seed, 'commit', '-q', '-m', message);
    git(fx.seed, 'push', '-q', 'origin', 'main');
    // Pinned mode never fetches: the listener brings the sha in first, and so does this.
    if (fs.existsSync(fx.node)) git(fx.node, 'fetch', '-q', 'origin', 'main');
    return git(fx.seed, 'rev-parse', 'HEAD');
  };
  fx.deploy = (args, env = {}) => spawnSync(process.execPath,
    ['--require', PRELOAD, path.join(fx.node, 'bin', 'mesh-deploy.js'), '--local', ...args], {
      cwd: fx.node, encoding: 'utf8',
      env: { ...process.env, HOME: fx.home, OPENCLAW_REPO_DIR: fx.node, DEPLOY_TEST_CALLS: fx.callLog, ...env },
    });
  // Each stub call as logged, without the " @ <cwd>" suffix.
  fx.calls = () => (fs.existsSync(fx.callLog) ? read(fx.callLog) : '').split('\n').filter(Boolean).map(l => l.split(' @ ')[0]);
  git(ROOT, 'init', '-q', '--bare', '-b', 'main', fx.origin);
  git(ROOT, 'init', '-q', '-b', 'main', fx.seed);
  git(fx.seed, 'remote', 'add', 'origin', fx.origin);
  const script = Object.fromEntries(DEPLOY_SCRIPT_FILES.map(rel => [rel, fs.readFileSync(path.join(REPO, rel))]));
  fx.S0 = fx.commit('v0', { ...script, ...files });
  git(ROOT, 'clone', '-q', fx.origin, fx.node);
  return fx;
}
const ranOk = run => assert.equal(run.status, 0, `deploy failed:\n${run.stdout}\n${run.stderr}`);
const resultOf = run => JSON.parse(run.stdout.split('\n').find(l => l.startsWith('DEPLOY_RESULT ')).slice('DEPLOY_RESULT '.length));
const fileMode = p => fs.statSync(p).mode & 0o777;

describe('first tracked schema-dist transition', () => {
  it('restores the prior generated code and runtime copies on rollback', () => {
    const fx = makeNode('schema-transition', {
      'bin/mesh-agent.js': '// agent old\n',
      'packages/event-schemas/package.json': '{ "name": "event-schemas" }\n',
    });
    write(fx.node, 'packages/event-schemas/dist/index.js', '// old generated\n');
    write(fx.home, 'openclaw/packages/event-schemas/dist/index.js', '// old runtime\n');
    write(fx.home, '.openclaw/workspace/packages/event-schemas/dist/index.js', '// old workspace\n');
    const S1 = fx.commit('track generated schemas', {
      'bin/mesh-agent.js': '// agent new\n',
      'packages/event-schemas/dist/index.js': '// new generated\n',
    });
    ranOk(fx.deploy(['--from', fx.S0, '--to', S1]));
    assert.equal(read(path.join(fx.node, 'packages/event-schemas/dist/index.js')), '// new generated\n');
    write(fx.home, 'openclaw/packages/event-schemas/dist/index.js', '// new runtime\n');
    write(fx.home, '.openclaw/workspace/packages/event-schemas/dist/index.js', '// new workspace\n');

    ranOk(fx.deploy(['--from', S1, '--to', fx.S0]));
    assert.equal(git(fx.node, 'rev-parse', 'HEAD'), fx.S0);
    assert.equal(read(path.join(fx.node, 'packages/event-schemas/dist/index.js')), '// old generated\n');
    assert.equal(read(fx.rt('openclaw/packages/event-schemas/dist/index.js')), '// old runtime\n');
    assert.equal(read(fx.rt('.openclaw/workspace/packages/event-schemas/dist/index.js')), '// old workspace\n');
  });

  it('refuses to leave the tracked version when no prior backup exists', () => {
    const fx = makeNode('schema-no-backup', {
      'bin/mesh-agent.js': '// agent old\n',
      'packages/event-schemas/package.json': '{ "name": "event-schemas" }\n',
    });
    const S1 = fx.commit('track generated schemas', {
      'bin/mesh-agent.js': '// agent new\n',
      'packages/event-schemas/dist/index.js': '// new generated\n',
    });
    git(fx.node, 'checkout', '-q', '--detach', S1);
    const run = fx.deploy(['--from', S1, '--to', fx.S0]);
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /needs its pre-schema-dist backup/);
    assert.equal(git(fx.node, 'rev-parse', 'HEAD'), S1);
  });
});

describe('listener source reload', () => {
  it('checks the new listener can load before accepting an upgrade', () => {
    const fx = makeNode('listener-load', { 'bin/mesh-agent.js': '// agent old\n' });
    ranOk(fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'all']));
    const bad = fx.commit('broken listener', { 'bin/mesh-deploy-listener.js': 'this is not JavaScript\n' });
    const code = `require(process.argv[1]).runDeploy({sha:${JSON.stringify(bad.slice(0, 7))},branch:'main',components:['all']}).then(r=>console.log('RESULTJSON '+JSON.stringify(r)))`;
    const run = spawnSync(process.execPath, ['-e', code, path.join(fx.node, 'bin/mesh-deploy-listener.js')], {
      cwd: fx.node, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, HOME: fx.home, OPENCLAW_REPO_DIR: fx.node, DEPLOY_TEST_CALLS: fx.callLog },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.split('\n').find(line => line.startsWith('RESULTJSON ')).slice(11));
    assert.equal(result.status, 'failed');
    assert.match(result.errors[0], /new deploy listener cannot load/);
    assert.equal(result.rolledBack, true, result.errors.join('; '));
    assert.equal(git(fx.node, 'rev-parse', 'HEAD'), fx.S0);
    assert.match(read(path.join(fx.home, 'openclaw', 'bin', 'mesh-deploy-listener.js')), /function validateFreshListener/);
  });
});

describe('listener rollback across schema tracking', () => {
  it('restores the old generated tree after a failed signed upgrade', () => {
    const fx = makeNode('listener-schema-rollback', {
      'bin/mesh-agent.js': '// agent old\n',
      'packages/event-schemas/package.json': '{ "name": "event-schemas" }\n',
    });
    write(fx.node, 'packages/event-schemas/dist/index.js', '// old generated\n');
    write(fx.home, '.openclaw/workspace/packages/event-schemas/dist/index.js', '// old workspace\n');
    if (IS_MAC) write(fx.home, 'Library/LaunchAgents/ai.openclaw.mesh-agent.plist', '<plist/>\n');
    ranOk(fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'all']));
    const bad = fx.commit('track schemas and fail service', {
      'bin/mesh-agent.js': '// BREAK_DEPLOY\n',
      'packages/event-schemas/dist/index.js': '// new generated\n',
    });
    const code = `require(process.argv[1]).runDeploy({sha:${JSON.stringify(bad.slice(0, 7))},branch:'main',components:['all']}).then(r=>console.log('RESULTJSON '+JSON.stringify(r)))`;
    const run = spawnSync(process.execPath, ['-e', code, path.join(fx.node, 'bin/mesh-deploy-listener.js')], {
      cwd: fx.node, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, HOME: fx.home, OPENCLAW_REPO_DIR: fx.node, DEPLOY_TEST_CALLS: fx.callLog },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout.split('\n').find(line => line.startsWith('RESULTJSON ')).slice(11));
    assert.equal(result.status, 'failed');
    assert.equal(result.rolledBack, true, result.errors.join('; '));
    assert.equal(git(fx.node, 'rev-parse', 'HEAD'), fx.S0);
    assert.equal(read(path.join(fx.node, 'packages/event-schemas/dist/index.js')), '// old generated\n');
    assert.equal(read(fx.rt('.openclaw/workspace/packages/event-schemas/dist/index.js')), '// old workspace\n');
  });
});

describe('`mesh deploy --force` on a live node leaves what the node owns alone', () => {
  // A worker (Mission Control, whose build runs npm, is lead-only) with a live
  // node's state: an operator-configured openclaw.json, learned soul genes and
  // events, and a repo that carries a quarantined skill.
  const LIVE_CONFIG = '{"gateway":"configured on this node: channels, tokens, auth profiles"}\n';
  const LEARNED_GENES = '{"genes":"learned on this node"}\n';
  const LEARNED_EVENTS = '{"event":"learned on this node"}\n';
  let fx, run;
  before(() => {
    fx = makeNode('force', {
      'bin/mesh-agent.js': '// agent v0\n',
      'config/openclaw.json.template': '{"workspace":"${OPENCLAW_WORKSPACE}"}\n',
      'souls/daedalus/evolution/genes.json': '{"genes":"seed"}\n',
      'souls/daedalus/evolution/events.jsonl': '{"event":"seed"}\n',
      'souls/newcomer/evolution/genes.json': '{"genes":"newcomer seed"}\n',
      'skills/demo/SKILL.md': '# demo\n',
      'skills/_quarantine/memorylayer/SKILL.md': '# quarantined: ships memory to a SaaS\n',
    });
    write(fx.home, '.openclaw/openclaw.json', LIVE_CONFIG);
    write(fx.home, '.openclaw/openclaw.env', 'DISCORD_BOT_TOKEN=discord-fixture\n');
    write(fx.home, '.openclaw/souls/daedalus/evolution/genes.json', LEARNED_GENES);
    write(fx.home, '.openclaw/souls/daedalus/evolution/events.jsonl', LEARNED_EVENTS);
    // The fetching flow: what `mesh deploy --force` runs on the node itself,
    // and what the pre-fix listener ran for every trigger.
    run = fx.deploy(['--force'], { OPENCLAW_NODE_ROLE: 'worker' });
  });

  it('reinstalls the node and succeeds', () => {
    ranOk(run);
    assert.equal(read(fx.rt('.openclaw/skills/demo/SKILL.md')), '# demo\n');
  });

  it('leaves openclaw.json alone when its template did not change: no rewrite, no backup', () => {
    assert.equal(read(fx.rt('.openclaw/openclaw.json')), LIVE_CONFIG);
    assert.deepEqual(fs.readdirSync(fx.rt('.openclaw')).filter(f => f.startsWith('openclaw.json.bak')), []);
  });

  it('never overwrites learned soul genes or events, and seeds a soul that has none', () => {
    assert.equal(read(fx.rt('.openclaw/souls/daedalus/evolution/genes.json')), LEARNED_GENES);
    assert.equal(read(fx.rt('.openclaw/souls/daedalus/evolution/events.jsonl')), LEARNED_EVENTS);
    assert.equal(read(fx.rt('.openclaw/souls/newcomer/evolution/genes.json')), '{"genes":"newcomer seed"}\n');
  });

  it('never installs skills/_quarantine', () => {
    assert.ok(!fs.existsSync(fx.rt('.openclaw/skills/_quarantine')), 'the quarantined skill reached the node');
  });

  it('never runs npm or the openclaw CLI: no implicit, unpinned CLI update', () => {
    assert.deepEqual(fx.calls().filter(l => /^(npm|openclaw) /.test(l)), []);
  });
});

describe('openclaw.json is rewritten only from a changed template, rendered as the installer renders it', () => {
  const LIVE_CONFIG = '{"gateway":"configured on this node"}\n';
  const TEMPLATE = v => `{"workspace":"\${OPENCLAW_WORKSPACE}","token":"\${DISCORD_BOT_TOKEN}","unset":"\${DEPLOY_TEST_UNSET}","v":${v}}\n`;
  let fx, S1, S2;
  const config = () => fx.rt('.openclaw/openclaw.json');
  const backups = () => fs.readdirSync(fx.rt('.openclaw')).filter(f => f.startsWith('openclaw.json.bak.'));
  before(() => {
    fx = makeNode('config', { 'config/openclaw.json.template': TEMPLATE(0), 'config/harness-rules.json': '{"v":0}\n' });
    // An earlier deploy installed the template; the operator has since configured the gateway.
    write(fx.home, '.openclaw/config/openclaw.json.template', TEMPLATE(0));
    write(fx.home, '.openclaw/openclaw.json', LIVE_CONFIG);
    write(fx.home, '.openclaw/openclaw.env', '# node secrets\nDISCORD_BOT_TOKEN="discord-fixture"\n');
  });

  it('a diff that changes another config/ file leaves openclaw.json alone', () => {
    S1 = fx.commit('v1: harness rules', { 'config/harness-rules.json': '{"v":1}\n' });
    ranOk(fx.deploy(['--from', fx.S0, '--to', S1]));
    assert.equal(read(config()), LIVE_CONFIG);
    assert.deepEqual(backups(), []);
  });

  it('a diff that changes the template re-renders it, after a timestamped 0600 backup', () => {
    S2 = fx.commit('v2: template', { 'config/openclaw.json.template': TEMPLATE(2) });
    ranOk(fx.deploy(['--from', S1, '--to', S2]));
    const text = read(config());
    assert.ok(!text.includes('${'), `a placeholder was left in: ${text}`);
    assert.deepEqual(JSON.parse(text), { workspace: fx.rt('.openclaw/workspace'), token: 'discord-fixture', unset: '', v: 2 });
    assert.equal(fileMode(config()), 0o600);
    assert.equal(backups().length, 1);
    const backup = fx.rt(path.join('.openclaw', backups()[0]));
    assert.equal(read(backup), LIVE_CONFIG);
    assert.equal(fileMode(backup), 0o600);
  });

  it('a missing openclaw.json is generated by a same-sha reinstall', () => {
    fs.rmSync(config());
    ranOk(fx.deploy(['--from', S2, '--to', S2, '--force']));
    assert.equal(JSON.parse(read(config())).workspace, fx.rt('.openclaw/workspace'));
    assert.equal(fileMode(config()), 0o600);
    assert.equal(backups().length, 1, 'nothing existed to back up');
  });
});

describe('the openclaw CLI is installed only when named, and only at a pinned version', () => {
  let fx;
  before(() => { fx = makeNode('openclaw-cli', { 'bin/mesh-agent.js': '// agent v0\n' }); });

  it('`--component openclaw` refuses without an exact OPENCLAW_CLI_VERSION', () => {
    for (const version of [undefined, 'latest', '^1.2.0']) {
      const run = fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'openclaw'], { OPENCLAW_CLI_VERSION: version });
      assert.equal(run.status, 1, `OPENCLAW_CLI_VERSION=${version}:\n${run.stdout}`);
      assert.match(run.stdout, /DEPLOY_ERROR .*OPENCLAW_CLI_VERSION/);
    }
    assert.deepEqual(fx.calls().filter(l => l.startsWith('npm ')), []);
  });

  it('installs exactly the pinned version', () => {
    ranOk(fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'openclaw'], { OPENCLAW_CLI_VERSION: '2026.9.1' }));
    assert.deepEqual(fx.calls().filter(l => l.startsWith('npm ')), ['npm install -g openclaw@2026.9.1']);
  });
});

describe('a deploy restarts only the services that are running', () => {
  let fx, S1;
  before(() => {
    fx = makeNode('restart', { 'bin/mesh-agent.js': '// agent v0\n' });
    for (const label of ['ai.openclaw.mesh-agent', 'ai.openclaw.mesh-health-publisher']) {
      write(fx.home, `Library/LaunchAgents/${label}.plist`, '<plist/>\n');
    }
  });

  it('systemd: an inactive unit is left stopped, a running one gets try-restart', () => {
    S1 = fx.commit('v1', { 'bin/mesh-agent.js': '// agent v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], {
      DEPLOY_TEST_PLATFORM: 'linux',
      DEPLOY_TEST_UNITS: 'openclaw-mesh-agent openclaw-mesh-health-publisher',
      DEPLOY_TEST_STOPPED: 'openclaw-mesh-agent', // autostart:false — the operator starts it
    });
    ranOk(run);
    const systemctl = fx.calls().filter(l => l.startsWith('systemctl '));
    assert.ok(systemctl.includes('systemctl --user try-restart openclaw-mesh-health-publisher'), systemctl.join('\n'));
    assert.deepEqual(systemctl.filter(l => /start openclaw-mesh-agent$/.test(l)), [], 'the stopped unit was started');
    assert.match(run.stdout, /openclaw-mesh-agent not running \(inactive\) — left stopped/);
    assert.doesNotMatch(run.stdout, /Restarted openclaw-mesh-agent/);
    assert.deepEqual(resultOf(run).restarted, ['openclaw-mesh-health-publisher']);
  });

  it('launchd: a stopped agent is neither loaded nor kickstarted, a running one gets kickstart -k', () => {
    fs.rmSync(fx.callLog, { force: true });
    const S2 = fx.commit('v2', { 'bin/mesh-agent.js': '// agent v2\n' });
    const run = fx.deploy(['--from', S1, '--to', S2], {
      DEPLOY_TEST_PLATFORM: 'darwin',
      DEPLOY_TEST_STOPPED: 'ai.openclaw.mesh-agent', // RunAtLoad=false, not started by hand
    });
    ranOk(run);
    const uid = process.getuid();
    const launchctl = fx.calls().filter(l => l.startsWith('launchctl '));
    assert.ok(launchctl.includes(`launchctl kickstart -k gui/${uid}/ai.openclaw.mesh-health-publisher`), launchctl.join('\n'));
    assert.deepEqual(launchctl.filter(l => /^launchctl (load|unload) /.test(l)), [], 'unload/load kills a hand-started agent');
    assert.ok(!launchctl.includes(`launchctl kickstart -k gui/${uid}/ai.openclaw.mesh-agent`), 'the stopped agent was started');
    assert.match(run.stdout, /ai\.openclaw\.mesh-agent not running — left stopped/);
    assert.deepEqual(resultOf(run).restarted, ['ai.openclaw.mesh-health-publisher']);
  });
});

describe('shared library deploy reaches workspace daemons', () => {
  it('updates both runtime lib trees and restarts a running memory daemon', () => {
    const fx = makeNode('workspace-lib', {});
    write(fx.home, '.openclaw/workspace/lib/tracer.js', '// stale tracer\n');
    const S1 = fx.commit('lib update', { 'lib/runtime-helper.mjs': '// helper v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], {
      DEPLOY_TEST_PLATFORM: 'linux',
      DEPLOY_TEST_UNITS: 'openclaw-memory-daemon',
    });
    ranOk(run);
    assert.equal(read(fx.rt('openclaw/lib/runtime-helper.mjs')), '// helper v1\n');
    assert.equal(read(fx.rt('.openclaw/workspace/lib/runtime-helper.mjs')), '// helper v1\n');
    assert.equal(read(fx.rt('.openclaw/workspace/lib/tracer.js')), read(path.join(REPO, 'lib/tracer.js')));
    assert.ok(fx.calls().includes('systemctl --user try-restart openclaw-memory-daemon'));

    write(fx.home, 'Library/LaunchAgents/ai.openclaw.memory-daemon.plist', '<plist/>\n');
    fs.rmSync(fx.callLog, { force: true });
    const S2 = fx.commit('lib update again', { 'lib/runtime-helper.mjs': '// helper v2\n' });
    const macRun = fx.deploy(['--from', S1, '--to', S2], { DEPLOY_TEST_PLATFORM: 'darwin' });
    ranOk(macRun);
    assert.equal(read(fx.rt('.openclaw/workspace/lib/runtime-helper.mjs')), '// helper v2\n');
    assert.ok(fx.calls().some((call) => call.startsWith('launchctl kickstart -k ') && call.endsWith('/ai.openclaw.memory-daemon')));
  });

  it('refuses a workspace lib symlink into a different checkout before copying', () => {
    const fx = makeNode('foreign-workspace-lib', {});
    write(fx.home, 'other-checkout/lib/sentinel.mjs', '// untouched\n');
    fs.mkdirSync(fx.rt('.openclaw/workspace'), { recursive: true });
    fs.symlinkSync(fx.rt('other-checkout/lib'), fx.rt('.openclaw/workspace/lib'));
    const S1 = fx.commit('new shared module', { 'lib/runtime-helper.mjs': '// helper v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /points outside this deployed revision/);
    assert.equal(read(fx.rt('other-checkout/lib/sentinel.mjs')), '// untouched\n');
    assert.equal(fs.existsSync(fx.rt('other-checkout/lib/runtime-helper.mjs')), false);
    assert.equal(fs.existsSync(fx.rt('openclaw/lib/runtime-helper.mjs')), false);
  });

  it('refuses an individual shared-lib file linked into a different checkout', () => {
    const fx = makeNode('foreign-workspace-file', { 'lib/runtime-helper.mjs': '// helper v0\n' });
    write(fx.home, 'other-checkout/runtime-helper.mjs', '// untouched\n');
    fs.mkdirSync(fx.rt('.openclaw/workspace/lib'), { recursive: true });
    fs.symlinkSync(fx.rt('other-checkout/runtime-helper.mjs'), fx.rt('.openclaw/workspace/lib/runtime-helper.mjs'));
    const S1 = fx.commit('update shared module', { 'lib/runtime-helper.mjs': '// helper v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /points outside this deployed revision/);
    assert.equal(read(fx.rt('other-checkout/runtime-helper.mjs')), '// untouched\n');
    assert.equal(fs.existsSync(fx.rt('openclaw/lib/runtime-helper.mjs')), false);
  });

  it('refuses a deleted shared-lib file linked into a different checkout before other copies', () => {
    const fx = makeNode('foreign-deleted-file', { 'lib/runtime-helper.mjs': '// helper v0\n' });
    write(fx.home, 'other-checkout/runtime-helper.mjs', '// helper v0\n');
    fs.mkdirSync(fx.rt('.openclaw/workspace/lib'), { recursive: true });
    fs.symlinkSync(fx.rt('other-checkout/runtime-helper.mjs'), fx.rt('.openclaw/workspace/lib/runtime-helper.mjs'));
    fs.rmSync(path.join(fx.seed, 'lib/runtime-helper.mjs'));
    const S1 = fx.commit('delete shared module', {});
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /points outside this deployed revision/);
    assert.equal(read(fx.rt('other-checkout/runtime-helper.mjs')), '// helper v0\n');
    assert.equal(fs.existsSync(fx.rt('openclaw/lib/tracer.js')), false);
  });

  it('refuses a nested shared-lib directory linked into a different checkout', () => {
    const fx = makeNode('foreign-nested-dir', {});
    write(fx.home, 'other-checkout/isolated/sentinel.mjs', '// untouched\n');
    fs.mkdirSync(fx.rt('.openclaw/workspace/lib'), { recursive: true });
    fs.symlinkSync(fx.rt('other-checkout/isolated'), fx.rt('.openclaw/workspace/lib/isolated'));
    const S1 = fx.commit('new nested module', { 'lib/isolated/helper.mjs': '// helper v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /points outside this deployed revision/);
    assert.equal(read(fx.rt('other-checkout/isolated/sentinel.mjs')), '// untouched\n');
    assert.equal(fs.existsSync(fx.rt('other-checkout/isolated/helper.mjs')), false);
    assert.equal(fs.existsSync(fx.rt('openclaw/lib/tracer.js')), false);
  });

  it('refuses a symlinked parent of workspace/lib', () => {
    const fx = makeNode('foreign-workspace-parent', {});
    write(fx.home, 'other-checkout/sentinel.mjs', '// untouched\n');
    fs.mkdirSync(fx.rt('.openclaw'), { recursive: true });
    fs.symlinkSync(fx.rt('other-checkout'), fx.rt('.openclaw/workspace'));
    const S1 = fx.commit('lib update', { 'lib/runtime-helper.mjs': '// helper v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr + run.stdout, /points outside this deployed revision/);
    assert.equal(read(fx.rt('other-checkout/sentinel.mjs')), '// untouched\n');
    assert.equal(fs.existsSync(fx.rt('openclaw/lib/runtime-helper.mjs')), false);
  });

  it('replaces a hard-linked destination without changing its other name', () => {
    const fx = makeNode('hard-linked-lib', {});
    write(fx.home, 'other-checkout/tracer.js', '// operator edit\n');
    fs.mkdirSync(fx.rt('.openclaw/workspace/lib'), { recursive: true });
    fs.linkSync(fx.rt('other-checkout/tracer.js'), fx.rt('.openclaw/workspace/lib/tracer.js'));
    const S1 = fx.commit('lib update', { 'lib/runtime-helper.mjs': '// helper v1\n' });
    ranOk(fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux' }));
    assert.equal(read(fx.rt('other-checkout/tracer.js')), '// operator edit\n');
    assert.equal(read(fx.rt('.openclaw/workspace/lib/tracer.js')), read(path.join(REPO, 'lib/tracer.js')));
  });
});

describe('a deploy installs the commit, never the working tree', () => {
  let fx, S1;
  const nodeHead = () => git(fx.node, 'rev-parse', 'HEAD');
  before(() => {
    fx = makeNode('dirty', { 'bin/mesh-agent.js': '// agent v0\n', 'skills/demo/SKILL.md': '# demo v0\n' });
    ranOk(fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'all']));
    S1 = fx.commit('v1', { 'bin/mesh-agent.js': '// agent v1\n' });
  });

  it('`mesh deploy` refuses a tracked edit before fast-forwarding, and installs nothing', () => {
    // Unchanged S0 → S1, so a fast-forward would carry it and --force would install it.
    write(fx.node, 'skills/demo/SKILL.md', '# demo, edited in the checkout\n');
    try {
      const run = fx.deploy(['--force']);
      assert.equal(run.status, 1, run.stdout);
      assert.match(run.stdout, /DEPLOY_ERROR .*tracked files in .* differ from the commit \(M skills\/demo\/SKILL\.md\)/);
      assert.equal(nodeHead(), fx.S0, 'the branch was not fast-forwarded');
      assert.equal(read(fx.rt('.openclaw/skills/demo/SKILL.md')), '# demo v0\n');
      assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v0\n');
    } finally {
      git(fx.node, 'checkout', '-q', '--', 'skills/demo/SKILL.md');
    }
  });

  it('a pinned deploy refuses an uncommitted edit at the target sha; untracked files and mode-only changes do not block', () => {
    git(fx.node, 'checkout', '-q', '--detach', S1);
    write(fx.node, 'bin/mesh-agent.js', '// WIP, uncommitted\n');
    const refused = fx.deploy(['--from', fx.S0, '--to', S1]);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stdout, /DEPLOY_ERROR .*differ from the commit \(M bin\/mesh-agent\.js\)/);
    assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v0\n', 'the WIP edit reached the runtime');
    assert.equal(JSON.parse(read(fx.rt('.openclaw/.deploy-state.json'))).deployedSha, fx.S0);

    git(fx.node, 'checkout', '-q', '--', 'bin/mesh-agent.js');
    write(fx.node, 'notes/scratch.txt', 'untracked — nothing installs it\n');
    fs.chmodSync(path.join(fx.node, 'skills', 'demo', 'SKILL.md'), 0o755); // as the installer's chmod +x does
    ranOk(fx.deploy(['--from', fx.S0, '--to', S1]));
    assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v1\n');
  });
});
