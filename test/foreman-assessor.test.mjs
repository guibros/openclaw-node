import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSIONS } from '../lib/foreman/assessment.mjs';
import { createSimulatedAssessor, createLlmAssessor, buildAssessmentMessages } from '../lib/foreman/assessor.mjs';

const all = (value) => Object.fromEntries(DIMENSIONS.map((name) => [name, value]));
const observation = { task_id: 't', latest_worker_output: 'hi', changed_files: [] };

describe('foreman assessor — simulated', () => {
  it('plays a sequence, repeats the last item, and records calls', async () => {
    const assessor = createSimulatedAssessor([all(0.1), all(0.9)]);
    assert.equal((await assessor.assess(observation)).assessment.worker_stuck, 0.1);
    assert.equal((await assessor.assess(observation)).assessment.worker_stuck, 0.9);
    assert.equal((await assessor.assess(observation)).assessment.worker_stuck, 0.9);
    assert.equal(assessor.calls.length, 3);
  });
  it('can exhaust, can compute from the observation, and reports bad items as unavailable', async () => {
    const exhaustible = createSimulatedAssessor([all(0.5)], { repeatLast: false });
    await exhaustible.assess(observation);
    assert.equal((await exhaustible.assess(observation)).ok, false);
    const computed = createSimulatedAssessor([(obs) => all(obs.latest_worker_output === 'hi' ? 0.7 : 0)]);
    assert.equal((await computed.assess(observation)).assessment.ready_to_finish, 0.7);
    const bad = createSimulatedAssessor([{ worker_stuck: 0.5 }]);
    const result = await bad.assess(observation);
    assert.equal(result.ok, false);
    assert.match(result.reason, /omitted/);
  });
});

function stubClient(responses) {
  const calls = [];
  return {
    calls,
    async generateAnalysis(messages, opts) {
      calls.push({ messages, opts });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe('foreman assessor — local model through the analysis lane', () => {
  it('asks all ten questions and parses an llm-mode answer', async () => {
    const client = stubClient([{ mode: 'llm', ms: 42, value: { content: `\`\`\`json\n${JSON.stringify(all(0.33))}\n\`\`\`` } }]);
    const assessor = createLlmAssessor({ client, timeoutMs: 1234, jsonMode: true, model: 'qwen3:8b' });
    const result = await assessor.assess(observation);
    assert.equal(result.ok, true);
    assert.equal(result.assessment.needs_human, 0.33);
    assert.equal(result.ms, 42);
    assert.equal(assessor.name, 'llm:qwen3:8b');
    const { messages, opts } = client.calls[0];
    for (const name of DIMENSIONS) assert.match(messages[0].content, new RegExp(`"${name}"`));
    assert.match(messages[1].content, /"task_id":"t"/);
    assert.equal(opts.jsonMode, true);
    assert.equal(opts.waitTimeoutMs, 1234);
  });
  it('reports the lane fallback as unavailable instead of throwing', async () => {
    const client = stubClient([{ mode: 'fallback', reason: 'ollama-busy-extraction', ollama_state: null, eta_ms: 5000 }]);
    const result = await createLlmAssessor({ client }).assess(observation);
    assert.equal(result.ok, false);
    assert.match(result.reason, /unavailable: ollama-busy-extraction/);
  });
  it('reports a thrown client error and a rejected response as unavailable', async () => {
    const throwing = stubClient([new Error('fetch failed')]);
    assert.match((await createLlmAssessor({ client: throwing }).assess(observation)).reason, /assessor error: fetch failed/);
    const partial = stubClient([{ mode: 'llm', value: { content: '{"worker_stuck": 0.5}' } }]);
    const result = await createLlmAssessor({ client: partial }).assess(observation);
    assert.equal(result.ok, false);
    assert.match(result.reason, /rejected: assessment omitted/);
  });
  it('builds messages that name the contract explicitly', () => {
    const [system, user] = buildAssessmentMessages(observation);
    assert.equal(system.role, 'system');
    assert.match(system.content, /ONLY a JSON object/);
    assert.match(user.content, /^Evidence \(JSON\):/);
  });
});
