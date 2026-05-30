import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

const STREAM_PREFIX = 'local-events';

export function classifyStatus(event) {
  const type = event.event_type;
  if (type === 'memory.error') return 'error';

  const d = event.data || {};
  switch (type) {
    case 'memory.ingested':   return d.messages_added > 0 ? 'ok' : 'noop';
    case 'memory.extracted':  return (d.entities_count + d.themes_count + d.mentions_count + d.decisions_count) > 0 ? 'ok' : 'noop';
    case 'memory.retrieved':  return d.results_count > 0 ? 'ok' : 'noop';
    case 'memory.injected':   return d.blocks_count > 0 ? 'ok' : 'noop';
    case 'memory.synthesized': return (d.artifacts_written?.length || 0) > 0 ? 'ok' : 'noop';
    case 'memory.decayed':    return d.entities_decayed > 0 ? 'ok' : 'noop';
    case 'memory.promoted':   return d.entities_promoted > 0 ? 'ok' : 'noop';
    default:                  return 'ok';
  }
}

export function toWatcherRecord(event) {
  return {
    ts: event.timestamp,
    op: event.event_type,
    status: classifyStatus(event),
    actor: event.actor?.id || null,
    session: event.data?.session_id || null,
    duration_ms: event.data?.duration_ms ?? null,
  };
}

export async function createMemoryWatcher(nc, nodeId, opts = {}) {
  const outputPath = opts.outputPath || path.join(os.homedir(), '.openclaw', 'watcher.jsonl');
  const log = opts.log || (() => {});

  const streamName = `${STREAM_PREFIX}-${nodeId}`;
  const consumerName = `watcher-${nodeId}`;

  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();

  try {
    await jsm.consumers.info(streamName, consumerName);
  } catch {
    await jsm.consumers.add(streamName, {
      durable_name: consumerName,
      deliver_policy: _require('nats').DeliverPolicy.All,
    });
  }

  const consumer = await js.consumers.get(streamName, consumerName);
  const iter = await consumer.consume();
  let running = true;

  const processingLoop = (async () => {
    for await (const msg of iter) {
      if (!running) break;
      try {
        const event = JSON.parse(msg.string());
        const record = toWatcherRecord(event);
        fs.appendFileSync(outputPath, JSON.stringify(record) + '\n');
        msg.ack();
      } catch (e) {
        log(`watcher: failed to process message: ${e.message}`);
        msg.ack();
      }
    }
  })().catch(() => {});

  log(`Memory watcher initialized (consumer: ${consumerName}, output: ${outputPath})`);

  return {
    stop() {
      running = false;
      iter.stop();
      return processingLoop;
    },
  };
}
