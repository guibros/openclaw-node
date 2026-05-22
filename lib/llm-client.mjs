/**
 * LLM client for local Qwen3.5-27B-Instruct via mlx-lm server (OpenAI-compatible API).
 *
 * The mlx-lm server exposes an OpenAI-compatible HTTP API at /v1/chat/completions
 * and /v1/models. This module wraps those endpoints for use by the extraction pipeline.
 *
 * Configuration via environment variables:
 *   LLM_BASE_URL — server base URL (default: http://localhost:8080)
 *   LLM_MODEL    — model identifier (default: per frozen decision)
 *   LLM_TIMEOUT  — request timeout in ms (default: 120000)
 */

export const DEFAULT_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:8080';
export const DEFAULT_MODEL = process.env.LLM_MODEL || 'mlx-community/Qwen2.5-27B-Instruct-4bit';
export const DEFAULT_TIMEOUT = Number(process.env.LLM_TIMEOUT) || 120_000;

/**
 * Create an LLM client connected to a local mlx-lm server.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] — server base URL
 * @param {string} [opts.model]   — model identifier for chat completions
 * @param {number} [opts.timeout] — request timeout in milliseconds
 * @returns {{ generate: Function, healthCheck: Function }}
 */
export function createLlmClient(opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = opts.model || DEFAULT_MODEL;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

  /**
   * Generate a chat completion.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [genOpts]
   * @param {boolean} [genOpts.jsonMode] — request JSON-formatted output
   * @param {number}  [genOpts.maxTokens] — max tokens to generate (default: 4096)
   * @param {number}  [genOpts.temperature] — sampling temperature (default: 0.1)
   * @returns {Promise<{content: string, usage: object|null, finishReason: string|null}>}
   */
  async function generate(messages, genOpts = {}) {
    const body = {
      model,
      messages,
      max_tokens: genOpts.maxTokens ?? 4096,
      temperature: genOpts.temperature ?? 0.1,
    };

    if (genOpts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM server returned ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      const choice = json.choices?.[0];

      return {
        content: choice?.message?.content ?? '',
        usage: json.usage ?? null,
        finishReason: choice?.finish_reason ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check if the LLM server is reachable and which model is loaded.
   *
   * @returns {Promise<{ok: boolean, model: string|null, models: string[], error: string|null}>}
   */
  async function healthCheck() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        return { ok: false, model: null, models: [], error: `HTTP ${res.status}` };
      }

      const json = await res.json();
      const models = (json.data || []).map(m => m.id);
      const firstModel = models[0] || null;

      return { ok: true, model: firstModel, models, error: null };
    } catch (err) {
      return { ok: false, model: null, models: [], error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  return { generate, healthCheck };
}
