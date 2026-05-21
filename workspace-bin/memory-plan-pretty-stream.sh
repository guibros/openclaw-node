#!/usr/bin/env node
// memory-plan-pretty-stream.sh — reads claude `--output-format stream-json`
// events on stdin and emits a verbatim transcript on stdout.
//
// Renders full content (no truncation) with multi-line bodies indented under
// each event header. The intent is to make the headless tick produce the same
// kind of live transcript you see when watching an interactive Claude session:
// every tool call with full arguments, every tool result in full, every
// assistant message in full.
//
// Used by memory-plan-tick.sh. Each input line is one JSON event; output is
// one event header line plus indented body lines.

const readline = require('readline');

const ANSI = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
};

const PREFIX = '  │ ';
const SUB    = '  │   ';

function hms() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function indent(text, prefix = PREFIX) {
  if (text == null) return '';
  const str = String(text);
  if (str === '') return '';
  return str.split('\n').map(line => prefix + line).join('\n');
}

function formatToolArgs(name, input) {
  if (input == null || typeof input !== 'object') return '';
  // Edit/Write get a diff-style rendering with explicit old/new blocks.
  if ((name === 'Edit' || name === 'MultiEdit' || name === 'Write') &&
      typeof input === 'object') {
    const lines = [];
    if (input.file_path) lines.push(`file_path: ${input.file_path}`);
    if (input.old_string != null) {
      lines.push(`old_string:`);
      lines.push(indent(input.old_string, SUB));
    }
    if (input.new_string != null) {
      lines.push(`new_string:`);
      lines.push(indent(input.new_string, SUB));
    }
    if (input.content != null) {
      lines.push(`content:`);
      lines.push(indent(input.content, SUB));
    }
    if (input.edits) {
      lines.push(`edits: ${JSON.stringify(input.edits, null, 2)}`);
    }
    if (input.replace_all) lines.push(`replace_all: true`);
    return lines.join('\n');
  }
  // Default rendering for every other tool: key: value pairs.
  return Object.entries(input).map(([k, v]) => {
    if (v == null) return `${k}: null`;
    if (typeof v === 'string') {
      return v.includes('\n') ? `${k}:\n${indent(v, SUB)}` : `${k}: ${v}`;
    }
    if (typeof v === 'object') {
      const j = JSON.stringify(v, null, 2);
      return j.includes('\n') ? `${k}:\n${indent(j, SUB)}` : `${k}: ${j}`;
    }
    return `${k}: ${v}`;
  }).join('\n');
}

function formatToolResult(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') {
        if (typeof c.text === 'string') return c.text;
        return JSON.stringify(c);
      }
      return String(c);
    }).join('\n');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}

function header(time, color, tag, suffix = '') {
  return `${ANSI.dim}[${time}]${ANSI.reset} ${color}${tag}${ANSI.reset}${suffix ? '  ' + suffix : ''}`;
}

function emit(line) {
  process.stdout.write(line + '\n');
}

function formatUsage(usage) {
  if (!usage) return '';
  const parts = [];
  if (usage.input_tokens != null)             parts.push(`in=${usage.input_tokens}`);
  if (usage.cache_read_input_tokens)          parts.push(`cache_read=${usage.cache_read_input_tokens}`);
  if (usage.cache_creation_input_tokens)      parts.push(`cache_create=${usage.cache_creation_input_tokens}`);
  if (usage.output_tokens != null)            parts.push(`out=${usage.output_tokens}`);
  if (usage.service_tier && usage.service_tier !== 'standard') parts.push(`tier=${usage.service_tier}`);
  return parts.join('  ');
}

