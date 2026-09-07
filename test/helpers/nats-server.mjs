/**
 * nats-server.mjs — spawn a real nats-server for a test, from a config file.
 *
 * Binary lookup: $NATS_SERVER_BIN, then PATH. Tests gate on `natsServerBin()`
 * being null with the canonical censused marker 'nats-server not found on PATH'
 * (see test/mesh-skip-census.test.mjs) — never a different string.
 */
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

export function natsServerBin() {
  if (process.env.NATS_SERVER_BIN && fs.existsSync(process.env.NATS_SERVER_BIN)) return process.env.NATS_SERVER_BIN;
  try { return execSync('which nats-server', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

/** A free loopback TCP port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Start nats-server with `-c configPath`. Resolves once it listens for clients.
 * @returns {Promise<{ proc: import('node:child_process').ChildProcess, stop: () => Promise<void>, reload: () => void, log: () => string }>}
 */
export function startNatsServer(configPath, { bin = natsServerBin(), timeoutMs = 10_000 } = {}) {
  if (!bin) throw new Error('nats-server binary not found');
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { proc.kill('SIGTERM'); finish(reject, new Error(`nats-server did not start in ${timeoutMs}ms:\n${out}`)); }, timeoutMs);
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes('Listening for client connections')) {
        finish(resolve, {
          proc,
          log: () => out,
          reload: () => proc.kill('SIGHUP'),
          stop: () => new Promise((res) => { if (proc.exitCode !== null) return res(); proc.once('exit', () => res()); proc.kill('SIGTERM'); }),
        });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => finish(reject, err));
    proc.on('exit', (code) => finish(reject, new Error(`nats-server exited with ${code}:\n${out}`)));
  });
}

/** Write a minimal loopback + JetStream config that includes nats-auth.conf. */
export function writeServerConfig(dir, port) {
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  const conf = path.join(dir, 'nats.conf');
  fs.writeFileSync(conf, `listen: 127.0.0.1:${port}\njetstream { store_dir: ${JSON.stringify(path.join(dir, 'js'))} }\ninclude "nats-auth.conf"\n`);
  return conf;
}
