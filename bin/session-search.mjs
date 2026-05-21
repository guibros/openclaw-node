#!/usr/bin/env node

/**
 * session-search — CLI tool for searching indexed session turns.
 *
 * Usage:
 *   node bin/session-search.mjs "query text" [--semantic|--hybrid|--fts] [--limit N] [--db PATH]
 */

import { parseArgs } from 'node:util';
import {
  initDatabase,
  searchSessions,
  searchSessionsFts,
  hybridSearchSessions,
  DB_PATH,
} from '../lib/mcp-knowledge/core.mjs';

const { values, positionals } = parseArgs({
  options: {
    semantic: { type: 'boolean', default: false },
    hybrid: { type: 'boolean', default: false },
    fts: { type: 'boolean', default: false },
    limit: { type: 'string', default: '10' },
    db: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  process.stdout.write(`Usage: session-search <query> [--semantic|--hybrid|--fts] [--limit N] [--db PATH]

Search modes:
  --semantic   Vector similarity search only
  --hybrid     FTS5 + semantic combined via Reciprocal Rank Fusion (default)
  --fts        FTS5 full-text keyword search only

Options:
  --limit N    Max results (default: 10)
  --db PATH    Path to knowledge database
  -h, --help   Show this help
`);
  process.exit(0);
}

const query = positionals.join(' ');
const limit = parseInt(values.limit, 10) || 10;
const dbPath = values.db || DB_PATH;

// Determine search mode (default: hybrid)
let mode = 'hybrid';
if (values.semantic) mode = 'semantic';
else if (values.fts) mode = 'fts';

const db = initDatabase(dbPath);

let results;
if (mode === 'semantic') {
  results = await searchSessions(db, query, limit);
} else if (mode === 'fts') {
  results = searchSessionsFts(db, query, limit);
} else {
  results = await hybridSearchSessions(db, query, limit);
}

if (results.length === 0) {
  process.stdout.write('No results found.\n');
  db.close();
  process.exit(0);
}

process.stdout.write(`\n${mode.toUpperCase()} search: "${query}" (${results.length} results)\n\n`);

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  process.stdout.write(`${i + 1}. [${r.score}] session=${r.session_id} turn=${r.turn_index} role=${r.role}\n`);
  process.stdout.write(`   ${r.snippet}\n\n`);
}

db.close();
