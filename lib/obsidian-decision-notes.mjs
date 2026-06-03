/**
 * obsidian-decision-notes.mjs — the decisions/ wiki surface (repair 2.9).
 *
 * One dated note per high-salience decision: rationale, confidence, wikilinks
 * to the concepts of its session (link-only-existing) and to its session note.
 * Deterministic content, write-only-if-changed, atomic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './sqlite-store.mjs';
import { getVaultPath, ensureVaultStructure } from './obsidian-vault.mjs';
import { slugifyName, buildSessionNoteResolver } from './obsidian-summarizer.mjs';
import { atomicWriteFileSync } from './atomic-write.mjs';

const DEFAULT_STATE_DB = path.join(process.env.HOME || '', '.openclaw', 'state.db');

/** Deterministic decision-note filename. Slug capped for filesystem sanity —
 * nothing resolves decision notes BY slug (links to them carry the filename). */
export function decisionNoteFilename(decision) {
  const day = String(decision.created_at).slice(0, 10);
  return `${day}-${slugifyName(decision.decision).slice(0, 60).replace(/-$/, '')}.md`;
}

export function buildDecisionNote(decision, opts = {}) {
  const concepts = opts.concepts || [];
  const sessionNote = opts.sessionNote || null;
  const lines = [
    '---',
    'type: decision',
    `date: ${String(decision.created_at).slice(0, 10)}`,
    `confidence: ${decision.confidence}`,
    `salience: ${decision.salience ?? 0.5}`,
    `session: ${decision.session_id}`,
  ];
  // Piped slug links resolve by basename unconditionally (no alias needed
  // on the target) while displaying the entity name.
  if (concepts.length) {
    lines.push(`related: [${concepts.map((n) => `[[${slugifyName(n)}|${n}]]`).join(', ')}]`);
  }
  lines.push('---', '', `# ${decision.decision}`, '', decision.rationale || '_No rationale recorded._');
  if (sessionNote) lines.push('', `From [[sessions/${sessionNote}]].`);
  return lines.join('\n') + '\n';
}

/**
 * @param {{ db?: object, dbPath?: string, vaultPath?: string,
 *           minSalience?: number, maxNotes?: number }} [opts]
 * @returns {Promise<{ generated: number, unchanged: number, notes: string[] }>}
 */
export async function generateDecisionNotes(opts = {}) {
  const vaultPath = opts.vaultPath || getVaultPath();
  const ownsDb = !opts.db;
  const db = opts.db || openStore(opts.dbPath || DEFAULT_STATE_DB, { readonly: true, integrityCheck: false });
  const minSalience = opts.minSalience ?? 0.4;
  const maxNotes = opts.maxNotes ?? 30;

  try {
    await ensureVaultStructure(vaultPath);
    const decisionsDir = path.join(vaultPath, 'decisions');

    const rows = db.prepare(`
      SELECT id, session_id, decision, rationale, confidence, created_at, salience
      FROM decisions WHERE salience >= ?
      ORDER BY salience DESC, created_at DESC LIMIT ?
    `).all(minSalience, maxNotes);

    const conceptsDir = path.join(vaultPath, 'concepts');
    let conceptSlugs = new Set();
    try {
      conceptSlugs = new Set(fs.readdirSync(conceptsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
    } catch { /* fresh vault */ }
    const sessionEntities = db.prepare(`
      SELECT DISTINCT e.name FROM mentions m JOIN entities e ON e.id = m.entity_id
      WHERE m.session_id = ? ORDER BY e.mention_count DESC LIMIT 8
    `);
    const resolver = buildSessionNoteResolver(vaultPath);

    const notes = [];
    let generated = 0;
    let unchanged = 0;
    const claimed = new Set();

    for (const decision of rows) {
      const filename = decisionNoteFilename(decision);
      if (claimed.has(filename)) continue;
      claimed.add(filename);

      const concepts = sessionEntities.all(decision.session_id)
        .map((r) => r.name)
        .filter((n) => conceptSlugs.has(slugifyName(n)));
      const content = buildDecisionNote(decision, {
        concepts,
        sessionNote: resolver(decision.session_id),
      });

      const filePath = path.join(decisionsDir, filename);
      let existing = null;
      try { existing = fs.readFileSync(filePath, 'utf-8'); } catch { /* new */ }
      if (existing === content) { unchanged++; continue; }
      atomicWriteFileSync(filePath, content);
      generated++;
      notes.push(filename);
    }

    return { generated, unchanged, notes, vaultPath };
  } finally {
    if (ownsDb) db.close();
  }
}
