/** steering.mjs — turn warning scores into one bounded, actionable instruction. */

export function buildSteeringMessage(assessment) {
  let direction;
  if (assessment.agents_md_drift >= Math.max(assessment.work_off_track, assessment.worker_stuck)) {
    direction = 'Your current work appears to be drifting from the repository instructions. '
      + 'Re-read the applicable instructions, compare them with your recent actions and current '
      + 'changes, and adjust your approach before continuing.';
  } else if (assessment.work_off_track >= assessment.worker_stuck) {
    direction = 'Re-read the original task and compare it with your current work. Return to the '
      + 'smallest change that satisfies the request, avoid unrelated work, and preserve changes '
      + 'that are still valid.';
  } else {
    direction = 'Pause and reassess your current approach. Inspect the most recent failure, '
      + 'identify its root cause, choose a materially different path, and run the narrowest '
      + 'relevant test before continuing.';
  }
  const pct = (value) => `${Math.round(value * 100)}%`;
  return [
    'Foreman supervisory update based on an independent assessment:',
    `- worker stuck: ${pct(assessment.worker_stuck)}`,
    `- meaningful progress: ${pct(assessment.meaningful_progress)}`,
    `- work off track: ${pct(assessment.work_off_track)}`,
    `- instruction drift: ${pct(assessment.agents_md_drift)}`,
    `- tests sufficient: ${pct(assessment.tests_sufficient)}`,
    '',
    `Direction: ${direction}`,
    '',
    'Continue working toward the original task and report what changed in your approach.',
  ].join('\n');
}
