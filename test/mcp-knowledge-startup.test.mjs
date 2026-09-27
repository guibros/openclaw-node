/**
 * test/mcp-knowledge-startup.test.mjs — the knowledge server answers MCP before
 * its initial index pass, and index passes never overlap.
 *
 * Claude Code gives an MCP server 30 s to answer `initialize`. The server used
 * to answer only after its startup index pass, which on the node took 138 s and
 * 206 s waiting on LLM directory abstracts (2026-09-26). Here the LLM never
 * answers, so the pass stays parked on the root directory's abstract and never
 * reaches the embedding model.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { createKnowledgeEngine } from '../lib/mcp-knowledge/core.mjs';

const SERVER = fileURLToPath(new URL('../lib/mcp-knowledge/server.mjs', import.meta.url));

async function waitFor(cond, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('mcp-knowledge startup', () => {
  let dir;
  let root;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-knowledge-startup-'));
    root = join(dir, 'root');
    mkdirSync(root);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns before the initial pass, and a reindex waits for it', { timeout: 30_000 }, async () => {
    let calls = 0;
    const llmClient = { generateAnalysis: () => { calls++; return new Promise(() => {}); } };
    const engine = await createKnowledgeEngine({ workspace: root, dbPath: join(dir, 'engine.db'), llmClient, background: true });
    try {
      await waitFor(() => calls === 1);
      let reindexed = false;
      engine.reindex().then(() => { reindexed = true; });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(calls, 1, 'reindex started a second pass while the first was running');
      assert.equal(reindexed, false);
      assert.equal(engine.stats().documents, 0);
    } finally {
      engine.db.close();
    }
  });

  it('the stdio server answers while its initial pass waits on the LLM', { timeout: 60_000 }, async () => {
    const held = [];
    const ollama = createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }], data: [{ id: 'qwen3:8b' }] }));
        return;
      }
      held.push(res);
    });
    await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      stderr: 'pipe',
      env: {
        ...process.env,
        KNOWLEDGE_ROOT: root,
        KNOWLEDGE_DB: join(dir, 'server.db'),
        KNOWLEDGE_POLL_MS: '0',
        KNOWLEDGE_SUMMARY_LLM: '1',
        LLM_BASE_URL: `http://127.0.0.1:${ollama.address().port}`,
        LLM_ANALYSIS_TIMEOUT: '600000',
      },
    });
    let stderr = '';
    transport.stderr.on('data', (d) => { stderr += d; });
    const client = new Client({ name: 'startup-test', version: '0' });
    try {
      await client.connect(transport, { timeout: 15_000 }).catch((err) => {
        throw new Error(`${err.message}; server stderr: ${stderr || '(empty)'}`);
      });
      await waitFor(() => held.length > 0);
      const { tools } = await client.listTools();
      assert.ok(tools.some((t) => t.name === 'knowledge_tree'));
    } finally {
      // Kill the server while its pass is still parked; releasing the LLM call
      // first would let the pass go on to load the embedding model.
      await client.close();
      for (const res of held) res.destroy();
      await new Promise((r) => ollama.close(r));
    }
  });
});
