/**
 * LLM client for the local extraction LLM via OpenAI-compatible HTTP API.
 *
 * Default backend: Ollama (cross-platform, single binary, dead-simple deploy).
 * Ollama exposes an OpenAI-compatible API at /v1/chat/completions and /v1/models
 * on port 11434. The same client also works with mlx-lm, llama-server, vLLM, or
 * any other OpenAI-compatible local server — just change LLM_BASE_URL.
 *
 * Default model: Qwen3-8B-Instruct (q4_K_M quantization, ~5 GB RAM). The
 * deployment installer (bin/check-llm-baseline.mjs) probes system RAM and
 * recommends a higher tier (Qwen3-14B for 32 GB systems, Qwen3-32B for 48 GB+).
 * Operators override via LLM_MODEL.
 *
 * Amended 2026-05-22 — runtime switched mlx-lm → Ollama, default model switched
 * Qwen2.5-27B → Qwen3-8B per operator decision for lightweight deployment.
 *
 * Configuration via environment variables:
 *   LLM_BASE_URL — server base URL (default: http://localhost:11434)
 *   LLM_MODEL    — Ollama-style model tag (default: qwen3:8b-instruct-q4_K_M)
 *   LLM_TIMEOUT  — request timeout in ms (default: 120000)
 */

export const DEFAULT_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
export const DEFAULT_MODEL = process.env.LLM_MODEL || 'qwen3:8b-instruct-q4_K_M';
export const DEFAULT_TIMEOUT = Number(process.env.LLM_TIMEOUT) || 120_000;

/**
 * Create an LLM client connected to an OpenAI-compatible local server
 * (Ollama by default; also works with mlx-lm, llama-server, vLLM).
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
