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

export function assertMemoryFixtureSafety({ env = process.env, home = os.homedir(), script, workspace, configuredWorkspace }) {
  if (env.ACCEPT_ISOLATED_MEMORY !== '1') return;
  const root = fs.realpathSync(path.join(home, '.openclaw'));
  const live = fs.realpathSync(path.join(os.userInfo().homedir, '.openclaw'));
  if (within(live, root) || within(root, live)) throw new Error('fixture overlaps live OpenClaw state');
  if (!env.OPENCLAW_WORKSPACE || !env.OPENCLAW_HOME || !env.OPENCLAW_NATS_TOKEN) {
    throw new Error('fixture requires explicit workspace, home and bus token');
  }
  const bus = new URL(env.OPENCLAW_NATS);
  if (bus.protocol !== 'nats:' || !['127.0.0.1', 'localhost', '[::1]'].includes(bus.hostname)
    || Number(bus.port) < 10000) throw new Error('fixture requires a high loopback NATS port');
  if (env.OPENCLAW_FEDERATION === '1') throw new Error('fixture must not start federation');
  for (const key of ['OPENCLAW_DB_DIR', 'OPENCLAW_EXTRACTION_DB', 'OPENCLAW_KNOWLEDGE_DB',
    'OPENCLAW_STATE_DB', 'KNOWLEDGE_DB', 'KNOWLEDGE_ROOT', 'GRAPH_CACHE_DB_PATH',
    'MC_URL', 'OPENCLAW_MC_URL', 'MC_SESSION_TOKEN_PATH', 'OPENCLAW_MC_TOKEN_FILE']) {
    if (env[key]) throw new Error(`fixture forbids ${key}`);
  }
  const targets = [env.OPENCLAW_HOME, env.OPENCLAW_WORKSPACE, script, workspace, configuredWorkspace,
    env.OBSIDIAN_VAULT_PATH, env.OPENCLAW_OBSIDIAN_SYNC_CONFIG];
  if (targets.some((target) => !target || !within(root, resolvedTarget(target)))) {
    throw new Error('fixture daemon has a write path outside its root');
  }
  const sync = JSON.parse(fs.readFileSync(path.join(root, 'config', 'obsidian-sync.json'), 'utf8'));
  if (sync.enabled !== false) throw new Error('fixture Obsidian sync must be disabled');
  if (fs.existsSync(path.join(workspace, sync.apiKeyFile || 'projects/arcane-vault/.obsidian-api-key'))
    || fs.existsSync(path.join(root, 'config', 'mc-session-token'))) {
    throw new Error('fixture contains live-service credentials');
  }
}
