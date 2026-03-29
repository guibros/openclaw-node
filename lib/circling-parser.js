/**
 * circling-parser.js — Standalone parser for Circling Strategy LLM output.
 *
 * Extracted from mesh-agent.js so both production code and tests import
 * the same module. Zero external dependencies.
 *
 * Handles both single-artifact and multi-artifact output formats.
 *
 * Single artifact: everything before ===CIRCLING_REFLECTION=== is the artifact.
 * Multi artifact: ===CIRCLING_ARTIFACT=== / ===END_ARTIFACT=== pairs delimit
 *   artifact content by position (content BETWEEN previous END_ARTIFACT and
 *   next CIRCLING_ARTIFACT marker).
 *
 * @param {string} output — raw LLM output
 * @param {object} [opts]
 * @param {function} [opts.log] — optional logger (default: no-op)
 * @param {function} [opts.legacyParser] — optional fallback parser for output
 *   without circling delimiters. Called as legacyParser(output). Should return
 *   { summary, confidence, vote, parse_failed }. If not provided, missing
 *   delimiters produce parse_failed: true.
 * @returns {{ circling_artifacts: Array<{type: string, content: string}>, summary: string, confidence: number, vote: string, parse_failed: boolean }}
 */
function parseCirclingReflection(output, opts = {}) {
  const log = opts.log || (() => {});

  const VALID_VOTES = new Set(['continue', 'converged', 'blocked']);
  const result = {
    circling_artifacts: [],
    summary: '',
    confidence: 0.5,
    vote: 'continue',
    parse_failed: false,
  };

  // Extract the reflection metadata block
  const reflMatch = output.match(/===CIRCLING_REFLECTION===([\s\S]*?)===END_REFLECTION===/);
  if (!reflMatch) {
    // No circling delimiters — try legacy fallback if provided
    if (opts.legacyParser) {
      const legacy = opts.legacyParser(output);
      return {
        circling_artifacts: [],
        summary: legacy.summary,
        confidence: legacy.confidence,
        vote: legacy.vote,
        parse_failed: legacy.parse_failed,
      };
    }
    return { ...result, parse_failed: true, vote: 'parse_error' };
  }

  // Parse reflection key-value pairs
  const reflBlock = reflMatch[1];
  const typeMatch = reflBlock.match(/^type:\s*(.+)$/m);
  const summaryMatch = reflBlock.match(/^summary:\s*(.+)$/m);
  const confMatch = reflBlock.match(/^confidence:\s*([\d.]+)$/m);
  const voteMatch = reflBlock.match(/^vote:\s*(\w+)$/m);

  result.summary = summaryMatch ? summaryMatch[1].trim() : '';
  result.confidence = confMatch ? parseFloat(confMatch[1]) : 0.5;
  const voteRaw = voteMatch ? voteMatch[1].trim().toLowerCase() : 'continue';
  result.vote = VALID_VOTES.has(voteRaw) ? voteRaw : 'parse_error';
  if (!VALID_VOTES.has(voteRaw)) result.parse_failed = true;

  const artifactType = typeMatch ? typeMatch[1].trim() : 'unknown';

  // Check for multi-artifact format
  const artifactBlocks = [...output.matchAll(/===CIRCLING_ARTIFACT===([\s\S]*?)===END_ARTIFACT===/g)];

  if (artifactBlocks.length > 0) {
    // Multi-artifact: parse each block.
    // Content for artifact N is between the previous ===END_ARTIFACT=== (or start
    // of output for N=0) and this artifact's ===CIRCLING_ARTIFACT=== marker.
    const parts = output.split('===CIRCLING_REFLECTION===')[0]; // everything before reflection
    const artMatches = [...parts.matchAll(/===CIRCLING_ARTIFACT===\s*\n([\s\S]*?)===END_ARTIFACT===/g)];
    const chunks = [];

    for (let i = 0; i < artMatches.length; i++) {
      const m = artMatches[i];
      const header = m[1].trim();
      const typeLineMatch = header.match(/^type:\s*(.+)$/m);
      const artType = typeLineMatch ? typeLineMatch[1].trim() : `artifact_${i}`;

      const artStart = m.index;
      const prevEnd = i === 0 ? 0 : (artMatches[i - 1].index + artMatches[i - 1][0].length);
      const content = parts.slice(prevEnd, artStart).trim();

      if (content) {
        chunks.push({ type: artType, content });
      }
    }

    // Last chunk: content after the last END_ARTIFACT before CIRCLING_REFLECTION
    if (artMatches.length > 0) {
      const lastArt = artMatches[artMatches.length - 1];
      const afterLast = parts.slice(lastArt.index + lastArt[0].length).trim();
      if (afterLast) {
        chunks.push({ type: 'extra', content: afterLast });
      }
    }

    result.circling_artifacts = chunks;

  } else {
    // Single-artifact: everything before ===CIRCLING_REFLECTION=== is the artifact
    const beforeReflection = output.split('===CIRCLING_REFLECTION===')[0].trim();
    if (beforeReflection) {
      result.circling_artifacts = [{ type: artifactType, content: beforeReflection }];
    }
  }

  if (result.circling_artifacts.length === 0 && !result.parse_failed) {
    log('CIRCLING PARSE WARNING: No artifacts extracted from output');
  }

  return result;
}

module.exports = { parseCirclingReflection };
