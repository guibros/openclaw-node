#!/usr/bin/env node

import { embed } from '../lib/mcp-knowledge/core.mjs';

try {
  const vector = await embed(process.argv[2] || 'OpenClaw embedding health probe');
  process.stdout.write(JSON.stringify({ ok: true, vector: Array.from(vector) }));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
  process.exitCode = 2;
}
