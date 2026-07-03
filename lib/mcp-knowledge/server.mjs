#!/usr/bin/env node
/**
 * @openclaw/mcp-knowledge — MCP server entrypoint
 *
 * Dual transport:
 *   - KNOWLEDGE_PORT not set → stdio MCP (Claude Code, OpenClaw child process)
 *   - KNOWLEDGE_PORT set     → HTTP MCP + /health (mesh-internal, worker nodes)
 *
 * All core logic lives in core.mjs. This file is pure transport wiring.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createKnowledgeEngine, WORKSPACE, DB_PATH } from './core.mjs';
import { createReadonlyQuery } from '../readonly-sql.mjs';

// ─── Read-only SQL allowlist ─────────────────────────────────────────────────
// Callers pick a key, never a path. Connections open lazily and are cached.

const SQL_DBS = {
  state: process.env.OPENCLAW_STATE_DB || join(homedir(), '.openclaw/state.db'),
  knowledge: DB_PATH,
  mission_control:
    process.env.MISSION_CONTROL_DB ||
    join(WORKSPACE, 'projects', 'mission-control', 'data', 'mission-control.db'),
};

const sqlConnections = new Map();

function readonlyDb(key) {
  if (!(key in SQL_DBS)) {
    throw new Error(`unknown db '${key}' — one of: ${Object.keys(SQL_DBS).join(', ')}`);
  }
  if (!sqlConnections.has(key)) {
    sqlConnections.set(key, createReadonlyQuery({ dbPath: SQL_DBS[key] }));
  }
  return sqlConnections.get(key);
}

// ─── MCP Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'semantic_search',
    description:
      'Search the knowledge base by meaning. Returns documents semantically similar to the query, ranked by relevance. Use this to find notes, lore, architecture docs, and memories related to a topic.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Max results (default 10)', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_related',
    description:
      'Find documents related to a specific file. Returns other knowledge base documents that are semantically similar to the given document.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_path: {
          type: 'string',
          description: 'Relative path of the document (e.g. "projects/arcane/lore/FACTIONS_LORE_INTEGRATED_V1.md")',
        },
        limit: { type: 'number', description: 'Max results (default 10)', default: 10 },
      },
      required: ['doc_path'],
    },
  },
  {
    name: 'reindex',
    description:
      'Manually trigger reindexing of the knowledge base. Use after adding or editing knowledge files. Pass force=true to re-embed all files regardless of content hash.',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Force re-embed all files', default: false },
      },
    },
  },
  {
    name: 'knowledge_stats',
    description: 'Get statistics about the indexed knowledge base.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sql_query',
    description:
      'Run a single read-only SELECT against a local OpenClaw database (state = extracted entities/decisions/themes/mentions, knowledge = session documents/chunks index, mission_control = tasks/activity/memory docs). Results are private local data; rows capped at 200, long values truncated, blobs elided. Writes, PRAGMA and ATTACH are rejected. Use sql_schema first to see the tables.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string', enum: ['state', 'knowledge', 'mission_control'] },
        sql: { type: 'string', description: 'One SELECT/WITH/VALUES/EXPLAIN statement. Use ? placeholders with params.' },
        params: { type: 'array', description: 'Positional bind parameters', items: {} },
      },
      required: ['db', 'sql'],
    },
  },
  {
    name: 'sql_schema',
    description:
      'List the tables, indexes and views of a local OpenClaw database with their CREATE statements. Call before sql_query.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string', enum: ['state', 'knowledge', 'mission_control'] },
      },
      required: ['db'],
    },
  },
];

// ─── MCP Server Factory ──────────────────────────────────────────────────────

function createMcpServer(engine) {
  const server = new Server(
    { name: '@openclaw/mcp-knowledge', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'semantic_search': {
          const results = await engine.search(args.query, args.limit || 10);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        case 'find_related': {
          const results = await engine.related(args.doc_path, args.limit || 10);
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        case 'reindex': {
          const result = await engine.reindex(args?.force || false);
          return {
            content: [{
              type: 'text',
              text: `Reindex complete: ${result.indexed} indexed, ${result.skipped} unchanged, ${result.deleted} removed. ${result.total} files scanned.`,
            }],
          };
        }
        case 'knowledge_stats': {
          const stats = engine.stats();
          return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
        }
        case 'sql_query': {
          const result = readonlyDb(args.db).query(args.sql, args.params || []);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'sql_schema': {
          const result = readonlyDb(args.db).schema();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  return server;
}

// ─── Stdio Mode ──────────────────────────────────────────────────────────────

async function startStdio(engine) {
  const server = createMcpServer(engine);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[mcp-knowledge] MCP server running on stdio\n');
}

// ─── HTTP Mode ───────────────────────────────────────────────────────────────

async function startHttp(engine, port, host) {
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );

  const { createServer } = await import('node:http');

  const startTime = Date.now();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Health endpoint — liveness probe for mesh health publisher
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
      }));
      return;
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      if (req.method === 'POST') {
        // Stateless: fresh server+transport per request
        const server = createMcpServer(engine);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        });
        await server.connect(transport);

        // Parse body
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());

        await transport.handleRequest(req, res, body);
        return;
      }

      // GET and DELETE not supported in stateless mode
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST for MCP requests.' }));
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(port, host, () => {
    process.stderr.write(`[mcp-knowledge] HTTP MCP server listening on ${host}:${port}\n`);
    process.stderr.write(`[mcp-knowledge]   MCP endpoint: POST http://${host}:${port}/mcp\n`);
    process.stderr.write(`[mcp-knowledge]   Health check: GET  http://${host}:${port}/health\n`);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const engine = await createKnowledgeEngine();

  const port = process.env.KNOWLEDGE_PORT;
  if (port) {
    const host = process.env.KNOWLEDGE_HOST || '127.0.0.1';
    await startHttp(engine, parseInt(port, 10), host);
  } else {
    await startStdio(engine);
  }
}

main().catch((err) => {
  process.stderr.write(`[mcp-knowledge] fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
