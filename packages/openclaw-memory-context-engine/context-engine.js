/**
 * context-engine.js — the OpenClaw ContextEngine backed by the memory daemon.
 *
 * Division of labour (this is what makes the engine small):
 *   - RECALL is the daemon's: assemble() posts the latest user prompt to
 *     /memory/inject and returns the daemon's block as the system-prompt
 *     addition. Retrieval, budgeting, directives (@memory deep/off/only:)
 *     and reconsolidation write-back all stay in lib/memory-injector.mjs.
 *   - EXTRACTION is the daemon's too: it tails the gateway's session JSONL
 *     (transcript-sources.json) and flushes on idle / session end / size, so
 *     ingest, afterTurn and commitTurn here record nothing.
 *   - COMPACTION is the host's: the engine does not own an archive, so
 *     compact() hands the request to OpenClaw's native compactor when the
 *     host exposes one, and otherwise reports "not compacted" honestly.
 *
 * Pure factory: no I/O of its own beyond the injected client, so the whole
 * surface is testable against a fake inject server.
 */

export const ENGINE_ID = 'openclaw-node-memory';
export const ENGINE_VERSION = '0.1.0';
export const FRONTEND_TAG = 'openclaw-context-engine';
export const DEFAULT_MAX_INJECTED_CHARS = 6000;
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

/** Text of an agent message: string content, or the joined text parts. */
export function messageText(message) {
  if (!message || typeof message !== 'object') return '';
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : ''))).filter(Boolean).join('\n');
  }
  return '';
}

export function lastUserPrompt(messages, prompt) {
  if (typeof prompt === 'string' && prompt.trim()) return prompt;
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      const t = messageText(m);
      if (t.trim()) return t;
    }
  }
  return '';
}

/** `*` matches within one key segment (segments split on `:`), `**` spans segments. */
export function compileSessionPattern(pattern) {
  const re = String(pattern)
    .split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^:]*'))
    .join('.*');
  return new RegExp(`^${re}$`);
}

export function isBypassed(sessionKey, patterns) {
  if (!sessionKey || !Array.isArray(patterns) || !patterns.length) return false;
  return patterns.some((p) => compileSessionPattern(p).test(sessionKey));
}

/**
 * @param {object} deps
 * @param {{inject:Function, health:Function}} deps.client — from memory-client.js
 * @param {object} [deps.config]
 * @param {{info:Function, warn?:Function, error:Function}} deps.logger
 * @param {(params:object)=>Promise<object>} [deps.runtimeCompact] — OpenClaw's native compactor, when the host exposes it
 */
export function createMemoryContextEngine({ client, config = {}, logger, runtimeCompact }) {
  const autoRecall = config.autoRecall !== false;
  const maxInjectedChars = Number(config.maxInjectedChars) || DEFAULT_MAX_INJECTED_CHARS;
  const bypass = Array.isArray(config.bypassSessionPatterns) ? config.bypassSessionPatterns : [];
  const warn = (m) => (logger.warn ? logger.warn(m) : logger.info(m));

  // commitTurn is retried by the host with the same advancementKey after a
  // failure; the contract wants "duplicate" the second time. Nothing is
  // written here, so a bounded in-memory set is the whole ledger.
  const seenAdvancements = new Set();
  const MAX_SEEN = 5000;

  // One warning per distinct failure reason, not one per turn: a daemon that
  // is down for an hour must not produce 400 identical log lines.
  let lastWarn = '';
  function warnOnce(msg) {
    if (msg === lastWarn) return;
    lastWarn = msg;
    warn(`${ENGINE_ID}: ${msg}`);
  }

  async function recall({ sessionId, sessionKey, prompt, messages }) {
    const query = lastUserPrompt(messages, prompt);
    if (query.length < 3) return null;
    const res = await client.inject({ prompt: query, session_id: sessionId || sessionKey, frontend: FRONTEND_TAG });
    lastWarn = '';
    const block = typeof res?.block === 'string' ? res.block : '';
    if (!block.trim()) return null;
    if (block.length > maxInjectedChars) {
      // Complete lines only: a half bullet is worse than one fewer bullet.
      const cut = block.lastIndexOf('\n', maxInjectedChars);
      return { block: block.slice(0, cut > 0 ? cut : maxInjectedChars) + '\n[end memory]', analysis: res.analysis, truncated: true };
    }
    return { block, analysis: res.analysis, truncated: false };
  }

  const engine = {
    info: {
      id: ENGINE_ID,
      name: 'openclaw-node memory',
      version: ENGINE_VERSION,
      ownsCompaction: true,
      transcriptSemantics: {
        currentTurnFence: 'before-current-turn-entry-v1',
        turnAdvancementIdempotency: 'atomic-idempotent-v1',
      },
    },

    // The daemon ingests from the session file, not from this hook.
    async ingest() {
      return { ingested: true };
    },
    async ingestBatch({ messages }) {
      return { ingestedCount: Array.isArray(messages) ? messages.length : 0 };
    },
    async afterTurn() {},

    async commitTurn({ advancementKey }) {
      if (advancementKey && seenAdvancements.has(advancementKey)) return { status: 'duplicate' };
      if (advancementKey) {
        if (seenAdvancements.size >= MAX_SEEN) seenAdvancements.delete(seenAdvancements.values().next().value);
        seenAdvancements.add(advancementKey);
      }
      return { status: 'committed' };
    },

    /**
     * Pass the messages through untouched and add the daemon's memory block
     * to the system prompt, within the host's token budget. Any failure
     * (daemon down, no token, timeout) degrades to "no memory this turn".
     */
    async assemble({ sessionId, sessionKey, messages = [], prompt, tokenBudget }) {
      const passthrough = { messages, estimatedTokens: messages.reduce((n, m) => n + estimateTokens(messageText(m)), 0) };
      if (!autoRecall || isBypassed(sessionKey, bypass)) return passthrough;
      let recalled;
      try {
        recalled = await recall({ sessionId, sessionKey, prompt, messages });
      } catch (err) {
        warnOnce(`recall unavailable, continuing without memory: ${err.message}`);
        return passthrough;
      }
      if (!recalled) return passthrough;
      const estimatedTokens = passthrough.estimatedTokens + estimateTokens(recalled.block);
      if (Number.isFinite(tokenBudget) && tokenBudget > 0 && estimatedTokens > tokenBudget) {
        warnOnce(`memory block (${estimateTokens(recalled.block)} tok) does not fit the turn budget (${tokenBudget}); skipped`);
        return passthrough;
      }
      return { ...passthrough, estimatedTokens, systemPromptAddition: recalled.block };
    },

    async compact(params) {
      if (typeof runtimeCompact === 'function') {
        try {
          const r = await runtimeCompact(params);
          if (r && typeof r === 'object') return r;
        } catch (err) {
          warnOnce(`host compaction failed: ${err.message}`);
        }
      }
      return { ok: true, compacted: false, reason: 'no_engine_archive_host_compaction_unavailable' };
    },
  };

  return engine;
}
