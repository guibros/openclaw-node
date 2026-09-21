/**
 * verifier.mjs — the independent verification pass.
 *
 * When the policy says START_VERIFIER after a coding worker exits, a second
 * worker with a verification mission reads the tree the first one left and
 * returns a structured verdict. It reads, runs tests, and judges; it does not
 * fix — the coding worker retries with the findings, so authorship of the
 * diff stays with one worker per attempt. The verdict line is the contract:
 * exactly one `FOREMAN_VERDICT: PASS` or `FOREMAN_VERDICT: FAIL`.
 */

export const VERDICT_LINE = /^\s*FOREMAN_VERDICT:\s*(PASS|FAIL)\b.*$/im;

export function buildVerifierPrompt(task, { workerOutput = '', changedFiles = [], outputLimit = 4_000 } = {}) {
  const tail = workerOutput.length > outputLimit ? `…${workerOutput.slice(-outputLimit)}` : workerOutput;
  const files = changedFiles.length ? changedFiles.map((f) => `- ${f}`).join('\n') : '- (none reported)';
  return [
    'You are an independent verification worker. A coding worker just finished a task in this',
    'repository. Verify whether the repository now actually satisfies the task. Do not assume the',
    'previous worker was correct, and do not trust its report over the code.',
    '',
    `Task: ${task.title || task.task_id}`,
    task.description ? `Details:\n${task.description}` : '',
    task.metric ? `Configured metric (already evaluated separately): ${task.metric}` : 'No configured metric — your verdict is the verification.',
    '',
    'Files the worker changed:',
    files,
    '',
    'Inspect the changes, run the narrowest relevant tests or commands, and look for missing',
    'requirements, incorrect behavior, regressions, incomplete implementation, insufficient tests,',
    'and failures hidden by the previous worker.',
    '',
    'Rules: do NOT modify any file. Report only.',
    'Your final message must contain exactly one line of the form',
    '  FOREMAN_VERDICT: PASS',
    'or',
    '  FOREMAN_VERDICT: FAIL',
    'followed by your findings: what you checked, what is wrong (if anything), and what the next',
    'attempt should change. Be specific and concise.',
    '',
    'Previous worker report (tail):',
    tail || '(no output)',
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

/**
 * @returns {{ passed: boolean|null, verdict: 'PASS'|'FAIL'|null, summary: string }}
 *   `passed` is null when no verdict line was produced — the caller decides whether
 *   an absent verdict counts as a failure (it does: no verdict, no verification).
 */
export function parseVerdict(output, { summaryLimit = 2_000 } = {}) {
  const text = typeof output === 'string' ? output : '';
  const match = text.match(VERDICT_LINE);
  if (!match) {
    return { passed: null, verdict: null, summary: text.trim().slice(-summaryLimit) };
  }
  const verdict = match[1].toUpperCase();
  const after = text.slice(match.index + match[0].length).trim();
  const before = text.slice(0, match.index).trim();
  const findings = (after || before).slice(0, summaryLimit);
  return { passed: verdict === 'PASS', verdict, summary: `${match[0].trim()}${findings ? `\n${findings}` : ''}` };
}