function handle(evt) {
  const t = hms();

  if (evt.type === 'system') {
    const bits = [];
    if (evt.subtype) bits.push(evt.subtype);
    if (evt.model) bits.push(`model=${evt.model}`);
    if (evt.session_id) bits.push(`session=${String(evt.session_id).slice(0, 8)}`);
    if (evt.cwd) bits.push(`cwd=${evt.cwd}`);
    if (Array.isArray(evt.tools) && evt.tools.length) bits.push(`tools=${evt.tools.length}`);
    if (evt.permissionMode) bits.push(`perm=${evt.permissionMode}`);
    emit(header(t, ANSI.dim, '━ sys  ', bits.join('  ')));
    if (Array.isArray(evt.tools) && evt.tools.length) {
      // Show the tool list so the user sees the agent's capability set.
      emit(indent('available tools: ' + evt.tools.join(', ')));
    }
    if (Array.isArray(evt.mcp_servers) && evt.mcp_servers.length) {
      const names = evt.mcp_servers.map(m => m.name || JSON.stringify(m)).join(', ');
      emit(indent('mcp servers: ' + names));
    }
    return;
  }

  if (evt.type === 'assistant') {
    const content = (evt.message && evt.message.content) || [];
    const usage = evt.message && evt.message.usage;
    const stopReason = evt.message && evt.message.stop_reason;
    const msgId = evt.message && evt.message.id ? String(evt.message.id).slice(0, 12) : null;
    for (const c of content) {
      if (!c) continue;
      if (c.type === 'text') {
        emit(header(t, ANSI.cyan, '◆ asst '));
        if (c.text) emit(indent(c.text));
      } else if (c.type === 'tool_use') {
        const id = c.id ? ' ' + ANSI.dim + '#' + String(c.id).slice(-6) + ANSI.reset : '';
        emit(header(t, ANSI.magenta, '→ tool ', `${ANSI.bold}${c.name}${ANSI.reset}${id}`));
        const body = formatToolArgs(c.name, c.input || {});
        if (body) emit(indent(body));
      } else if (c.type === 'thinking') {
        emit(header(t, ANSI.dim, '✻ think'));
        if (c.thinking) emit(indent(c.thinking));
      }
    }
    // Footer line per assistant message: token usage + stop reason + id.
    const u = formatUsage(usage);
    const trailerBits = [];
    if (u) trailerBits.push(u);
    if (stopReason) trailerBits.push(`stop=${stopReason}`);
    if (msgId) trailerBits.push(`msg=${msgId}`);
    if (trailerBits.length) {
      emit(`${ANSI.dim}    └─ ${trailerBits.join('  ')}${ANSI.reset}`);
    }
    return;
  }

  if (evt.type === 'user' && evt.message && Array.isArray(evt.message.content)) {
    for (const c of evt.message.content) {
      if (!c) continue;
      if (c.type === 'tool_result') {
        const id = c.tool_use_id ? ' ' + ANSI.dim + '#' + String(c.tool_use_id).slice(-6) + ANSI.reset : '';
        const tag = c.is_error ? `${ANSI.red}← ERR  ${ANSI.reset}` : `${ANSI.yellow}← res  ${ANSI.reset}`;
        emit(`${ANSI.dim}[${t}]${ANSI.reset} ${tag}${id}`);
        const body = formatToolResult(c.content);
        if (body) emit(indent(body));
      }
    }
    return;
  }

  if (evt.type === 'rate_limit_event') {
    const info = evt.rate_limit_info || {};
    const bits = [];
    if (info.status) bits.push(`status=${info.status}`);
    if (info.rateLimitType) bits.push(`type=${info.rateLimitType}`);
    if (info.resetsAt) {
      const resetDate = new Date(info.resetsAt * 1000);
      const resetHms = resetDate.toLocaleTimeString('en-GB', { hour12: false });
      const minsLeft = Math.max(0, Math.round((resetDate.getTime() - Date.now()) / 60000));
      bits.push(`resets=${resetHms} (${minsLeft}m)`);
    }
    if (info.isUsingOverage) bits.push('OVERAGE');
    const color = info.status === 'allowed' ? ANSI.dim : ANSI.yellow;
    emit(header(t, color, '◷ rate ', bits.join('  ')));
    return;
  }

  if (evt.type === 'result') {
    const cost = evt.total_cost_usd != null ? `$${Number(evt.total_cost_usd).toFixed(4)}` : '?';
    const dur  = evt.duration_ms != null ? `${Math.floor(evt.duration_ms / 1000)}s` : '?';
    const turns = evt.num_turns ?? '?';
    const sub = evt.subtype || '?';
    emit(header(t, ANSI.green, '━ END  ', `${sub}  cost=${cost}  dur=${dur}  turns=${turns}`));
    // Total usage breakdown if present.
    const u = formatUsage(evt.usage);
    if (u) emit(`${ANSI.dim}    total: ${u}${ANSI.reset}`);
    return;
  }

  // Unknown event type — emit the compact line PLUS a pretty-printed
  // JSON dump so we never silently drop information.
  if (evt.type) {
    emit(header(t, ANSI.dim, '? ' + evt.type, ''));
    try {
      const dump = JSON.stringify(evt, null, 2);
      emit(indent(dump));
    } catch {}
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let evt;
  try { evt = JSON.parse(trimmed); }
  catch {
    // Pass through unparseable lines (e.g., claude error text on stderr that
    // bled into stdout). Better to see it than swallow it.
    process.stdout.write(line + '\n');
    return;
  }
  try { handle(evt); }
  catch (err) {
    process.stdout.write(`[${hms()}] ${ANSI.red}prettifier error${ANSI.reset}: ${err.message}\n`);
    process.stdout.write(line + '\n');
  }
});
