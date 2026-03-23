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
import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { createKnowledgeEngine, WORKSPACE } from './core.mjs';

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

// ─── NATS Mesh Tool Registration ─────────────────────────────────────────────

async function registerNatsTools(engine) {
  const require = createRequire(import.meta.url);
  const { createRegistry } = require('../mesh-registry.js');
  const nodeId = process.env.OPENCLAW_NODE_ID || hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const { registry } = await createRegistry(nodeId);

  await registry.register({
    name: 'knowledge',
    version: '0.1.0',
    description: 'Semantic search over markdown knowledge base',
    methods: [
      { name: 'search', description: 'Semantic search by meaning', params: { query: 'string', limit: 'number?' } },
      { name: 'related', description: 'Find related documents', params: { doc_path: 'string', limit: 'number?' } },
      { name: 'reindex', description: 'Re-index knowledge base', params: { force: 'boolean?' } },
      { name: 'stats', description: 'Index statistics', params: {} },
    ],
  }, {
    search: async ({ query, limit }) => engine.search(query, limit || 10),
    related: async ({ doc_path, limit }) => engine.related(doc_path, limit || 10),
    reindex: async ({ force }) => engine.reindex(force || false),
    stats: async () => engine.stats(),
  });

  registry.startHeartbeat();
  process.stderr.write(`[mcp-knowledge] NATS mesh tools registered as ${nodeId}\n`);
  return registry;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const engine = await createKnowledgeEngine();

  // Optional NATS mesh tool registration (non-blocking if NATS unavailable)
  try {
    await registerNatsTools(engine);
  } catch {
    process.stderr.write('[mcp-knowledge] NATS not available — mesh tools disabled\n');
  }

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
