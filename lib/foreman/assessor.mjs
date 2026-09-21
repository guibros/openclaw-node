/**
 * assessor.mjs — who answers the ten questions.
 *
 * Two implementations behind one contract: `assess(observation)` resolves to
 * `{ ok: true, assessment }` or `{ ok: false, reason }` and never throws. The
 * supervisor treats `ok: false` as "no supervision this cycle" (passthrough), not
 * as a reason to stop the worker: unlike upstream Foreman, the mesh pipeline keeps
 * its metric, harness and review gates downstream, so an unavailable local model
 * must degrade to today's behaviour rather than kill healthy work.
 *
 * The LLM assessor rides the existing analysis lane (lib/llm-client.mjs
 * generateAnalysis → ollama-queue requestAnalysis): short wait ceiling, small
 * output, and a `fallback` marker when Ollama is busy with extraction.
 */
import { DIMENSIONS, QUESTIONS, normalizeAssessment, parseAssessmentText } from './assessment.mjs';

export function createSimulatedAssessor(sequence, { repeatLast = true } = {}) {
  const items = Array.isArray(sequence) ? [...sequence] : [sequence];
  if (!items.length) throw new Error('simulated assessor needs at least one assessment');
  let index = 0;
  const calls = [];
  return {
    name: 'simulated',
    calls,
    async assess(observation) {
      calls.push(observation);
      let item;
      if (index < items.length) item = items[index++];
      else if (repeatLast) item = items[items.length - 1];
      else return { ok: false, reason: 'simulated sequence exhausted' };
      if (typeof item === 'function') item = item(observation);
      if (item && item.ok === false) return item;
      try {
        return { ok: true, assessment: normalizeAssessment(item) };
      } catch (error) {
        return { ok: false, reason: error.message };
      }
    },
  };
}

export function buildAssessmentMessages(observation) {
  const questions = DIMENSIONS.map((name) => `- "${name}": ${QUESTIONS[name]}`).join('\n');
  const system = [
    'You are Foreman, an independent supervisor watching a coding worker on a software task.',
    'You do not do the work and you do not choose actions. You answer ten yes/no questions',
    'about the evidence with a probability of "yes" between 0 and 1 for each.',
    'Respond with ONLY a JSON object whose keys are exactly the ten question ids and whose',
    'values are numbers in [0, 1]. No prose, no markdown.',
    '',
    'Questions:',
    questions,
  ].join('\n');
  const user = `Evidence (JSON):\n${JSON.stringify(observation)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * @param {object} args
 * @param {{generateAnalysis: Function}} args.client — an llm-client instance (or a stub).
 * @param {number} [args.timeoutMs] — wait+execute ceiling before the lane falls back.
 * @param {boolean} [args.jsonMode] — request strict JSON output (unsafe on thinking-family models).
 * @param {number} [args.maxTokens]
 */
export function createLlmAssessor({ client, timeoutMs = 8_000, jsonMode = false, maxTokens = 400, model = null }) {
  if (!client || typeof client.generateAnalysis !== 'function') {
    throw new Error('llm assessor needs a client with generateAnalysis()');
  }
  return {
    name: model ? `llm:${model}` : 'llm',
    async assess(observation) {
      let response;
      try {
        response = await client.generateAnalysis(buildAssessmentMessages(observation), {
          jsonMode,
          maxTokens,
          waitTimeoutMs: timeoutMs,
          temperature: 0,
        });
      } catch (error) {
        return { ok: false, reason: `assessor error: ${error.message}` };
      }
      if (!response || response.mode !== 'llm') {
        return { ok: false, reason: `assessor unavailable: ${response?.reason || 'no response'}` };
      }
      try {
        const values = parseAssessmentText(response.value?.content ?? '');
        return { ok: true, assessment: normalizeAssessment(values), ms: response.ms ?? null };
      } catch (error) {
        return { ok: false, reason: `assessor response rejected: ${error.message}` };
      }
    },
  };
}

/** The production assessor: the local model through the analysis lane. */
export async function createDefaultAssessor({ model, timeoutMs = 8_000, env = process.env } = {}) {
  const llm = await import('../llm-client.mjs');
  const resolvedModel = model || llm.DEFAULT_MODEL;
  const client = llm.createLlmClient({ model: resolvedModel, timeout: timeoutMs });
  return createLlmAssessor({
    client,
    timeoutMs,
    model: resolvedModel,
    // format:"json" stalls the grammar decoder on thinking-family models; the
    // tolerant parser handles free-form output there (llm-client.useJsonFormat).
    jsonMode: llm.useJsonFormat(resolvedModel, env),
  });
}
