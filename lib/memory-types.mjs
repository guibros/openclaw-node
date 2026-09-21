/**
 * memory-types.mjs — declared memory kinds and per-field merge operations
 * (openviking-adopt Block 3).
 *
 * OpenViking declares each memory type as a schema whose fields carry a merge
 * operation (immutable / patch / replace / sum / link_merge), so "the same
 * memory seen again" is resolved by rule rather than by whichever upsert
 * happened to run. This module is that registry for the extraction store's
 * three kinds. It is pure: the store applies `mergeFields` to (existing row,
 * incoming record) and writes the result; nothing here touches SQLite.
 *
 * The identity of each kind is the key the store already dedups on
 * (canonical entity name, theme label, session+decision text). What changes
 * with this registry: a re-mention under a new spelling becomes an ALIAS of
 * the existing entity instead of a new row, the first classification of an
 * entity stays put, and a revised decision SUPERSEDES its predecessor instead
 * of sitting beside it.
 */

export const MERGE_OPS = Object.freeze({
  /** first value wins; later extractions cannot change it */
  IMMUTABLE: 'immutable',
  /** latest value wins when the incoming one is present */
  REPLACE: 'replace',
  /** numeric: keep the larger */
  MAX: 'max',
  /** numeric: add */
  SUM: 'sum',
  /** set of strings: union, case-insensitive, bounded */
  UNION: 'union',
});

export const ALIAS_CAP = 20;

/**
 * The registry. `identity` names the field(s) the store dedups on; `fields`
 * maps each mergeable column to its op. Columns not listed are store-owned
 * state (recall salience, privacy, provenance) and are never touched by an
 * extraction merge.
 */
export const MEMORY_TYPES = Object.freeze({
  entity: Object.freeze({
    identity: ['canonical_name'],
    fields: Object.freeze({
      name: MERGE_OPS.IMMUTABLE,      // the first spelling is the display name; others become aliases
      type: MERGE_OPS.IMMUTABLE,      // F-H12: the first classification stays
      first_seen: MERGE_OPS.IMMUTABLE,
      last_seen: MERGE_OPS.REPLACE,
      aliases: MERGE_OPS.UNION,
    }),
  }),
  theme: Object.freeze({
    identity: ['label'],
    fields: Object.freeze({
      hierarchy_path: MERGE_OPS.REPLACE,
      first_seen: MERGE_OPS.IMMUTABLE,
      last_seen: MERGE_OPS.REPLACE,
      mention_count: MERGE_OPS.SUM,
    }),
  }),
  decision: Object.freeze({
    identity: ['session_id', 'decision'],
    fields: Object.freeze({
      rationale: MERGE_OPS.REPLACE,
      confidence: MERGE_OPS.REPLACE,
      created_at: MERGE_OPS.REPLACE,
      // set by the store when a later decision names this one in `supersedes`;
      // a re-statement of the same decision never clears it
      superseded_by: MERGE_OPS.IMMUTABLE,
    }),
  }),
});

/** Canonical form for alias/name identity — mirrors extraction-store.canonicalizeName. */
export function canonicalAlias(name) {
  return String(name ?? '').trim().replace(/[\s_]+/g, ' ').toLowerCase();
}

function mergeOne(op, existing, incoming) {
  switch (op) {
    case MERGE_OPS.IMMUTABLE:
      return existing != null ? existing : incoming;
    case MERGE_OPS.REPLACE:
      return incoming !== undefined ? incoming : existing;
    case MERGE_OPS.MAX: {
      const a = typeof existing === 'number' ? existing : null;
      const b = typeof incoming === 'number' ? incoming : null;
      if (a == null) return b;
      if (b == null) return a;
      return Math.max(a, b);
    }
    case MERGE_OPS.SUM:
      return (typeof existing === 'number' ? existing : 0) + (typeof incoming === 'number' ? incoming : 0);
    case MERGE_OPS.UNION: {
      const out = [];
      const seen = new Set();
      for (const v of [...(existing || []), ...(incoming || [])]) {
        if (typeof v !== 'string') continue;
        const c = canonicalAlias(v);
        if (!c || seen.has(c)) continue;
        seen.add(c);
        out.push(v.trim());
        if (out.length >= ALIAS_CAP) break;
      }
      return out;
    }
    default:
      throw new Error(`unknown merge op: ${op}`);
  }
}

/**
 * Merge an incoming record into an existing one by the kind's declared ops.
 * Fields absent from the registry are copied from `existing` untouched.
 *
 * @param {'entity'|'theme'|'decision'} kind
 * @param {object|null} existing — current row (null → incoming is taken as-is for declared fields)
 * @param {object} incoming
 * @returns {{ merged: object, changed: string[] }}
 */
export function mergeFields(kind, existing, incoming) {
  const type = MEMORY_TYPES[kind];
  if (!type) throw new Error(`unknown memory kind: ${kind}`);
  const merged = { ...(existing || {}) };
  const changed = [];
  for (const [field, op] of Object.entries(type.fields)) {
    const before = existing ? existing[field] : undefined;
    const after = mergeOne(op, before, incoming[field]);
    if (after === undefined) continue;
    merged[field] = after;
    if (JSON.stringify(after) !== JSON.stringify(before)) changed.push(field);
  }
  return { merged, changed };
}

/**
 * Which of a record's alias candidates are NEW relative to the display name
 * and existing aliases. Used by the store to decide which alias rows to add.
 */
export function newAliases(displayName, existingAliases, candidates) {
  const taken = new Set([canonicalAlias(displayName), ...(existingAliases || []).map(canonicalAlias)]);
  const out = [];
  for (const c of candidates || []) {
    const canon = canonicalAlias(c);
    if (!canon || taken.has(canon)) continue;
    taken.add(canon);
    out.push(String(c).trim());
    if (taken.size > ALIAS_CAP) break;
  }
  return out;
}
