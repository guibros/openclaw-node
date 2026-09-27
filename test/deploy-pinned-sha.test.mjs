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
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
const broken = 'grep -q BREAK_DEPLOY "$OPENCLAW_REPO_DIR/bin/mesh-agent.js" 2>/dev/null';
stub('systemctl', `case "$*" in
  *LoadState*) for u in $DEPLOY_TEST_UNITS; do [ "$u" = "$6" ] && { echo loaded; exit 0; }; done; echo not-found; exit 0 ;;
  *is-active*) echo active; exit 0 ;;
esac
if ${broken}; then echo "Job for $3.service failed" >&2; exit 1; fi`);
stub('launchctl', `if [ "$1" = load ] && ${broken}; then echo "Load failed: 5: Input/output error" >&2; exit 1; fi`);
stub('npm', 'exit 0');
if (IS_MAC) {
  for (const label of ['ai.openclaw.mesh-agent', 'ai.openclaw.mission-control']) {
    write(HOME, `Library/LaunchAgents/${label}.plist`, '<plist/>\n');
  }
}

git(ROOT, 'init', '-q', '--bare', '-b', 'main', ORIGIN);
git(ROOT, 'init', '-q', '-b', 'main', SEED);
git(SEED, 'remote', 'add', 'origin', ORIGIN);
for (const rel of ['bin/mesh-deploy.js', 'lib/tracer.js', 'lib/obs-db.js']) {
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
  ? `launchctl load ${path.join(HOME, 'Library', 'LaunchAgents', `ai.openclaw.${svc}.plist`)}`
  : `systemctl --user restart openclaw-${svc}`);

describe('pinned-sha deploy through the listener (bare origin + node clone)', () => {
  let S1, S2, S3;
  after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

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
});
