/**
 * session-trace-emitter.mjs — Real-time JSONL → trace event bridge.
 *
 * Watches the active session's JSONL file for new entries and emits structured
 * trace events to the observability pipeline. Every local interaction (tool call,
 * message, cost update, permission request) appears in the live feed.
 *
 * LLM-agnostic: works with any agent that writes JSONL transcripts.
 * Designed for the memory daemon's tick loop (Phase 1.5).
 *
 * Usage:
 *   import { createSessionTraceEmitter } from './session-trace-emitter.mjs';
 *   const emitter = createSessionTraceEmitter(tracer);
 *   // Each tick:
 *   emitter.processNewEntries(sessionJsonlPath);
 */

import fs from 'fs';
import path from 'path';

/**
 * Map JSONL entry types to trace categories and tiers.
 * Intentionally generic — not tied to any specific LLM provider.
 */
const ENTRY_MAP = {
  // User/operator sent a message
  user:               { fn: 'message.user',       tier: 1, category: 'lifecycle' },
  // Agent produced a response
  assistant:          { fn: 'message.assistant',   tier: 2, category: 'lifecycle' },
  // Tool activity is NOT keyed here: in the transcript shape lib/transcript-parser.mjs
  // documents, `tool_use`/`tool_result` are content blocks inside the message, never a
  // top-level entry type. emitToolActivity() below owns them, for both shapes.
  result:             { fn: 'tool.result',         tier: 2, category: 'compute' },
  // Agent is computing
  progress:           { fn: 'agent.progress',      tier: 3, category: 'compute' },
  // Awaiting human decision
  permission_request: { fn: 'agent.permission',    tier: 1, category: 'cross_node' },
  // Error in agent execution
  error:              { fn: 'agent.error',         tier: 1, category: 'error' },
  // System message (context injection, etc.)
  system:             { fn: 'message.system',      tier: 2, category: 'lifecycle' },
  // Session summary (end of conversation)
  summary:            { fn: 'session.summary',     tier: 1, category: 'lifecycle' },
};

/**
 * Extract a human-readable summary from a JSONL entry.
 * Handles multiple transcript formats (Claude Code, gateway, etc.).
 */
function summarizeEntry(entry) {
  // Message summary (truncated content)
  if (entry.message?.content) {
    const content = typeof entry.message.content === 'string'
      ? entry.message.content
      : JSON.stringify(entry.message.content);
    return content.slice(0, 100);
  }

  // Permission request
  if (entry.type === 'permission_request') {
    return entry.tool || entry.permission || 'permission_requested';
  }

  // Error
  if (entry.type === 'error') {
    return (entry.error || entry.message || 'unknown error').slice?.(0, 100) || 'error';
  }

  // Summary
  if (entry.type === 'summary' && entry.summary) {
    return entry.summary.slice(0, 100);
  }

  // Fallback
  return entry.type || 'unknown';
}

/**
 * Extract cost info from an entry if present.
 * Handles multiple cost field formats.
 */
function extractCost(entry) {
  if (entry.costUSD) return { cost: entry.costUSD };
  if (entry.estimatedCostUsd) return { cost: entry.estimatedCostUsd };
  if (entry.usage) {
    return {
      input_tokens: entry.usage.input_tokens || 0,
      output_tokens: entry.usage.output_tokens || 0,
      cache_read: entry.usage.cache_read_input_tokens || 0,
    };
  }
  return null;
}

/**
 * The session a transcript belongs to, taken from its filename.
 *
 * The emitter is the only component in the pipeline that knows which run an
 * event came from — the daemon hands it the path, and every writer of these
 * files names them for the session. Without this, rows from every session land
 * in one flat table with nothing to group them by.
 */
function sessionIdOf(jsonlPath) {
  return path.basename(jsonlPath).replace(/\.jsonl$/i, '') || null;
}

/**
 * Pull the salient identifier out of a tool's input.
 *
 * Which operation ran is the diagnostic signal; a whole prompt or file body
 * would consume the summary budget without adding any.
 */
function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return '';
  const salient = input.command ?? input.file_path ?? input.path ?? input.pattern
    ?? input.url ?? input.query ?? input.description;
  if (typeof salient === 'string') {
    return salient.length > 80 ? salient.slice(0, 77) + '...' : salient;
  }
  const keys = Object.keys(input);
  return keys.length ? `{${keys.slice(0, 4).join(',')}}` : '';
}

/** Tool results carry either a plain string or an array of content parts. */
function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).filter(Boolean).join(' ');
  }
  return content == null ? '' : JSON.stringify(content);
}

// A tool_use whose result never arrives (truncated read, abandoned session)
// would otherwise pin its entry forever.
const MAX_PENDING_TOOLS = 500;

/**
 * Emit the tool activity carried by one transcript entry.
 *
 * Tool calls live in `message.content` blocks, so they are emitted separately
 * from the entry-type envelope — one entry can legitimately produce both. The
 * id pairing mirrors what workspace-bin/subagent-audit.mjs already does over
 * these same files.
 *
 * @param {object} entry — parsed JSONL entry
 * @param {object} tracer
 * @param {Map<string,string>} pending — tool_use id → tool name, spans ticks
 * @returns {number} events emitted
 */
