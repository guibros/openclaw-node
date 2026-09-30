const fs = require('node:fs');
const http = require('node:http');

if (process.env.OWNED_ROLE === 'mesh-agent') {
  const server = http.createServer((_request, response) => {
    const ready = !fs.existsSync(process.env.OWNED_UNREADY_FILE);
    const body = JSON.stringify({ pid: process.pid, ready });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  });
  server.listen(Number(process.env.OWNED_HEALTH_PORT), '127.0.0.1');
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
} else if (process.env.OWNED_ROLE === 'scheduler-heartbeat') {
  fs.appendFileSync(process.env.OWNED_FIRE_LOG, 'fired\n');
} else {
  process.exit(1);
}
