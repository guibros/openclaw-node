import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSIONS, QUESTIONS, normalizeAssessment, parseAssessmentText } from '../lib/foreman/assessment.mjs';

const all = (value) => Object.fromEntries(DIMENSIONS.map((name) => [name, value]));

describe('foreman assessment — normalize', () => {
  it('has exactly ten questions', () => {
    assert.equal(DIMENSIONS.length, 10);
    for (const name of DIMENSIONS) assert.equal(typeof QUESTIONS[name], 'string');
  });
  it('clamps minor overshoot into [0, 1] and stamps assessed_at', () => {
    const result = normalizeAssessment({ ...all(0.5), worker_stuck: 1.001, work_off_track: -0.001 });
    assert.equal(result.worker_stuck, 1);
    assert.equal(result.work_off_track, 0);
    assert.match(result.assessed_at, /^\d{4}-\d{2}-\d{2}T/);
  });
  it('rejects a missing dimension rather than defaulting it', () => {
    const values = all(0.5); delete values.needs_human;
    assert.throws(() => normalizeAssessment(values), /omitted: needs_human/);
  });
  it('rejects booleans, strings and non-finite numbers', () => {
    assert.throws(() => normalizeAssessment({ ...all(0.5), worker_stuck: true }), /not numeric/);
    assert.throws(() => normalizeAssessment({ ...all(0.5), worker_stuck: '0.5' }), /not numeric/);
    assert.throws(() => normalizeAssessment({ ...all(0.5), worker_stuck: Number.NaN }), /not finite/);
  });
});

describe('foreman assessment — parse model text', () => {
  it('reads a bare JSON object', () => {
    const values = parseAssessmentText(JSON.stringify(all(0.25)));
    assert.equal(values.ready_to_finish, 0.25);
  });
  it('reads a fenced object with prose around it', () => {
    const text = `Here is my assessment:\n\`\`\`json\n${JSON.stringify(all(0.6))}\n\`\`\`\nHope this helps.`;
    assert.equal(parseAssessmentText(text).worker_stuck, 0.6);
  });
  it('reads Jev-shaped answers and string numbers', () => {
    const answers = Object.fromEntries(DIMENSIONS.map((name) => [name, { noul: '0.4' }]));
    const values = parseAssessmentText(JSON.stringify({ answers }));
    assert.equal(values.needs_human, 0.4);
    assert.doesNotThrow(() => normalizeAssessment(values));
  });
  it('stops at the matching brace so trailing text cannot break the parse', () => {
    const text = `${JSON.stringify(all(0.3))} }} extra { junk`;
    assert.equal(parseAssessmentText(text).tests_sufficient, 0.3);
  });
  it('rejects text without a JSON object', () => {
    assert.throws(() => parseAssessmentText('no object here'), /no JSON object/);
    assert.throws(() => parseAssessmentText('   '), /empty/);
  });
});
