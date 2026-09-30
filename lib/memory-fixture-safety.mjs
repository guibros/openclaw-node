import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

function resolvedTarget(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  return path.join(resolvedTarget(path.dirname(target)), path.basename(target));
}

function envValue(file, key) {
  try {
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
    return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null;
  } catch { return null; }
}

export function assertMemoryFixtureSafety({ env = process.env, home = os.homedir(), accountHome = os.userInfo().homedir,
  script, workspace, configuredWorkspace }) {
  const marker = path.join(home, '.openclaw', 'ACCEPTANCE_FIXTURE');
  const marked = fs.existsSync(marker);
  if (!marked && env.ACCEPT_ISOLATED_MEMORY !== '1') return;
  if (!marked || env.ACCEPT_ISOLATED_MEMORY !== '1') throw new Error('fixture marker and ACCEPT_ISOLATED_MEMORY=1 are both required');
  const fixture = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (fixture.type !== 'node-readiness-memory-fixture-v1'
    || !/^acc-[a-z0-9-]{8,}$/i.test(fixture.natsServerName)
    || env.OPENCLAW_NODE_ID !== fixture.natsServerName) {
    throw new Error('fixture marker and node identity do not match');
  }
  const root = fs.realpathSync(path.join(home, '.openclaw'));
  const liveHome = path.join(accountHome, '.openclaw');
  const live = fs.existsSync(liveHome) ? fs.realpathSync(liveHome) : null;
  if (live && (within(live, root) || within(root, live))) throw new Error('fixture overlaps live OpenClaw state');
  if (!env.OPENCLAW_WORKSPACE || !env.OPENCLAW_HOME || !env.OPENCLAW_NATS_TOKEN) {
    throw new Error('fixture requires explicit workspace, home and bus token');
  }
  const bus = new URL(env.OPENCLAW_NATS);
  if (bus.protocol !== 'nats:' || !['127.0.0.1', 'localhost', '[::1]'].includes(bus.hostname)
    || Number(bus.port) < 10000) throw new Error('fixture requires a high loopback NATS port');
  const monitor = new URL(env.NATS_MONITOR_URL);
  if (monitor.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(monitor.hostname)
    || Number(monitor.port) < 10000) throw new Error('fixture requires a high loopback NATS monitor');
  if (envValue(path.join(liveHome, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN') === env.OPENCLAW_NATS_TOKEN
    || envValue(path.join(accountHome, 'openclaw', '.mesh-config'), 'OPENCLAW_NATS_TOKEN') === env.OPENCLAW_NATS_TOKEN) {
    throw new Error('fixture bus token matches a live bus token');
  }
  if (env.OPENCLAW_FEDERATION === '1') throw new Error('fixture must not start federation');
  for (const key of ['OPENCLAW_DB_DIR', 'OPENCLAW_EXTRACTION_DB', 'OPENCLAW_KNOWLEDGE_DB',
    'OPENCLAW_STATE_DB', 'KNOWLEDGE_DB', 'KNOWLEDGE_ROOT', 'GRAPH_CACHE_DB_PATH',
    'MC_URL', 'OPENCLAW_MC_URL', 'MC_SESSION_TOKEN_PATH', 'OPENCLAW_MC_TOKEN_FILE']) {
    if (env[key]) throw new Error(`fixture forbids ${key}`);
  }
  const targets = [env.OPENCLAW_HOME, env.OPENCLAW_WORKSPACE, script, workspace, configuredWorkspace,
    env.OBSIDIAN_VAULT_PATH, env.OPENCLAW_OBSIDIAN_SYNC_CONFIG, env.OPENCLAW_MODEL_CACHE];
  if (targets.some((target) => !target || !within(root, resolvedTarget(target)))) {
    throw new Error('fixture daemon has a write path outside its root');
  }
  if (resolvedTarget(env.OPENCLAW_OBSIDIAN_SYNC_CONFIG) !== resolvedTarget(path.join(root, 'config', 'obsidian-sync.json'))) {
    throw new Error('fixture Obsidian config is not the protected fixture config');
  }
  const sync = JSON.parse(fs.readFileSync(env.OPENCLAW_OBSIDIAN_SYNC_CONFIG, 'utf8'));
  if (sync.enabled !== false) throw new Error('fixture Obsidian sync must be disabled');
  if (fs.existsSync(path.join(workspace, sync.apiKeyFile || 'projects/arcane-vault/.obsidian-api-key'))
    || fs.existsSync(path.join(root, 'config', 'mc-session-token'))) {
    throw new Error('fixture contains live-service credentials');
  }
  return fixture;
}

export async function verifyMemoryFixtureBus(nc, fixture, monitorUrl, fetchMonitor = fetch) {
  const info = nc.info || {};
  if (info.server_name !== fixture.natsServerName || info.cluster || info.connect_urls?.length) {
    throw new Error('NATS connection identity or cluster topology differs from fixture marker');
  }
  for (const endpoint of ['varz', 'routez', 'leafz', 'gatewayz']) {
    const response = await fetchMonitor(`${monitorUrl}/${endpoint}`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`NATS monitor ${endpoint} HTTP ${response.status}`);
    const body = await response.json();
    if (body.server_id !== info.server_id || (endpoint === 'varz' && body.server_name !== fixture.natsServerName)
      || (endpoint === 'routez' && body.routes?.length)
      || (endpoint === 'leafz' && body.leafnodes)
      || (endpoint === 'gatewayz' && (Object.keys(body.inbound_gateways || {}).length
        || Object.keys(body.outbound_gateways || {}).length))) {
      throw new Error(`NATS monitor ${endpoint} is not the isolated fixture server`);
    }
  }
}
