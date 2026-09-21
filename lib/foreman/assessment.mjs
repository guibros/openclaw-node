/**
 * assessment.mjs — the ten fixed supervisory questions and the strict normalizer.
 *
 * Foreman's contract (thruwire/foreman, adopted here per DECISIONS D1): the fast
 * model answers ten independent yes/no questions with a probability each and
 * nothing else. Every dimension must be present, numeric and finite — a missing
 * answer is an error, never a default, so a degraded model cannot silently steer
 * the policy toward "everything is fine".
 */

export const QUESTIONS = Object.freeze({
  implementation_complete:
    'Is the implementation work required by the original task complete?',
  tests_sufficient:
    'Does the work have sufficient relevant test coverage and passing verification?',
  requirements_satisfied:
    'Does the current repository state satisfy the original task as a whole?',
  needs_verification:
    'Does the current state warrant an independent verification pass before finishing?',
  meaningful_progress:
    'Is the active or most recent worker making meaningful progress toward the task?',
  worker_stuck:
    'Does the active or most recent worker appear stuck, looping, or unable to advance?',
  work_off_track:
    'Is the current work drifting from the original task or making unrelated changes?',
  agents_md_drift:
    'When instructions is non-empty, is the worker\'s behavior or repository work materially ' +
    'inconsistent with those repository instructions? Answer no when instructions is empty ' +
    'or the evidence is insufficient.',
  ready_to_finish:
    'Given all evidence, is the task ready to be declared complete?',
  needs_human:
    'Does this situation require human judgment, credentials, clarification, or permission?',
});

export const DIMENSIONS = Object.freeze(Object.keys(QUESTIONS));

/** Validate all ten probabilities; clamp minor numeric overshoot into [0, 1]. */
export function normalizeAssessment(values, { now = () => new Date() } = {}) {
  if (!values || typeof values !== 'object') throw new Error('assessment is not an object');
  const missing = DIMENSIONS.filter((name) => !(name in values));
  if (missing.length) throw new Error(`assessment omitted: ${missing.join(', ')}`);
  const normalized = {};
  for (const name of DIMENSIONS) {
    const raw = values[name];
    if (typeof raw === 'boolean' || typeof raw !== 'number') {
      throw new Error(`assessment ${name} is not numeric`);
    }
    if (!Number.isFinite(raw)) throw new Error(`assessment ${name} is not finite`);
    normalized[name] = Math.min(1, Math.max(0, raw));
  }
  normalized.assessed_at = now().toISOString();
  return normalized;
}

/**
 * Pull the ten answers out of free-form model text. Tolerates a ```json fence,
 * prose around the object, `{answers: {k: {noul|probability|value}}}` nesting,
 * and string numbers. Anything the normalizer rejects still rejects here.
 */
export function parseAssessmentText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty assessment text');
  const candidate = extractJsonObject(text);
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`assessment is not valid JSON: ${error.message}`);
  }
  const answers = parsed && typeof parsed.answers === 'object' && parsed.answers !== null
    ? parsed.answers
    : parsed;
  const values = {};
  for (const name of DIMENSIONS) {
    if (!(name in answers)) continue;
    let value = answers[name];
    if (value && typeof value === 'object') {
      value = value.noul ?? value.probability ?? value.value ?? value.p;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      value = Number(value);
    }
    values[name] = value;
  }
  return values;
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('no JSON object in assessment text');
  // Walk to the matching brace so trailing prose does not break JSON.parse.
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start);
}
