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
export const DEFAULT_MODEL = process.env.LLM_MODEL || 'qwen3:8b';
export const DEFAULT_TIMEOUT = Number(process.env.LLM_TIMEOUT) || 600_000;

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
// Lazy import of the queue — avoids circular-import risk in test environments
// that mock parts of this module.
let _queue = null;
async function getQueue() {
  if (!_queue) _queue = await import('./ollama-queue.mjs');
  return _queue;
}

export function createLlmClient(opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = opts.model || DEFAULT_MODEL;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

  /**
   * Generate a chat completion. Routes through the ollama-queue as an
   * extraction job — long-running, always waits to completion, no fallback.
   * For analysis-style calls that should fall back when the queue is busy,
   * use generateAnalysis() instead.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [genOpts]
   * @param {boolean} [genOpts.jsonMode] — request JSON-formatted output
   * @param {number}  [genOpts.maxTokens] — max tokens to generate (default: 4096)
   * @param {number}  [genOpts.temperature] — sampling temperature (default: 0.1)
   * @param {boolean} [genOpts.bypassQueue] — for tests; skip the queue wrapper
   * @returns {Promise<{content: string, usage: object|null, finishReason: string|null}>}
   */
  async function generate(messages, genOpts = {}) {
    // Use Ollama's NATIVE /api/chat endpoint (not /v1/chat/completions). Reason:
    // Qwen3 has thinking mode enabled by default and the OpenAI-compat layer
    // does NOT pass through the `think: false` toggle. With thinking on, the
    // model spends most of its token budget on internal reasoning before
    // producing JSON — extraction times out. The native endpoint accepts
    // `think: false` correctly. Non-Qwen models simply ignore the param.
    //
    // To use a non-Ollama backend (mlx-lm, llama-server, vLLM), set
    // LLM_NATIVE_API=false and the client falls back to /v1/chat/completions.
    const useNative = (process.env.LLM_NATIVE_API ?? 'true') !== 'false';
    const endpoint = useNative ? '/api/chat' : '/v1/chat/completions';
    const body = useNative
      ? {
          model,
          messages,
          think: false,                   // Qwen3: disable reasoning channel
          stream: false,
          options: {
            num_predict: genOpts.maxTokens ?? 4096,
            temperature:  genOpts.temperature ?? 0.1,
          },
          // Ollama supports a `format: "json"` flag on /api/chat for strict
          // JSON output. Less brittle than OpenAI's response_format on small
          // models. Applied when jsonMode is requested.
          ...(genOpts.jsonMode ? { format: 'json' } : {}),
        }
      : {
          model,
          messages,
          max_tokens: genOpts.maxTokens ?? 4096,
          temperature: genOpts.temperature ?? 0.1,
          ...(genOpts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        };

    // The actual fetch call — wrapped so we can hand it to the queue.
    const runFetch = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(`${baseUrl}${endpoint}`, {
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
        if (useNative) {
          return {
            content: json.message?.content ?? '',
            usage: {
              prompt_tokens:     json.prompt_eval_count ?? 0,
              completion_tokens: json.eval_count ?? 0,
              total_tokens:      (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
            },
            finishReason: json.done_reason ?? null,
          };
        }
        const choice = json.choices?.[0];
        return {
          content: choice?.message?.content ?? '',
          usage: json.usage ?? null,
          finishReason: choice?.finish_reason ?? null,
        };
      } finally {
        clearTimeout(timer);
      }
    };

    if (genOpts.bypassQueue) return runFetch();

    // Route through the queue as an extraction job (long-running, no fallback).
    const queue = await getQueue();
    const payloadSize = JSON.stringify(messages).length;
    return queue.requestExtraction(runFetch, { payloadSize, model });
  }

  /**
   * Analysis-style generation. Routes through the queue with a short wait
   * timeout; returns a fallback marker if the queue is busy with extraction
   * or if the analysis itself doesn't complete in time.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [genOpts]
   * @param {number} [genOpts.waitTimeoutMs=1000] — wait+execute ceiling before fallback
   * @param {boolean} [genOpts.jsonMode]
   * @param {number}  [genOpts.maxTokens=512] — analysis output is short
   * @param {number}  [genOpts.temperature=0.0]
   * @returns {Promise<
   *   { mode: 'llm', value: {content, usage, finishReason}, ms: number }
   * | { mode: 'fallback', reason: string, ollama_state: object|null, eta_ms: number|null }
   * >}
   */
  async function generateAnalysis(messages, genOpts = {}) {
    const useNative = (process.env.LLM_NATIVE_API ?? 'true') !== 'false';
    const endpoint = useNative ? '/api/chat' : '/v1/chat/completions';
    const body = useNative
      ? {
          model,
          messages,
          think: false,
          stream: false,
          options: {
            num_predict: genOpts.maxTokens ?? 512,
            temperature: genOpts.temperature ?? 0.0,
          },
          ...(genOpts.jsonMode ? { format: 'json' } : {}),
        }
      : {
          model,
          messages,
          max_tokens: genOpts.maxTokens ?? 512,
          temperature: genOpts.temperature ?? 0.0,
          ...(genOpts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        };

    const runFetch = async () => {
      // Use a short wall timeout — analyses are short by design.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), genOpts.waitTimeoutMs ?? 1000);
      try {
        const res = await fetch(`${baseUrl}${endpoint}`, {
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
        if (useNative) {
          return {
            content: json.message?.content ?? '',
            usage: {
              prompt_tokens:     json.prompt_eval_count ?? 0,
              completion_tokens: json.eval_count ?? 0,
              total_tokens:      (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
            },
            finishReason: json.done_reason ?? null,
          };
        }
        const choice = json.choices?.[0];
        return {
          content: choice?.message?.content ?? '',
          usage: json.usage ?? null,
          finishReason: choice?.finish_reason ?? null,
        };
      } finally {
        clearTimeout(timer);
      }
    };

    const queue = await getQueue();
    return queue.requestAnalysis(runFetch, {
      waitTimeoutMs: genOpts.waitTimeoutMs ?? 1000,
      payloadSize: JSON.stringify(messages).length,
      model,
    });
  }

  /**
   * Check if the LLM server is reachable and which model is loaded.
   *
   * @returns {Promise<{ok: boolean, model: string|null, models: string[], error: string|null}>}
   */
  async function healthCheck() {
    const useNative = (process.env.LLM_NATIVE_API ?? 'true') !== 'false';
    const endpoint = useNative ? '/api/tags' : '/v1/models';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${baseUrl}${endpoint}`, { signal: controller.signal });

      if (!res.ok) {
        return { ok: false, model: null, models: [], error: `HTTP ${res.status}` };
      }

      const json = await res.json();
      const models = useNative
        ? (json.models || []).map(m => m.name || m.model)
        : (json.data   || []).map(m => m.id);
      const firstModel = models[0] || null;

      return { ok: true, model: firstModel, models, error: null };
    } catch (err) {
      return { ok: false, model: null, models: [], error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  return { generate, generateAnalysis, healthCheck };
}
