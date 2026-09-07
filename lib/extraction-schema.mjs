/**
 * extraction-schema.mjs — Zod schema for LLM-driven structured extraction.
 *
 * Defines the ExtractionResult shape that Qwen3.5-27B must produce when
 * extracting entities, themes, actions, decisions, friction signals, and
 * relationships from a session tail.
 *
 * Used by lib/extraction-prompt.mjs to validate LLM output.
 */

import { z } from 'zod';

// ── Sub-schemas ────────────────────────────────────────

// Field caps (review H-2 / P5-6): extracted text is stored unbounded and later
// injected into system prompts and bypassPermissions workers. A transcript
// can make the extractor emit a 50 KB "decision"; the cap bounds what one
// extraction can plant. coerceExtractionResult clips to these before
// validation so an over-long field degrades to a truncated one, not to a
// dropped extraction.
export const FIELD_CAPS = Object.freeze({
  name: 200,
  label: 200,
  hierarchy: 100,
  decision: 1000,
  rationale: 2000,
  signal: 500,
  relationship: 200,
});

export const ENTITY_TYPES = ['person', 'project', 'technology', 'file', 'concept', 'company'];

export const EntitySchema = z.object({
  name: z.string().min(1).max(FIELD_CAPS.name),
  type: z.enum(ENTITY_TYPES),
  salience: z.number().min(0).max(1),
});

export const ThemeSchema = z.object({
  label: z.string().min(1).max(FIELD_CAPS.label),
  hierarchy: z.array(z.string().max(FIELD_CAPS.hierarchy)),
});

export const ACTION_TYPES = [
  'debugging', 'designing', 'planning', 'implementing', 'reviewing', 'researching',
];

export const DecisionSchema = z.object({
  decision: z.string().min(1).max(FIELD_CAPS.decision),
  rationale: z.string().min(1).max(FIELD_CAPS.rationale),
  confidence: z.number().min(0).max(1),
});

export const SEVERITY_LEVELS = ['low', 'medium', 'high'];

export const FrictionSignalSchema = z.object({
  signal: z.string().min(1).max(FIELD_CAPS.signal),
  severity: z.enum(SEVERITY_LEVELS),
});

export const RELATIONSHIP_TYPES = [
  'depends_on', 'contradicts', 'instance_of', 'causes', 'follows',
];

export const RelationshipSchema = z.object({
  source: z.string().min(1).max(FIELD_CAPS.relationship),
  target: z.string().min(1).max(FIELD_CAPS.relationship),
  type: z.enum(RELATIONSHIP_TYPES),
});

// ── Top-level schema ───────────────────────────────────

export const ExtractionResultSchema = z.object({
  entities: z.array(EntitySchema),
  themes: z.array(ThemeSchema),
  actions: z.array(z.enum(ACTION_TYPES)),
  decisions: z.array(DecisionSchema),
  friction_signals: z.array(FrictionSignalSchema),
  relationships: z.array(RelationshipSchema),
});

/**
 * Validate raw data against ExtractionResultSchema.
 * Returns the parsed result on success, throws ZodError on failure.
 *
 * @param {unknown} data — raw object (typically from JSON.parse of LLM output)
 * @returns {import('zod').z.infer<typeof ExtractionResultSchema>}
 */
export function validateExtractionResult(data) {
  return ExtractionResultSchema.parse(data);
}
