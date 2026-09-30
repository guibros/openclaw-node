'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA_PATH = 'packages/event-schemas/dist';

function git(repoDir, ...args) {
  return execFileSync('git', args, {
    cwd: repoDir, encoding: 'utf8', timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tracksDist(repoDir, sha) {
  return !!git(repoDir, 'ls-tree', '-r', '--name-only', sha, '--', SCHEMA_PATH);
}

function locations(repoDir) {
  const repo = fs.realpathSync(repoDir);
  const runtimeRepo = path.join(os.homedir(), 'openclaw');
  const sameRuntimeRepo = fs.existsSync(runtimeRepo) && fs.realpathSync(runtimeRepo) === repo;
  return [
    { id: 'repo-dist', file: path.join(repo, SCHEMA_PATH) },
    ...(!sameRuntimeRepo ? [{ id: 'runtime-package', file: path.join(runtimeRepo, 'packages', 'event-schemas') }] : []),
    { id: 'workspace-package', file: path.join(os.homedir(), '.openclaw', 'workspace', 'packages', 'event-schemas') },
  ];
}

function backupPath(fromSha, toSha) {
  return path.join(os.homedir(), '.openclaw', '.schema-deploy-backups', `${fromSha}-${toSha}`);
}

function saveBeforeTracking(repoDir, fromSha, toSha) {
  const backup = backupPath(fromSha, toSha);
  const sites = locations(repoDir);
  const repoDistExists = fs.existsSync(sites[0].file);
  if (!repoDistExists && fs.existsSync(backup)) return backup;

  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(`${backup}.tmp-`);
  try {
    const entries = [];
    for (const { id, file } of sites) {
      const exists = fs.existsSync(file);
      if (exists) {
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`schema rollback source ${file} is a symlink`);
        fs.cpSync(file, path.join(temporary, id), { recursive: true });
      }
      entries.push({ id, file, exists });
    }
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify({ fromSha, toSha, entries }));
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
    fs.renameSync(temporary, backup);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
  }
  return backup;
}

function loadBackup(repoDir, fromSha, toSha) {
  const backup = backupPath(fromSha, toSha);
  if (!fs.existsSync(backup)) {
    throw new Error(`rollback to ${fromSha.slice(0, 7)} needs its pre-schema-dist backup at ${backup}`);
  }
  const saved = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'));
  if (saved.fromSha !== fromSha || saved.toSha !== toSha) throw new Error('schema rollback backup identifies a different transition');
  const expected = locations(repoDir);
  if (saved.entries.length !== expected.length || saved.entries.some((entry, i) =>
    entry.id !== expected[i].id || entry.file !== expected[i].file || typeof entry.exists !== 'boolean')) {
    throw new Error('schema rollback backup paths do not match this node');
  }
  return { backup, entries: saved.entries };
}

function restoreEntry(backup, entry) {
  const { id, file, exists } = entry;
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`schema rollback target ${file} is a symlink`);
    fs.rmSync(file, { recursive: true });
  }
  if (exists) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.cpSync(path.join(backup, id), file, { recursive: true });
  }
}

function moveToSha(repoDir, toSha, { fastForward = false } = {}) {
  const fromSha = git(repoDir, 'rev-parse', 'HEAD');
  if (fromSha === toSha) return;
  const startsTracking = !tracksDist(repoDir, fromSha) && tracksDist(repoDir, toSha);
  const stopsTracking = tracksDist(repoDir, fromSha) && !tracksDist(repoDir, toSha);
  let backup = null;
  if (startsTracking) {
    backup = saveBeforeTracking(repoDir, fromSha, toSha);
    const dist = path.join(fs.realpathSync(repoDir), SCHEMA_PATH);
    if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true });
  }
  const restore = stopsTracking ? loadBackup(repoDir, toSha, fromSha) : null;
  try {
    if (fastForward) git(repoDir, 'merge', '--ff-only', '--quiet', toSha);
    else git(repoDir, 'checkout', '--detach', '--quiet', toSha);
  } catch (error) {
    if (backup) {
      const original = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8')).entries[0];
      restoreEntry(backup, original);
    }
    throw error;
  }
  if (restore) {
    for (const entry of restore.entries) restoreEntry(restore.backup, entry);
  }
}

module.exports = { moveToSha };
