import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerifierPrompt, parseVerdict } from '../lib/foreman/verifier.mjs';

describe('foreman verifier — mission', () => {
  it('names the task, the changed files, the read-only rule and the verdict contract', () => {
    const prompt = buildVerifierPrompt(
      { task_id: 't1', title: 'Add rate limiting', description: 'to the API' },
      { workerOutput: 'x'.repeat(5_000) + 'DONE', changedFiles: ['src/api.js', 'test/api.test.js'] },
    );
    assert.match(prompt, /Task: Add rate limiting/);
    assert.match(prompt, /to the API/);
    assert.match(prompt, /- src\/api\.js\n- test\/api\.test\.js/);
    assert.match(prompt, /do NOT modify any file/);
    assert.match(prompt, /FOREMAN_VERDICT: PASS/);
    assert.match(prompt, /FOREMAN_VERDICT: FAIL/);
    assert.match(prompt, /No configured metric/);
    assert.ok(prompt.endsWith('DONE'));
    assert.ok(prompt.length < 6_000);
  });
  it('mentions a configured metric and tolerates no changed files', () => {
    const prompt = buildVerifierPrompt({ task_id: 't2', title: 'x', metric: 'npm test' });
    assert.match(prompt, /Configured metric \(already evaluated separately\): npm test/);
    assert.match(prompt, /\(none reported\)/);
    assert.match(prompt, /\(no output\)/);
  });
});

describe('foreman verifier — verdict parsing', () => {
  it('reads PASS and FAIL with the findings that follow', () => {
    const pass = parseVerdict('I checked everything.\nFOREMAN_VERDICT: PASS\nAll three requirements hold.');
    assert.equal(pass.passed, true);
    assert.equal(pass.verdict, 'PASS');
    assert.match(pass.summary, /^FOREMAN_VERDICT: PASS\nAll three requirements hold\./);
    const fail = parseVerdict('foreman_verdict: fail — the limiter never resets');
    assert.equal(fail.passed, false);
    assert.equal(fail.verdict, 'FAIL');
  });
  it('uses the text before the line when nothing follows it', () => {
    const result = parseVerdict('Missing tests for the reset path.\nFOREMAN_VERDICT: FAIL');
    assert.equal(result.passed, false);
    assert.match(result.summary, /Missing tests for the reset path/);
  });
  it('treats a missing verdict as no verification, keeping the tail as the summary', () => {
    const result = parseVerdict('I think it is probably fine.');
    assert.equal(result.passed, null);
    assert.equal(result.verdict, null);
    assert.equal(result.summary, 'I think it is probably fine.');
    assert.equal(parseVerdict('').passed, null);
    assert.equal(parseVerdict(undefined).passed, null);
  });
});