function emitToolActivity(entry, tracer, pending, sessionId) {
  let emitted = 0;

  const emitResult = (id, isError, text) => {
    const tool = (id && pending.get(id)) || 'unknown';
    if (id) pending.delete(id);
    const detail = text.slice(0, 120);
    tracer.emit('tool.result', {
      tier: isError ? 1 : 2,
      // A failed tool call is the fault the trace exists to capture. Filing it
      // as ordinary compute would let smart-mode sampling drop it, leaving only
      // the downstream symptom visible.
      category: isError ? 'error' : 'compute',
      args_summary: `tool=${tool}`,
      result_summary: detail,
      error: isError ? (detail || 'tool_error') : null,
      session_id: sessionId,
    });
    emitted++;
  };

  const content = entry?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'tool_use') {
        const tool = block.name || 'unknown';
        if (block.id) {
          if (pending.size >= MAX_PENDING_TOOLS) pending.delete(pending.keys().next().value);
          pending.set(block.id, tool);
        }
        tracer.emit('tool.call', {
          tier: 1,
          category: 'state_transition',
          args_summary: `tool=${tool}`,
          result_summary: summarizeToolInput(block.input),
          session_id: sessionId,
        });
        emitted++;
      } else if (block?.type === 'tool_result') {
        emitResult(block.tool_use_id, block.is_error === true, toolResultText(block.content));
      }
    }
  }

  // Gateway and older transcripts put the result at the top level instead.
  if (entry?.type === 'tool_result' && entry.tool_use_id) {
    emitResult(entry.tool_use_id, entry.is_error === true, toolResultText(entry.content));
  }

  return emitted;
}

export function createSessionTraceEmitter(tracer) {
  // Track file positions per path so multiple JSONL files can be watched simultaneously
  const _fileState = new Map(); // path → { lastSize }
  // A tool call and its result usually land in different ticks, so the pairing
  // has to outlive a single processNewEntries() call.
  const _pendingTools = new Map(); // tool_use id → tool name

  return {
    /**
     * Read new entries from a JSONL file and emit trace events.
     * Supports being called with different paths each tick (multi-source).
     *
     * @param {string} jsonlPath — path to a session's .jsonl file
     */
    processNewEntries(jsonlPath) {
      if (!jsonlPath || !fs.existsSync(jsonlPath)) return;

      // Get or create tracking state for this file
      if (!_fileState.has(jsonlPath)) {
        // New file — initialize. Set lastSize to current size minus 64KB
        // so we process recent history on first encounter.
        try {
          const initStat = fs.statSync(jsonlPath);
          const initSize = Math.max(0, initStat.size - 65536);
          _fileState.set(jsonlPath, { lastSize: initSize });
          console.log(`[session-trace] Tracking: ${jsonlPath} (from offset ${initSize})`);
        } catch { return; }
      }

      const state = _fileState.get(jsonlPath);

      // Check if file has grown
      let stat;
      try {
        stat = fs.statSync(jsonlPath);
      } catch { return; }

      if (stat.size <= state.lastSize) return; // No new data

      // Read only the new portion
      const fd = fs.openSync(jsonlPath, 'r');
      try {
        const newBytes = stat.size - state.lastSize;
        // Cap at 64KB per tick to avoid blocking
        const readSize = Math.min(newBytes, 65536);
        const offset = stat.size - readSize;
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, offset);

        const chunk = buffer.toString('utf8');
        const lines = chunk.split('\n').filter(Boolean);
        const sessionId = sessionIdOf(jsonlPath);

        let emitted = 0;
        for (const line of lines) {
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            continue; // Skip malformed lines (including partial first line)
          }

          emitted += emitToolActivity(entry, tracer, _pendingTools, sessionId);

          const mapping = ENTRY_MAP[entry.type];
          if (!mapping) continue; // Unknown type — skip

          // Skip high-frequency progress events unless in dev mode
          if (entry.type === 'progress' && process.env.OPENCLAW_TRACE_MODE !== 'dev') continue;

          const summary = summarizeEntry(entry);
          const cost = extractCost(entry);

          tracer.emit(mapping.fn, {
            tier: mapping.tier,
            category: mapping.category,
            args_summary: summary,
            result_summary: entry.model || '',
            meta: cost ? JSON.stringify(cost) : null,
            session_id: sessionId,
          });
          emitted++;
        }

        state.lastSize = stat.size;

        if (emitted > 0) {
          console.log(`[session-trace] Emitted ${emitted} events from ${jsonlPath.split('/').pop()}`);
        }
      } finally {
        fs.closeSync(fd);
      }
    },

    /**
     * Reset tracking state (call on session end).
     */
    reset() {
      _fileState.clear();
      _pendingTools.clear();
    },
  };
}
