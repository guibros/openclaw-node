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

/**
 * Map JSONL entry types to trace categories and tiers.
 * Intentionally generic — not tied to any specific LLM provider.
 */
const ENTRY_MAP = {
  // User/operator sent a message
  user:               { fn: 'message.user',       tier: 1, category: 'lifecycle' },
  // Agent produced a response
  assistant:          { fn: 'message.assistant',   tier: 2, category: 'lifecycle' },
  // Agent invoked a tool
  tool_use:           { fn: 'tool.call',           tier: 1, category: 'state_transition' },
  tool_result:        { fn: 'tool.result',         tier: 2, category: 'compute' },
  // Tool/action result
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
  // Tool call summary
  if (entry.type === 'tool_use') {
    const tool = entry.tool || entry.name || entry.tool_name || 'unknown';
    return `tool=${tool}`;
  }

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

export function createSessionTraceEmitter(tracer) {
  // Track file positions per path so multiple JSONL files can be watched simultaneously
  const _fileState = new Map(); // path → { lastSize }

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

        let emitted = 0;
        for (const line of lines) {
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            continue; // Skip malformed lines (including partial first line)
          }

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
    },
  };
}
