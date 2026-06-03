/**
 * obsidian-theme-notes.mjs — the themes/ wiki surface (repair 2.9).
 *
 * One hub note per above-threshold theme: hierarchy links + member concepts.
 * The schema records no theme↔session/entity linkage, so membership is
 * approximated via the theme's extraction batch (source_event_id) — the
 * structural gap is captured in OUT_OF_SCOPE for an extraction-side fix.
 * Deterministic content, write-only-if-changed, atomic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './sqlite-store.mjs';
import { getVaultPath, ensureVaultStructure } from './obsidian-vault.mjs';
import { slugifyName } from './obsidian-summarizer.mjs';
import { atomicWriteFileSync } from './atomic-write.mjs';

const DEFAULT_STATE_DB = path.join(process.env.HOME || '', '.openclaw', 'state.db');

export function buildThemeNote(theme, opts = {}) {
  const members = opts.members || [];
  const related = opts.relatedThemes || [];
  const lines = [
    '---',
    'type: theme',
    `aliases: ["${theme.label.replace(/"/g, '\\"')}"]`,
    `mention_count: ${theme.mention_count}`,
  ];
  if (theme.hierarchy_path) lines.push(`hierarchy: ${theme.hierarchy_path}`);
  lines.push('---', '', `# ${theme.label}`);
  if (members.length) {
    // Piped slug links: basename resolution needs no alias on the target.
    lines.push('', '## Concepts', ...members.map((n) => `- [[${slugifyName(n)}|${n}]]`));
  } else {
    lines.push('', '_No structural concept membership recorded (extraction does not yet link themes to sessions)._');
  }
  if (related.length) {
    lines.push('', '## Related themes', ...related.map((l) => `- [[${l}]]`));
  }
  return lines.join('\n') + '\n';
}

/**
 * @param {{ db?: object, dbPath?: string, vaultPath?: string, threshold?: number }} [opts]
 * @returns {Promise<{ generated: number, unchanged: number, notes: string[] }>}
 */
export async function generateThemeNotes(opts = {}) {
  const vaultPath = opts.vaultPath || getVaultPath();
  const ownsDb = !opts.db;
  const db = opts.db || openStore(opts.dbPath || DEFAULT_STATE_DB, { readonly: true, integrityCheck: false });
  const threshold = opts.threshold ?? 5;

  try {
    await ensureVaultStructure(vaultPath);
    const themesDir = path.join(vaultPath, 'themes');

    const themes = db.prepare(`
      SELECT id, label, hierarchy_path, parent_id, mention_count, source_event_id
      FROM themes WHERE mention_count >= ? ORDER BY mention_count DESC
    `).all(threshold);
    const themeLabels = new Set(themes.map((t) => t.label));
    const byId = new Map(themes.map((t) => [t.id, t]));

    const conceptsDir = path.join(vaultPath, 'concepts');
    let conceptSlugs = new Set();
    try {
      conceptSlugs = new Set(fs.readdirSync(conceptsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
    } catch { /* fresh vault */ }
    const batchEntities = db.prepare(`
      SELECT DISTINCT e.name FROM mentions m JOIN entities e ON e.id = m.entity_id
      WHERE m.source_event_id = ? AND m.source_event_id IS NOT NULL
      ORDER BY e.mention_count DESC LIMIT 10
    `);

    const notes = [];
    let generated = 0;
    let unchanged = 0;
    const claimed = new Set();

    for (const theme of themes) {
      const filename = `${slugifyName(theme.label)}.md`;
      if (claimed.has(filename)) continue;
      claimed.add(filename);

      const members = (theme.source_event_id ? batchEntities.all(theme.source_event_id) : [])
        .map((r) => r.name)
        .filter((n) => conceptSlugs.has(slugifyName(n)));
      const relatedThemes = [];
      const parent = theme.parent_id ? byId.get(theme.parent_id) : null;
      if (parent && themeLabels.has(parent.label)) relatedThemes.push(parent.label);

      const content = buildThemeNote(theme, { members, relatedThemes });
      const filePath = path.join(themesDir, filename);
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
