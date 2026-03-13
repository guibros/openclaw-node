#!/usr/bin/env node

/**
 * mesh-tool-discord.js — Discord history tool for OpenClaw mesh.
 *
 * Runs as a long-lived service on the gateway node (where the bot token lives).
 * Registers as a mesh tool via NATS KV, subscribes to request subjects,
 * and proxies requests to Discord's REST API.
 *
 * NATS subjects:
 *   mesh.tool.{nodeId}.discord-history.readMessages
 *   mesh.tool.{nodeId}.discord-history.searchMessages
 *   mesh.tool.{nodeId}.discord-history.listChannels
 *   mesh.tool.{nodeId}.discord-history.channelInfo
 *
 * Usage:
 *   node mesh-tool-discord.js          # foreground
 *   node mesh-tool-discord.js &        # background
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../lib/mesh-registry');

// ── Config ──────────────────────────────────────────

const CONFIG_PATH = path.join(process.env.HOME, '.openclaw', 'openclaw.json');
const DISCORD_API = 'discord.com';
const API_VERSION = '10';

function loadBotToken() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const token = config.channels?.discord?.token;
  if (!token) {
    console.error('[discord-tool] No Discord bot token found in openclaw.json');
    process.exit(1);
  }
  return token;
}

// ── Discord REST API ────────────────────────────────

function discordRequest(method, endpoint, token, _retryDepth = 0) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: DISCORD_API,
      port: 443,
      path: `/api/v${API_VERSION}${endpoint}`,
      method,
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'OpenClaw-MeshTool/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          if (_retryDepth >= 5) {
            reject(new Error(`Discord API: rate limited ${_retryDepth} times on ${endpoint}`));
            return;
          }
          const retryAfter = JSON.parse(data).retry_after || 1;
          setTimeout(() => {
            discordRequest(method, endpoint, token, _retryDepth + 1).then(resolve).catch(reject);
          }, retryAfter * 1000);
          return;
        }
        if (res.statusCode >= 400) {
          reject(new Error(`Discord API ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ── Tool Handlers ───────────────────────────────────

function createHandlers(token) {
  return {
    /**
     * Read messages from a channel.
     * @param {string} channelId - Discord channel ID
     * @param {number} limit - Max messages (1-100, default 50)
     * @param {string} before - Get messages before this message ID
     * @param {string} after - Get messages after this message ID
     */
    async readMessages(params) {
      const { channelId, limit = 50, before, after } = params;
      if (!channelId) throw new Error('channelId is required');

      const clampedLimit = Math.min(Math.max(1, limit), 100);
      let endpoint = `/channels/${channelId}/messages?limit=${clampedLimit}`;
      if (before) endpoint += `&before=${before}`;
      if (after) endpoint += `&after=${after}`;

      const messages = await discordRequest('GET', endpoint, token);

      return messages.map(m => ({
        id: m.id,
        author: { id: m.author.id, username: m.author.username, bot: m.author.bot || false },
        content: m.content,
        timestamp: m.timestamp,
        attachments: (m.attachments || []).map(a => ({ filename: a.filename, url: a.url, size: a.size })),
        embeds: (m.embeds || []).length,
        referencedMessage: m.referenced_message ? {
          id: m.referenced_message.id,
          author: m.referenced_message.author?.username,
          content: m.referenced_message.content?.slice(0, 200),
        } : null,
      }));
    },

    /**
     * Search messages in a guild.
     * Discord search API: GET /guilds/{guildId}/messages/search
     */
    async searchMessages(params) {
      const { guildId, query, channelId, authorId, limit = 25 } = params;
      if (!guildId || !query) throw new Error('guildId and query are required');

      let endpoint = `/guilds/${guildId}/messages/search?content=${encodeURIComponent(query)}`;
      if (channelId) endpoint += `&channel_id=${channelId}`;
      if (authorId) endpoint += `&author_id=${authorId}`;
      endpoint += `&limit=${Math.min(Math.max(1, limit), 25)}`;

      const result = await discordRequest('GET', endpoint, token);

      return {
        totalResults: result.total_results,
        messages: (result.messages || []).map(group => {
          const m = group[0]; // search returns message groups
          return {
            id: m.id,
            channelId: m.channel_id,
            author: { id: m.author.id, username: m.author.username },
            content: m.content,
            timestamp: m.timestamp,
          };
        }),
      };
    },

    /**
     * List channels in a guild.
     */
    async listChannels(params) {
      const { guildId } = params;
      if (!guildId) throw new Error('guildId is required');

      const channels = await discordRequest('GET', `/guilds/${guildId}/channels`, token);

      return channels
        .filter(c => [0, 2, 5, 15].includes(c.type)) // text, voice, announcement, forum
        .map(c => ({
          id: c.id,
          name: c.name,
          type: ['text', 'dm', 'voice', 'group_dm', 'category', 'announcement',
                 , , , , , , , , , 'forum'][c.type] || `type_${c.type}`,
          parentId: c.parent_id,
          position: c.position,
          topic: c.topic,
        }))
        .sort((a, b) => a.position - b.position);
    },

    /**
     * Get info about a specific channel.
     */
    async channelInfo(params) {
      const { channelId } = params;
      if (!channelId) throw new Error('channelId is required');

      const c = await discordRequest('GET', `/channels/${channelId}`, token);

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        guildId: c.guild_id,
        topic: c.topic,
        lastMessageId: c.last_message_id,
        parentId: c.parent_id,
        memberCount: c.member_count,
      };
    },
  };
}

