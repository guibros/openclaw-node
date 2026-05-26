/**
 * injection-logger.mjs — JSONL log of every memory injection event.
 *
 * One JSON line per call to the memory injector. Purpose:
 *   - Tuning: which channels deliver value, which add noise
 *   - Debugging: "why didn't memory surface X?" — grep the log for that prompt
 *   - Cost / latency aggregation per frontend
 *   - Privacy auditing: see what's being surfaced from past sessions
 *
 * Output: ~/.openclaw/workspace/logs/memory-injections.jsonl
 *
 * Each line:
 *   {
 *     ts:              "2026-05-23T15:35:22.123Z",
 *     session_id:      "abc123",
 *     frontend:        "companion-bridge" | "openai-wrapper" | ...,
 *     prompt_excerpt:  first 200 chars,
 *     directive:       null | "off" | "deep" | "none" | "only:X",
 *     analysis_mode:   "llm" | "embedding-fallback",
 *     fallback_reason: null | "ollama-busy-extraction" | ...,
 *     ollama_state:    {...} | null,
 *     channels_used:   { fts5, semantic, entity, theme, spread } each {candidates, kept},
 *     items_injected:  { concepts: [...], decisions: [...], sessions: [...] },
 *     total_tokens:    number,
 *     latency_ms:      { analysis, retrieve, curate, total }
 *   }
 *
 * @module lib/injection-logger
 */

import { appendFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_LOG_PATH = process.env.INJECTION_LOG_PATH
  || join(homedir(), '.openclaw/workspace/logs/memory-injections.jsonl');

const ROTATE_AT_BYTES = Number(process.env.INJECTION_LOG_ROTATE_BYTES) || 50 * 1024 * 1024;  // 50 MB
const DISABLED = process.env.INJECTION_LOG_DISABLED === '1';

// ─── State ───────────────────────────────────────────────────────────────────

let ensuredDir = false;

async function ensureDir() {
  if (ensuredDir) return;
  await mkdir(dirname(DEFAULT_LOG_PATH), { recursive: true });
  ensuredDir = true;
}

async function rotateIfBig(path) {
  try {
    const s = await stat(path);
    if (s.size < ROTATE_AT_BYTES) return;
    const rotated = path.replace(/\.jsonl$/, `.${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    const { rename } = await import('node:fs/promises');
    await rename(path, rotated);
  } catch {
    // file doesn't exist yet — that's fine
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Append one injection record to the log. Best-effort — never throws.
 *
 * @param {object} record
 */
export async function logInjection(record) {
  if (DISABLED) return;
  try {
    await ensureDir();
    await rotateIfBig(DEFAULT_LOG_PATH);
    const enriched = {
      ts: new Date().toISOString(),
      ...record,
    };
    await appendFile(DEFAULT_LOG_PATH, JSON.stringify(enriched) + '\n');
  } catch (err) {
    // Best-effort — don't break the user's request because logging failed
    process.stderr.write(`[injection-logger] write failed: ${err.message}\n`);
  }
}

/**
 * Shape helper for the channels_used field. Each channel reports how many
 * candidates the retrieval returned and how many survived curation.
 */
export function channelStats(candidates, kept) {
  return { candidates: candidates ?? 0, kept: kept ?? 0 };
}

/**
 * F-L11 fix: scrub well-known secret/credential patterns before logging.
 * The prompt may contain API keys, tokens, or other secrets the user typed.
 * This regex set is a conservative safety net — not exhaustive, but covers
 * the most common shapes seen in the wild. Operators wanting strict privacy
 * should set INJECTION_LOG_DISABLED=1.
 */
const SECRET_PATTERNS = [
  /\b(sk-[A-Za-z0-9]{20,})\b/g,                                      // OpenAI-style keys
  /\b(AKIA[0-9A-Z]{16})\b/g,                                          // AWS access key
  /\b(ghp_[A-Za-z0-9]{36})\b/g,                                       // GitHub PAT
  /\b(ghs_[A-Za-z0-9]{36})\b/g,                                       // GitHub server token
  /\b(xoxb-[A-Za-z0-9-]{20,})\b/g,                                    // Slack bot token
  /\bBearer\s+([A-Za-z0-9_.~+\-=/]{20,})/gi,                          // Bearer tokens
  /\b(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g, // JWT
];

function scrubSecrets(text) {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_match, _captured) => '[REDACTED]');
  }
  return out;
}

/**
 * Trim a prompt for the log excerpt — privacy + size bound.
 * Now also scrubs common credential patterns before excerpting.
 */
export function promptExcerpt(prompt, max = 200) {
  if (!prompt) return '';
  const flat = String(prompt).replace(/\s+/g, ' ').trim();
  const scrubbed = scrubSecrets(flat);
  return scrubbed.length > max ? scrubbed.slice(0, max) + '…' : scrubbed;
}

// ─── Log Path Inspection (for stats utility) ─────────────────────────────────

export function getLogPath() {
  return DEFAULT_LOG_PATH;
}
