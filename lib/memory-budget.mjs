/**
 * memory-budget.mjs — MEMORY.md Character Budget + Frozen Snapshot
 *
 * Enforces a hard character cap on MEMORY.md (~2,200 chars, matching Hermes's
 * proven bound) and provides frozen-snapshot semantics per session.
 *
 * Key concepts:
 *   - Session start: snapshot MEMORY.md and freeze it for the prompt
 *   - Mid-session writes: persist to disk but DON'T mutate the active prompt
 *   - On compression rebuild or new session: reload from disk
 *   - Usage meter: tracks % used, emits warnings at thresholds
 *
 * EventEmitter events:
 *   - 'add'     { entry, usedChars, totalBudget, pctUsed }
 *   - 'warning' { pctUsed, message }
 *   - 'trim'    { removed, reason }
 *   - 'freeze'  { charCount, lineCount }
 *   - 'reload'  { charCount, lineCount }
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { createTracer } = _require('./tracer');
const tracer = createTracer('memory-budget');

const DEFAULT_CHAR_BUDGET = 2200;
const WARNING_THRESHOLD = 0.80; // warn at 80%
const CRITICAL_THRESHOLD = 0.95; // critical at 95%

export class MemoryBudget extends EventEmitter {
  #filePath;
  #charBudget;
  #frozenContent = null; // snapshot at session start
  #frozenAt = null;
  #eventLog = null;       // optional local event log for dual-write
  #sessionId = null;      // UUID generated per session for event entity_id
  #nodeId = null;         // node identifier for event envelope

  /**
   * @param {string} filePath - Absolute path to MEMORY.md
   * @param {Object} opts
   * @param {number} opts.charBudget - Character budget (default 2200)
   * @param {object} opts.eventLog - Optional local event log (from createLocalEventLog)
   * @param {string} opts.nodeId - Optional node identifier for event envelope
   */
  constructor(filePath, opts = {}) {
    super();
    this.#filePath = filePath;
    this.#charBudget = opts.charBudget || DEFAULT_CHAR_BUDGET;
    this.#eventLog = opts.eventLog || null;
    this.#nodeId = opts.nodeId || null;
  }

  get filePath() { return this.#filePath; }
  get charBudget() { return this.#charBudget; }
  get isFrozen() { return this.#frozenContent !== null; }

  // ── Snapshot Lifecycle ────────────────────────────────────

  /**
   * Freeze MEMORY.md content for this session.
   * Call at session start (Phase 0 bootstrap).
   * Returns the frozen content for prompt injection.
   */
  startSession() {
    this.#frozenContent = this.#readFile();
    this.#frozenAt = Date.now();
    this.#sessionId = crypto.randomUUID();

    const stats = this.#computeStats(this.#frozenContent);
    this.emit('freeze', {
      charCount: this.#frozenContent.length,
      lineCount: this.#frozenContent.split('\n').length,
      ...stats,
    });

    // Dual-write: publish session_started event (fire-and-forget)
    this.#publishEvent('memory.session_started', {
      session_id: this.#sessionId,
      start_time: new Date().toISOString(),
      session_type: 'daemon',
    });

    return this.#frozenContent;
  }

  /**
   * Get the frozen (session-start) content for prompt rendering.
   * Returns the frozen snapshot — NOT the live disk content.
   * This is the core of deterministic prompt content per session.
   */
  getRendered() {
    if (this.#frozenContent === null) {
      // Not frozen yet — return live content (pre-session or fallback)
      return this.#readFile();
    }
    return this.#frozenContent;
  }

  /**
   * Reload from disk and update the frozen snapshot.
   * Call after compression rebuild or at new session start.
   */
  reload() {
    this.#frozenContent = this.#readFile();
    this.#frozenAt = Date.now();

    const stats = this.#computeStats(this.#frozenContent);
    this.emit('reload', {
      charCount: this.#frozenContent.length,
      lineCount: this.#frozenContent.split('\n').length,
      ...stats,
    });

    return this.#frozenContent;
  }

  /**
   * End the session — clear the frozen snapshot.
   */
  endSession() {
    // Dual-write: publish session_ended event (fire-and-forget, before clearing state)
    if (this.#sessionId && this.#frozenAt) {
      this.#publishEvent('memory.session_ended', {
        session_id: this.#sessionId,
        end_time: new Date().toISOString(),
        duration_ms: Date.now() - this.#frozenAt,
        turn_count: 0,  // not tracked at this layer; accurate counts come from session-store
      });
    }

    this.#frozenContent = null;
    this.#frozenAt = null;
    this.#sessionId = null;
  }

  // ── Budget-Aware Write ────────────────────────────────────

  /**
   * Add an entry to MEMORY.md on disk (not the frozen prompt).
   * Respects character budget. Returns false if over budget.
   *
   * @param {string} entry - The line to add (without leading "- ")
   * @param {Object} opts
   * @param {string} opts.section - Section to add under (default "Recent")
   * @returns {{ added: boolean, pctUsed: number, charsRemaining: number }}
   */
  addEntry(entry, opts = {}) {
    const { section = 'Recent' } = opts;
    let content = this.#readFile();
    const line = `- ${entry}`;
    const newLength = content.length + line.length + 1; // +1 for newline

    if (newLength > this.#charBudget) {
      // Try trimming oldest entries first
      const trimmed = this.#trimOldest(content, line.length + 1);
      if (trimmed) {
        content = trimmed;
      } else {
        return { added: false, pctUsed: this.#pctUsed(content), charsRemaining: 0 };
      }
    }

    // Ensure section exists
    if (!content.includes(`## ${section}`)) {
      content = content.trimEnd() + `\n\n## ${section}\n`;
    }

    content = content.trimEnd() + `\n${line}\n`;
    this.#writeFile(content);

    const pctUsed = this.#pctUsed(content);
    const charsRemaining = Math.max(0, this.#charBudget - content.length);

    this.emit('add', {
      entry,
      usedChars: content.length,
      totalBudget: this.#charBudget,
      pctUsed,
      charsRemaining,
    });

    // Dual-write: publish fact_extracted event (fire-and-forget)
    this.#publishEvent('memory.fact_extracted', {
      session_id: this.#sessionId || 'unknown',
      fact: entry,
      category: opts.section || 'Recent',
      speaker: 'user',
    });

    // Threshold warnings
    if (pctUsed >= CRITICAL_THRESHOLD * 100) {
      this.emit('warning', {
        pctUsed,
        message: `MEMORY.md at ${pctUsed}% capacity (${charsRemaining} chars remaining)`,
      });
    } else if (pctUsed >= WARNING_THRESHOLD * 100) {
      this.emit('warning', {
        pctUsed,
        message: `MEMORY.md approaching limit: ${pctUsed}% used (${charsRemaining} chars remaining)`,
      });
    }

    return { added: true, pctUsed, charsRemaining };
  }

  // ── Usage Meter ────────────────────────────────────

  /**
   * Get current budget usage stats.
   * @returns {{ usedChars: number, totalBudget: number, pctUsed: number, charsRemaining: number, lineCount: number, meterDisplay: string }}
   */
  getStats() {
    const content = this.#readFile();
    return this.#computeStats(content);
  }

  /**
   * Render a usage meter string for logging/display.
   * Example: "[67% — 1,474/2,200 chars]"
   */
  getMeterDisplay() {
    return this.#computeStats(this.#readFile()).meterDisplay;
  }

  // ── Event Log (dual-write) ────────────────────────────

  /**
   * Fire-and-forget publish to the local event log.
   * All errors are caught and silently ignored — the event log is
   * shadow-mode infrastructure and must never block MEMORY.md writes.
   */
  #publishEvent(eventType, data) {
    if (!this.#eventLog) return;
    try {
      const eventId = crypto.randomUUID();
      const event = {
        event_id: eventId,
        event_type: eventType,
        event_version: 1,
        entity_id: this.#sessionId || crypto.randomUUID(),
        entity_type: 'session',
        timestamp: new Date().toISOString(),
        causation_id: null,
        correlation_id: null,
        actor: { type: 'system', id: `daemon-${this.#nodeId || 'unknown'}` },
        node_id: this.#nodeId || 'unknown',
        idempotency_key: eventId,
        data,
      };
      this.#eventLog.publishLocal(event).catch(() => {});
    } catch {
      // Silent — dual-write must never disrupt the primary path
    }
  }

  // ── Private Helpers ────────────────────────────────────

  #readFile() {
    if (!fs.existsSync(this.#filePath)) return '';
    return fs.readFileSync(this.#filePath, 'utf-8');
  }

  #writeFile(content) {
    const dir = path.dirname(this.#filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.#filePath, content);
  }

  #pctUsed(content) {
    return Math.round((content.length / this.#charBudget) * 100);
  }

  #computeStats(content) {
    const usedChars = content.length;
    const pctUsed = this.#pctUsed(content);
    const charsRemaining = Math.max(0, this.#charBudget - usedChars);
    const lineCount = content.split('\n').length;
    const meterDisplay = `[${pctUsed}% — ${usedChars.toLocaleString()}/${this.#charBudget.toLocaleString()} chars]`;

    return { usedChars, totalBudget: this.#charBudget, pctUsed, charsRemaining, lineCount, meterDisplay };
  }

  /**
   * Trim the oldest bullet entries to free up space.
   * Returns the trimmed content, or null if can't free enough.
   */
  #trimOldest(content, bytesNeeded) {
    const lines = content.split('\n');
    const bulletIndices = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('- ') || lines[i].startsWith('* ')) {
        bulletIndices.push(i);
      }
    }

    if (bulletIndices.length === 0) return null;

    // Remove bullets from the top until we have enough space
    let freed = 0;
    const toRemove = new Set();

    for (const idx of bulletIndices) {
      if (freed >= bytesNeeded) break;
      freed += lines[idx].length + 1;
      toRemove.add(idx);

      this.emit('trim', { removed: lines[idx], reason: 'budget overflow' });
    }

    if (freed < bytesNeeded) return null;

    const trimmed = lines.filter((_, i) => !toRemove.has(i)).join('\n');
    return trimmed;
  }
}

/**
 * Create a MemoryBudget instance with default OpenClaw paths.
 * @param {string} workspace - OpenClaw workspace root
 * @param {Object} opts - Options forwarded to MemoryBudget constructor
 */
const _createBudget = function createBudget(workspace, opts = {}) {
  const filePath = path.join(workspace, 'MEMORY.md');
  const instance = new MemoryBudget(filePath, opts);
  tracer.wrapClass(instance, [
    'startSession', 'getRendered', 'reload', 'endSession',
    'addEntry', 'getStats', 'getMeterDisplay',
  ], { tier: 3, category: 'io' });
  return instance;
};
export { _createBudget as createBudget };