// ── Tool Manifest ───────────────────────────────────

const TOOL_MANIFEST = {
  name: 'discord-history',
  version: '1.0.0',
  description: 'Read Discord message history and search across channels',
  methods: [
    {
      name: 'readMessages',
      description: 'Fetch recent messages from a Discord channel',
      params: {
        channelId: { type: 'string', required: true, description: 'Discord channel ID' },
        limit: { type: 'number', default: 50, description: 'Max messages (1-100)' },
        before: { type: 'string', description: 'Get messages before this message ID' },
        after: { type: 'string', description: 'Get messages after this message ID' },
      },
    },
    {
      name: 'searchMessages',
      description: 'Search messages in a Discord guild',
      params: {
        guildId: { type: 'string', required: true, description: 'Discord guild/server ID' },
        query: { type: 'string', required: true, description: 'Search query' },
        channelId: { type: 'string', description: 'Filter by channel' },
        authorId: { type: 'string', description: 'Filter by author' },
        limit: { type: 'number', default: 25, description: 'Max results (1-25)' },
      },
    },
    {
      name: 'listChannels',
      description: 'List all channels in a Discord guild',
      params: {
        guildId: { type: 'string', required: true, description: 'Discord guild/server ID' },
      },
    },
    {
      name: 'channelInfo',
      description: 'Get metadata for a Discord channel',
      params: {
        channelId: { type: 'string', required: true, description: 'Discord channel ID' },
      },
    },
  ],
  tags: ['discord', 'messaging', 'read-only'],
  timeout_ms: 15000,
};

// ── Main ────────────────────────────────────────────

async function main() {
  console.log('[discord-tool] Starting Discord history mesh tool...');

  const token = loadBotToken();
  console.log('[discord-tool] Bot token loaded.');

  const handlers = createHandlers(token);

  // Create registry and register tool
  const { nc, registry } = await createRegistry();
  console.log(`[discord-tool] Connected to NATS. Node: ${registry.nodeId}`);

  await registry.register(TOOL_MANIFEST, handlers);
  console.log('[discord-tool] Tool registered in MESH_TOOLS KV.');

  registry.startHeartbeat();
  console.log('[discord-tool] Heartbeat started (60s interval).');

  console.log('[discord-tool] Listening for requests on:');
  for (const method of TOOL_MANIFEST.methods) {
    console.log(`  mesh.tool.${registry.nodeId}.discord-history.${method.name}`);
  }

  // Handle shutdown
  const shutdown = async () => {
    console.log('\n[discord-tool] Shutting down...');
    await registry.shutdown();
    await nc.drain();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await nc.closed();
}

main().catch(err => {
  console.error(`[discord-tool] Fatal: ${err.message}`);
  process.exit(1);
});
