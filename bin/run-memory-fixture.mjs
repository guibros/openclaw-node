#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const natsServer = [process.env.ACCEPT_NATS_SERVER,
  ...(process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, 'nats-server')),
  '/opt/homebrew/bin/nats-server', '/usr/local/bin/nats-server']
  .filter(Boolean).find((candidate) => {
    try { fsSync.accessSync(candidate, fsSync.constants.X_OK); return fsSync.statSync(candidate).isFile(); }
    catch { return false; }
  });
const nonce = randomBytes(8).toString('hex');
const name = `acc-${nonce}`;
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-memory-fixture-'));
await fs.chmod(home, 0o700);
const root = path.join(home, '.openclaw');
const workspace = path.join(root, 'workspace');
const configDir = path.join(root, 'config');
const transcriptDir = path.join(root, 'transcripts');
const vault = path.join(root, 'vault');
const children = [];

function port() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const selected = server.address().port;
      server.close(() => resolve(selected));
    });
  });
}

async function waitFor(label, check, seconds = 45) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready in ${seconds}s`);
}

function launch(label, executable, args, env) {
  const fd = fsSync.openSync(path.join(root, `${label}.log`), 'a', 0o600);
  const child = spawn(executable, args, { cwd: workspace, env, stdio: ['ignore', fd, fd] });
  fsSync.closeSync(fd);
  children.push(child);
  child.once('error', (err) => { process.stderr.write(`${label}: ${err.message}\n`); });
  return child;
}

async function stopChildren() {
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

process.once('SIGINT', () => { stopChildren().then(() => process.exit(130)); });
process.once('SIGTERM', () => { stopChildren().then(() => process.exit(143)); });

try {
  if (!natsServer) throw new Error('nats-server executable not found on PATH');
  await fs.mkdir(path.join(workspace, 'bin'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'packages', 'event-schemas'), { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(transcriptDir);
  await fs.mkdir(vault);
  const modelCache = path.join(root, 'model-cache');
  const sourceModelCache = path.join(source, 'node_modules', '@huggingface', 'transformers', '.cache');
  if (fsSync.existsSync(sourceModelCache)) {
    await fs.cp(sourceModelCache, modelCache, { recursive: true, mode: fsSync.constants.COPYFILE_FICLONE });
  } else {
    await fs.mkdir(modelCache);
  }
  await fs.mkdir(path.join(root, 'jetstream'));
  for (const dir of ['bin', 'lib']) await fs.cp(path.join(source, dir), path.join(workspace, dir), { recursive: true, force: true });
  await fs.cp(path.join(source, 'packages', 'event-schemas', 'dist'), path.join(workspace, 'packages', 'event-schemas', 'dist'), { recursive: true });
  await fs.copyFile(path.join(source, 'packages', 'event-schemas', 'package.json'), path.join(workspace, 'packages', 'event-schemas', 'package.json'));
  await fs.copyFile(path.join(source, 'package.json'), path.join(workspace, 'package.json'));
  for (const script of ['memory-daemon.mjs', 'flush-worker.mjs', 'session-trace-emitter.mjs', 'obsidian-sync.mjs', 'memory-maintenance.mjs', 'knowledge-index-job.mjs']) {
    await fs.copyFile(path.join(source, 'workspace-bin', script), path.join(workspace, 'bin', script));
  }
  await fs.symlink(path.join(source, 'node_modules'), path.join(workspace, 'node_modules'));
  await fs.writeFile(path.join(workspace, 'MEMORY.md'), '# Fixture memory\n');

  const [busPort, monitorPort, injectPort] = await Promise.all([port(), port(), port()]);
  const busUrl = `nats://127.0.0.1:${busPort}`;
  const monitorUrl = `http://127.0.0.1:${monitorPort}`;
  const busToken = randomBytes(32).toString('hex');
  const syncConfig = path.join(configDir, 'obsidian-sync.json');
  const marker = { type: 'node-readiness-memory-fixture-v1', natsServerName: name };
  await fs.writeFile(path.join(root, 'ACCEPTANCE_FIXTURE'), JSON.stringify(marker), { mode: 0o600 });
  await fs.writeFile(path.join(root, 'openclaw.env'), `OPENCLAW_NATS=${busUrl}\nOPENCLAW_NATS_TOKEN=${busToken}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(configDir, 'transcript-sources.json'), JSON.stringify({ sources: [{ name: 'fixture', path: transcriptDir, type: 'claude-code', enabled: true }] }), { mode: 0o600 });
  await fs.writeFile(syncConfig, JSON.stringify({ enabled: false, memoryVaultPath: vault }), { mode: 0o600 });
  await fs.writeFile(path.join(configDir, 'daemon.json'), JSON.stringify({
    workspace, nodeId: name, contextWindowTokens: 100,
    intervals: { pollMs: 1000, synthesisMs: 1000, maintenanceMs: 9000000000000000,
      obsidianSyncMs: 9000000000000000, sessionRecapMs: 30000,
      activityWindowMs: 120000, activeThresholdMs: 60000, idleThresholdMs: 120000 },
  }), { mode: 0o600 });
  const natsConfig = path.join(root, 'nats.conf');
  await fs.writeFile(natsConfig, `server_name: "${name}"\nlisten: "127.0.0.1:${busPort}"\nhttp: "127.0.0.1:${monitorPort}"\nauthorization { token: "${busToken}" }\njetstream { store_dir: "${path.join(root, 'jetstream')}" }\n`, { mode: 0o600 });

  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin', HOME: home, USER: process.env.USER || 'fixture',
    OPENCLAW_HOME: root, OPENCLAW_WORKSPACE: workspace, OPENCLAW_NATS: busUrl,
    OPENCLAW_NODE_ID: name,
    OPENCLAW_NATS_TOKEN: busToken, NATS_MONITOR_URL: monitorUrl,
    MEMORY_INJECT_PORT: String(injectPort), OPENCLAW_OBSIDIAN_SYNC_CONFIG: syncConfig,
    OBSIDIAN_VAULT_PATH: vault, OPENCLAW_MODEL_CACHE: modelCache,
    ACCEPT_ISOLATED_MEMORY: '1', USE_LLM_EXTRACTION: 'true',
    LLM_BASE_URL: process.env.LLM_BASE_URL || 'http://127.0.0.1:11434',
    LLM_MODEL: process.env.ACCEPT_LLM_MODEL || 'qwen2.5:3b', LLM_NATIVE_API: 'true',
    LLM_MAX_TOKENS: process.env.ACCEPT_LLM_MAX_TOKENS || '768',
    LLM_TIMEOUT: process.env.ACCEPT_LLM_TIMEOUT || '420000', LLM_ANALYSIS_MAX_TOKENS: '128',
    OLLAMA_QUEUE_RETRIES: 'none',
    ACCEPT_ROUNDTRIP_POLL_MS: String(Math.max(Number(process.env.ACCEPT_ROUNDTRIP_POLL_MS) || 0,
      Number(process.env.ACCEPT_LLM_TIMEOUT || 420000) + 120000)),
    ACCEPT_EXTRACT_BUDGET_MS: process.env.ACCEPT_LLM_TIMEOUT || '420000',
    ACCEPT_INJECT_BUDGET_MS: process.env.ACCEPT_INJECT_BUDGET_MS || '120000',
  };

  const broker = launch('nats', natsServer, ['-c', natsConfig], env);
  await waitFor('fixture NATS', async () => {
    if (broker.exitCode !== null) throw new Error('fixture NATS exited');
    const response = await fetch(`${monitorUrl}/varz`);
    return response.ok && (await response.json()).server_name === name;
  });
  const daemon = launch('memory-daemon', process.execPath, [path.join(workspace, 'bin', 'memory-daemon.mjs')], env);
  await waitFor('fixture memory daemon', async () => {
    if (daemon.exitCode !== null) throw new Error('fixture daemon exited');
    const token = (await fs.readFile(path.join(configDir, 'memory-injection-token'), 'utf8')).trim();
    const response = await fetch(`http://127.0.0.1:${injectPort}/runtime/paths`, { headers: { Authorization: `Bearer ${token}` } });
    return response.ok && (await response.json()).isolatedMemory === true;
  }, 90);

  const injectToken = (await fs.readFile(path.join(configDir, 'memory-injection-token'), 'utf8')).trim();
  const warmup = await fetch(`http://127.0.0.1:${injectPort}/memory/inject`, {
    method: 'POST', headers: { Authorization: `Bearer ${injectToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Fixture model warmup', frontend: 'node-acceptance' }),
    signal: AbortSignal.timeout(120000),
  });
  if (!warmup.ok) throw new Error(`fixture injector warmup HTTP ${warmup.status}`);

  process.stdout.write(`Fixture ready: ${root}\n`);
  if (process.argv.includes('--startup-only')) {
    process.stdout.write('Private bus, daemon paths, and injector startup verified.\n');
  } else {
    process.stdout.write('Running isolated memory acceptance...\n');
    const acceptance = launch('acceptance', process.execPath, [path.join(workspace, 'bin', 'node-acceptance.mjs'), '--axis', 'memory', '--json'], env);
    const code = await new Promise((resolve) => acceptance.once('exit', resolve));
    const report = path.join(root, '.node-acceptance-FIXTURE.md');
    process.stdout.write(`Acceptance exit: ${code}\nReport: ${report}\nLogs: ${path.join(root, 'memory-daemon.log')}\n`);
    process.exitCode = Number.isInteger(code) ? code : 3;
  }
} catch (err) {
  process.stderr.write(`Fixture failed: ${err.message}\nFixture files: ${root}\n`);
  process.exitCode = 1;
} finally {
  await stopChildren();
}
