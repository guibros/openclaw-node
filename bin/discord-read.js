#!/usr/bin/env node

/**
 * discord-read — CLI for querying Discord history via the mesh tool registry.
 *
 * Short-lived process: connects to NATS, sends request, prints result, exits.
 *
 * Usage:
 *   discord-read history <channel-id> [--limit 50] [--before <msg-id>] [--after <msg-id>]
 *   discord-read search <guild-id> <query> [--channel <id>] [--author <id>] [--limit 25]
 *   discord-read channels <guild-id>
 *   discord-read channel-info <channel-id>
 *   discord-read tools                     — list registered mesh tools
 */

const { connect, StringCodec } = require('nats');

const sc = StringCodec();
const { NATS_URL } = require('../lib/nats-resolve');

async function natsConnect() {
  try {
    return await connect({ servers: NATS_URL, timeout: 5000 });
  } catch (err) {
    console.error(`Cannot connect to NATS at ${NATS_URL}`);
    process.exit(1);
  }
}

/**
 * Find the node that provides the discord-history tool by scanning KV.
 */
async function findDiscordToolNode(nc) {
  const js = nc.jetstream();
  const kv = await js.views.kv('MESH_TOOLS');

  const keys = await kv.keys();
  for await (const key of keys) {
    if (key.endsWith('.discord-history')) {
      const entry = await kv.get(key);
      if (entry && entry.value) {
        const manifest = JSON.parse(sc.decode(entry.value));
        return manifest.node_id;
      }
    }
  }
  return null;
}

async function callTool(nc, nodeId, methodName, args, timeoutMs = 15000) {
  const subject = `mesh.tool.${nodeId}.discord-history.${methodName}`;
  const payload = JSON.stringify({ args });

  try {
    const msg = await nc.request(subject, sc.encode(payload), { timeout: timeoutMs });
    const response = JSON.parse(sc.decode(msg.data));
    if (response.error) {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }
    return response.data;
  } catch (err) {
    if (err.code === '503' || err.message?.includes('503')) {
      console.error('No responder — is mesh-tool-discord running?');
    } else if (err.code === 'TIMEOUT') {
      console.error('Request timed out.');
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i += 2;
    } else {
      positional.push(args[i]);
      i++;
    }
  }
  return { flags, positional };
}

function formatMessages(messages) {
  for (const m of messages) {
    const time = new Date(m.timestamp).toLocaleString('en-US', {
      timeZone: 'America/Montreal', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    const author = m.author.bot ? `[BOT] ${m.author.username}` : m.author.username;
    const attachments = m.attachments?.length ? ` [${m.attachments.length} attachment(s)]` : '';
    const reply = m.referencedMessage
      ? `  ↳ replying to ${m.referencedMessage.author}: "${m.referencedMessage.content?.slice(0, 80)}..."\n`
      : '';
    console.log(`[${time}] ${author}: ${m.content}${attachments}`);
    if (reply) process.stdout.write(reply);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
discord-read — Query Discord history via OpenClaw mesh

USAGE:
  discord-read history <channel-id> [--limit 50] [--before <msg-id>] [--after <msg-id>]
  discord-read search <guild-id> <query> [--channel <id>] [--author <id>] [--limit 25]
  discord-read channels <guild-id>
  discord-read channel-info <channel-id>
  discord-read tools                     — list registered mesh tools

ENVIRONMENT:
  OPENCLAW_NATS — NATS server URL (auto-detected from env or ~/.openclaw/openclaw.env)
`);
    process.exit(0);
  }

  const nc = await natsConnect();

  if (cmd === 'tools') {
    // List all mesh tools
    const js = nc.jetstream();
    const kv = await js.views.kv('MESH_TOOLS');
    const keys = await kv.keys();
    let found = false;
    for await (const key of keys) {
      const entry = await kv.get(key);
      if (entry && entry.value) {
        const manifest = JSON.parse(sc.decode(entry.value));
        console.log(`${manifest.node_id}/${manifest.name} v${manifest.version}`);
        console.log(`  ${manifest.description}`);
        for (const m of (manifest.methods || [])) {
          console.log(`  - ${m.name}: ${m.description}`);
        }
        console.log('');
        found = true;
      }
    }
    if (!found) console.log('No tools registered.');
    await nc.close();
    return;
  }

  // Find the discord-history tool provider
  const nodeId = await findDiscordToolNode(nc);
  if (!nodeId) {
    console.error('Discord history tool not found in registry. Is mesh-tool-discord running?');
    await nc.close();
    process.exit(1);
  }

  const { flags, positional } = parseArgs(rest);

  switch (cmd) {
    case 'history': {
      const channelId = positional[0];
      if (!channelId) { console.error('Usage: discord-read history <channel-id>'); process.exit(1); }
      const result = await callTool(nc, nodeId, 'readMessages', {
        channelId,
        limit: parseInt(flags.limit || '50'),
        before: flags.before,
        after: flags.after,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        formatMessages(result.reverse()); // Show oldest first
      }
      break;
    }

    case 'search': {
      const guildId = positional[0];
      const query = positional.slice(1).join(' ');
      if (!guildId || !query) { console.error('Usage: discord-read search <guild-id> <query>'); process.exit(1); }
      const result = await callTool(nc, nodeId, 'searchMessages', {
        guildId,
        query,
        channelId: flags.channel,
        authorId: flags.author,
        limit: parseInt(flags.limit || '25'),
      });
      console.log(`Found ${result.totalResults} result(s):`);
      formatMessages(result.messages);
      break;
    }

    case 'channels': {
      const guildId = positional[0];
      if (!guildId) { console.error('Usage: discord-read channels <guild-id>'); process.exit(1); }
      const result = await callTool(nc, nodeId, 'listChannels', { guildId });
      for (const ch of result) {
        const topic = ch.topic ? ` — ${ch.topic.slice(0, 60)}` : '';
        console.log(`  #${ch.name} (${ch.id}) [${ch.type}]${topic}`);
      }
      break;
    }

    case 'channel-info': {
      const channelId = positional[0];
      if (!channelId) { console.error('Usage: discord-read channel-info <channel-id>'); process.exit(1); }
      const result = await callTool(nc, nodeId, 'channelInfo', { channelId });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Run "discord-read help" for usage.');
      process.exit(1);
  }

  await nc.close();
}

main().catch(err => {
  console.error(`discord-read error: ${err.message}`);
  process.exit(1);
});
