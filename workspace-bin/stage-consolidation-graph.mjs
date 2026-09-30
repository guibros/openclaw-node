#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = 'bin/consolidation-scheduler.mjs';
const notification = 'bin/openclaw-notify.mjs';
const manifestName = 'consolidation-graph.json';

function sha(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function within(dir, file) {
  const rel = path.relative(dir, file);
  return rel && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...opts });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function files(dir) {
  const found = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error(`symlink in private release: ${file}`);
    if (item.isDirectory()) found.push(...files(file));
    else if (item.isFile()) {
      assert.equal(fs.statSync(file).nlink, 1, `linked file in release: ${file}`);
      found.push(file);
    }
  }
  return found.sort();
}

function recorded(dir, selected) {
  return Object.fromEntries(selected.map(file => [path.relative(dir, file), sha(file)]));
}

function resolvedLocal(spec, source) {
  const resolver = createRequire(source);
  return resolver.resolve(spec);
}

export function scanGraph(release, typescript) {
  const stack = [path.join(release, entry), path.join(release, notification)];
  const seen = new Set();
  const edges = [];
  const computed = [];
  const bare = new Map();
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    assert.ok(within(release, file), `source escapes release: ${file}`);
    assert.ok(fs.existsSync(file), `missing source: ${file}`);
    seen.add(file);
    const content = fs.readFileSync(file, 'utf8');
    const ast = typescript.createSourceFile(file, content, typescript.ScriptTarget.Latest, true);
    const visit = node => {
      let spec;
      let kind;
      if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) && node.moduleSpecifier) {
        spec = node.moduleSpecifier.text;
        kind = 'module';
      } else if (typescript.isCallExpression(node)) {
        const expression = node.expression;
        if (expression.kind === typescript.SyntaxKind.ImportKeyword) kind = 'dynamic-import';
        else if (typescript.isIdentifier(expression) && ['require', '_require'].includes(expression.text)) kind = 'require';
        if (kind) {
          const arg = node.arguments[0];
          if (arg && typescript.isStringLiteral(arg)) spec = arg.text;
          else computed.push({ file: path.relative(release, file), kind, offset: node.pos });
        }
      }
      if (spec) {
        if (!spec.startsWith('node:')) {
          const target = resolvedLocal(spec, file);
          if (spec.startsWith('.') || spec.startsWith('/')) {
            assert.ok(within(release, target), `local import escapes release: ${file} -> ${target}`);
            stack.push(target);
          } else if (!target.startsWith('node:') && target !== spec) {
            assert.ok(within(path.join(release, 'node_modules'), target), `package escapes release: ${file} -> ${target}`);
            bare.set(spec, target);
          }
          edges.push({ from: path.relative(release, file), kind, spec, to: target.startsWith(release) ? path.relative(release, target) : target });
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(computed, [], 'computed module resolution needs an explicit graph edge');
  const scheduler = fs.readFileSync(path.join(release, entry), 'utf8');
  assert.match(scheduler, /NOTIFY_CLI\s*=\s*path\.join\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), 'openclaw-notify\.mjs'\)/);
  assert.match(scheduler, /execFile\(process\.execPath, \[/);
  return { sources: [...seen].sort().map(file => path.relative(release, file)), edges, packages: Object.fromEntries(bare), child: { executable: 'process.execPath', script: notification, foreground: true } };
}

function checkLock(release) {
  const sourceLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  const stageLock = JSON.parse(fs.readFileSync(path.join(release, 'package-lock.json')));
  const sourceByName = new Map();
  for (const [key, value] of Object.entries(sourceLock.packages)) {
    if (!key.startsWith('node_modules/')) continue;
    const name = key.slice(key.lastIndexOf('node_modules/') + 13);
    sourceByName.set(name, [...(sourceByName.get(name) || []), value]);
  }
  const checked = {};
  for (const [key, value] of Object.entries(stageLock.packages)) {
    if (!key.includes('node_modules/')) continue;
    const name = key.slice(key.lastIndexOf('node_modules/') + 13);
    const priors = sourceByName.get(name) || [];
    assert.ok(priors.some(prior => prior.version === value.version && prior.integrity === value.integrity), `dependency lock drift: ${name}@${value.version}`);
    checked[name] = { version: value.version, integrity: value.integrity };
  }
  return checked;
}

export function verifyRelease(release, nodeBinary) {
  const ts = createRequire(path.join(release, 'package.json'))('typescript');
  const graph = scanGraph(release, ts);
  const native = files(path.join(release, 'node_modules')).filter(file => file.endsWith('.node'));
  assert.equal(native.length, 1, `expected one native addon, got ${native.length}`);
  const nativeProbe = run(nodeBinary, ['-e', "const D=require('better-sqlite3'); const db=new D(':memory:'); console.log(JSON.stringify({abi:process.versions.modules, sqlite:db.prepare('select sqlite_version() v').get().v})); db.close()"], { cwd: release, env: { HOME: os.tmpdir(), PATH: path.dirname(nodeBinary) + ':/usr/bin:/bin' } });
  const node = { path: fs.realpathSync(nodeBinary), sha256: sha(nodeBinary), ...JSON.parse(nativeProbe) };
  assert.equal(node.abi, '127', 'release requires launchd Node 22 ABI');
  const dependencyFiles = files(path.join(release, 'node_modules'));
  const sourceFiles = [path.join(release, 'package.json'), ...files(path.join(release, 'bin')), ...files(path.join(release, 'lib')), ...files(path.join(release, 'packages'))];
  const dependencies = checkLock(release);
  const manifest = {
    version: 1,
    entry,
    node,
    graph,
    native: { file: path.relative(release, native[0]), sha256: sha(native[0]) },
    dependencies,
    source: recorded(release, sourceFiles),
    installed: recorded(release, dependencyFiles),
    lockSha256: sha(path.join(release, 'package-lock.json')),
  };
  const manifestPath = path.join(release, manifestName);
  if (fs.existsSync(manifestPath)) {
    assert.deepEqual(manifest, JSON.parse(fs.readFileSync(manifestPath, 'utf8')), 'private release drift');
  } else {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  }
  return manifest;
}

export function stageRelease(output, nodeBinary) {
  assert.ok(path.isAbsolute(output), 'output must be absolute');
  assert.ok(!fs.existsSync(output), 'release path already exists');
  const parent = fs.realpathSync(path.dirname(output));
  for (const forbidden of [root, path.join(os.homedir(), '.openclaw/workspace'), path.join(os.homedir(), 'openclaw')]) {
    if (fs.existsSync(forbidden)) {
      const real = fs.realpathSync(forbidden);
      assert.ok(parent !== real && !within(real, parent), `release would alter a shared tree: ${forbidden}`);
    }
  }
  assert.ok(fs.existsSync(nodeBinary), `missing Node binary ${nodeBinary}`);
  fs.mkdirSync(output, { mode: 0o700 });
  try {
    const tracked = run('git', ['ls-files', '-z', '--', 'bin', 'lib', 'packages/event-schemas/src', 'packages/event-schemas/package.json', 'packages/event-schemas/tsconfig.json'], { cwd: root }).split('\0').filter(Boolean);
    for (const rel of tracked) {
      const from = path.join(root, rel);
      assert.ok(fs.statSync(from).isFile() && !fs.lstatSync(from).isSymbolicLink(), `source is not a regular file: ${rel}`);
      const to = path.join(output, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    fs.copyFileSync(path.join(root, 'workspace-bin/consolidation-graph-package.json'), path.join(output, 'package.json'));
    fs.copyFileSync(path.join(root, 'workspace-bin/consolidation-graph-package-lock.json'), path.join(output, 'package-lock.json'));
    const npm = path.join(path.dirname(nodeBinary), 'npm');
    assert.ok(fs.existsSync(npm), `missing npm beside Node: ${npm}`);
    const env = { HOME: os.tmpdir(), PATH: `${path.dirname(nodeBinary)}:/opt/homebrew/bin:/usr/bin:/bin`, npm_config_cache: path.join(output, '.npm-cache') };
    run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: output, env, timeout: 180000 });
    fs.rmSync(path.join(output, '.npm-cache'), { recursive: true, force: true });
    const tsc = path.join(output, 'node_modules/typescript/bin/tsc');
    const build = () => run(nodeBinary, [tsc, '-p', 'packages/event-schemas/tsconfig.json'], { cwd: output, env, timeout: 60000 });
    build();
    const dist = path.join(output, 'packages/event-schemas/dist');
    const first = recorded(output, files(dist));
    fs.rmSync(dist, { recursive: true });
    build();
    assert.deepEqual(recorded(output, files(dist)), first, 'schema compiler output is not reproducible');
    fs.rmSync(path.join(output, 'node_modules/.bin'), { recursive: true, force: true });
    return verifyRelease(fs.realpathSync(output), nodeBinary);
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  const nodeBinary = process.argv[3] || '/opt/homebrew/Cellar/node@22/22.22.0/bin/node';
  try {
    const manifest = stageRelease(output, nodeBinary);
    console.log(JSON.stringify({ release: output, node: manifest.node, sources: manifest.graph.sources.length, packages: Object.keys(manifest.dependencies).length, generated: Object.keys(manifest.source).filter(p => p.startsWith('packages/event-schemas/dist/')).length, native: manifest.native, manifest: path.join(output, manifestName) }));
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
