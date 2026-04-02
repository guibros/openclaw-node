#!/usr/bin/env node
/**
 * session-search.mjs — FTS5 Session Search CLI
 *
 * Searches the SQLite session archive for episodic recall.
 * Auto-detects piped output: JSON to stdout for tool consumption,
 * human-readable to stderr for interactive use.
 *
 * Usage:
 *   node workspace-bin/session-search.mjs "NATS URL fix"
 *   node workspace-bin/session-search.mjs --role user "API key"
 *   node workspace-bin/session-search.mjs --limit 5 --json "memory daemon"
 *   node workspace-bin/session-search.mjs --import           # import all sessions
 *   node workspace-bin/session-search.mjs --stats            # show db stats
 *
 * Registered as an OpenClaw skill for model-callable search.
 */

import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('session-search');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.dirname(__dirname);
const HOME = os.homedir();

// ── Args ────────────────────────────────────

const args = process.argv.slice(2);
const flags = {
  limit: 10,
  role: null,
  json: false,
  import: false,
  stats: false,
  help: false,
};
const positional = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--limit' && args[i + 1]) { flags.limit = parseInt(args[++i], 10); }
  else if (arg === '--role' && args[i + 1]) { flags.role = args[++i]; }
  else if (arg === '--json') { flags.json = true; }
  else if (arg === '--import') { flags.import = true; }
  else if (arg === '--stats') { flags.stats = true; }
  else if (arg === '--help' || arg === '-h') { flags.help = true; }
  else { positional.push(arg); }
}

const query = positional.join(' ');
const isPiped = !process.stdout.isTTY;
const useJson = flags.json || isPiped;

// ── Help ────────────────────────────────────

if (flags.help) {
  console.log(`
session-search — FTS5 episodic recall for OpenClaw sessions

Usage:
  session-search <query>            Search transcripts
  session-search --import           Import JSONL sessions into SQLite
  session-search --stats            Show database stats

Options:
  --limit <n>     Max sessions to return (default: 10)
  --role <role>   Filter by role: user, assistant
  --json          Force JSON output (auto-detected when piped)
  --help          Show this help

Examples:
  session-search "NATS URL fix"
  session-search --role user "API key"
  session-search --limit 5 "memory daemon"
`);
  process.exit(0);
}

// ── Dynamic Import ────────────────────────────────────

async function main() {
  // Import session-store (ESM)
  const { SessionStore } = await import(path.join(WORKSPACE, 'lib/session-store.mjs'));
  const store = new SessionStore();

  // ── Import mode ────────────────────────────────────
  if (flags.import) {
    const transcriptRegistry = path.join(HOME, '.openclaw/config/transcript-sources.json');
    let sources = []; // { path, name, format }

    if (fs.existsSync(transcriptRegistry)) {
      try {
        const reg = JSON.parse(fs.readFileSync(transcriptRegistry, 'utf-8'));
        sources = (reg.sources || [])
          .filter(s => s.enabled !== false)
          .map(s => ({
            path: s.path.startsWith('~') ? path.join(HOME, s.path.slice(1)) : s.path,
            name: s.name || 'unknown',
            format: s.format || null,
          }));
      } catch { /* fall through */ }
    }

    if (sources.length === 0) {
      // Fallback: known transcript locations with correct format tags
      const wsAbs = fs.existsSync(WORKSPACE) ? fs.realpathSync(WORKSPACE) : WORKSPACE;
      const slug = wsAbs.replace(/[/.]/g, '-');
      sources = [
        { path: path.join(HOME, '.claude/projects', slug), name: 'claude-code', format: 'claude-code' },
        { path: path.join(HOME, '.claude/projects', '-' + path.basename(HOME)), name: 'claude-home', format: 'claude-code' },
        { path: path.join(HOME, '.openclaw/agents/main/sessions'), name: 'gateway', format: 'openclaw-gateway' },
      ];
    }

    let totalImported = 0, totalSkipped = 0;
    for (const src of sources) {
      if (!fs.existsSync(src.path)) continue;
      const result = await store.importDirectory(src.path, { source: src.name, format: src.format });
      totalImported += result.imported;
      totalSkipped += result.skipped;
      if (!useJson) {
        process.stderr.write(`  ${src.path}: ${result.imported} imported, ${result.skipped} skipped\n`);
      }
    }

    if (useJson) {
      console.log(JSON.stringify({ imported: totalImported, skipped: totalSkipped }));
    } else {
      console.log(`\nTotal: ${totalImported} imported, ${totalSkipped} skipped`);
    }

    store.close();
    return;
  }

  // ── Stats mode ────────────────────────────────────
  if (flags.stats) {
    const stats = store.getStats();
    if (useJson) {
      console.log(JSON.stringify(stats));
    } else {
      console.log(`Sessions:  ${stats.sessionCount}`);
      console.log(`Messages:  ${stats.messageCount}`);
      console.log(`DB size:   ${stats.dbSizeMb} MB`);
    }
    store.close();
    return;
  }

  // ── Search mode ────────────────────────────────────
  if (!query) {
    console.error('Usage: session-search <query>');
    console.error('       session-search --help for more options');
    process.exit(1);
  }

  const results = store.search(query, {
    limit: flags.limit,
    role: flags.role,
  });

  if (useJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.length === 0) {
      console.log('No matches found.');
      store.close();
      return;
    }

    for (const result of results) {
      const date = result.startTime
        ? new Date(result.startTime).toLocaleDateString('en-CA')
        : 'unknown';

      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Session: ${result.sessionId.slice(0, 12)} (${result.source})`);
      console.log(`Date:    ${date}  |  Matches: ${result.matchCount}  |  Score: ${result.score}`);

      for (const excerpt of result.excerpts) {
        console.log(`  ┌ turns ${excerpt.startTurn}–${excerpt.endTurn}`);
        for (const turn of excerpt.turns) {
          const marker = turn.isMatch ? '►' : ' ';
          const role = turn.role.padEnd(10);
          const text = turn.content.replace(/\n/g, ' ').slice(0, 120);
          console.log(`  ${marker} [${role}] ${text}`);
        }
        console.log(`  └`);
      }
    }
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${results.length} session(s) matched.`);
  }

  store.close();
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
