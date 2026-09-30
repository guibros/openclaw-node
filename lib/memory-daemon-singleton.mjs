import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';

function canConnect(socketPath) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

export async function acquireMemoryDaemonSingleton(home) {
  const socketPath = path.join(home, '.openclaw', 'm.sock');
  await fs.mkdir(path.dirname(socketPath), { recursive: true });
  const server = net.createServer((socket) => socket.end());
  const listen = () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); });
  });
  try {
    await listen();
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    const before = await fs.lstat(socketPath).catch(() => null);
    if (await canConnect(socketPath)) throw new Error('memory daemon already owns this HOME');
    const after = await fs.lstat(socketPath).catch(() => null);
    if (before && after && before.dev === after.dev && before.ino === after.ino) await fs.unlink(socketPath);
    await listen();
  }
  return {
    socketPath,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fs.unlink(socketPath).catch((err) => { if (err.code !== 'ENOENT') throw err; });
    },
  };
}
