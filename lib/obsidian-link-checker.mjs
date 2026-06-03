/**
 * obsidian-link-checker.mjs — referential integrity lens over the vault (R9, repair 2.4).
 *
 * Read-only. Walks every .md note, indexes filenames + frontmatter aliases,
 * extracts [[wikilinks]], and classifies each link:
 *   - resolved:       exact Obsidian resolution (filename or alias, case-insensitive)
 *   - slugResolvable: no exact match, but slugifyName(target) names a note —
 *                     the writer-emits-names / files-are-slugs gap 2.8 closes
 *   - dangling:       no note matches at all
 * Also reports orphans: notes with zero inbound links (resolved or slug-grade).
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { slugifyName } from './obsidian-summarizer.mjs';
import { getVaultPath } from './obsidian-vault.mjs';
import { openStore } from './sqlite-store.mjs';

const DEFAULT_STATE_DB = path.join(homedir(), '.openclaw', 'state.db');

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

function walkMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function parseAliases(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const line = fm[1].match(/^aliases:\s*\[([^\]]*)\]\s*$/m);
  if (!line) return [];
  return line[1].split(',').map((a) => a.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/**
 * Strip Obsidian heading/alias suffixes: [[target#heading|display]] → target.
 * Also strip stray [ ] wrapping leaked by YAML inline lists in frontmatter
 * (`related: [[[A]], [[B]]]` — the first/last items carry list brackets).
 */
function linkTarget(raw) {
  return raw.split('|')[0].split('#')[0].trim().replace(/^\[+|\]+$/g, '');
}

/**
 * @param {string} [vaultPath]
 * @returns {{ vaultPath: string, notes: number, links: number, resolved: number,
 *   slugResolvable: Array<{file: string, target: string}>,
 *   dangling: Array<{file: string, target: string}>,
 *   orphans: string[] }}
 */
export function checkVaultLinks(vaultPath = getVaultPath()) {
  const files = fs.existsSync(vaultPath) ? walkMarkdown(vaultPath) : [];

  const index = new Map();
  const contents = new Map();
  for (const file of files) {
    const rel = path.relative(vaultPath, file);
    const content = fs.readFileSync(file, 'utf-8');
    contents.set(rel, content);
    index.set(path.basename(file, '.md').toLowerCase(), rel);
    for (const alias of parseAliases(content)) index.set(alias.toLowerCase(), rel);
  }

  let links = 0;
  let resolved = 0;
  const slugResolvable = [];
  const dangling = [];
  const inbound = new Set();

  for (const [rel, content] of contents) {
    for (const match of content.matchAll(WIKILINK_RE)) {
      const target = linkTarget(match[1]);
      if (!target) continue;
      links++;
      // Path-style targets ([[sessions/note-name]]) resolve by basename,
      // exactly as Obsidian resolves them (repair 2.8 checker fix).
      const base = target.includes('/') ? target.split('/').pop() : target;
      const exact = index.get(target.toLowerCase()) || index.get(base.toLowerCase());
      if (exact) {
        resolved++;
        if (exact !== rel) inbound.add(exact);
        continue;
      }
      const slug = index.get(slugifyName(target)) || index.get(slugifyName(base));
      if (slug) {
        slugResolvable.push({ file: rel, target });
        if (slug !== rel) inbound.add(slug);
        continue;
      }
      dangling.push({ file: rel, target });
    }
  }

  const orphans = [...contents.keys()].filter((rel) => !inbound.has(rel)).sort();

  return { vaultPath, notes: files.length, links, resolved, slugResolvable, dangling, orphans };
}

const pct = (num, den) => (den === 0 ? 100 : Math.round((num / den) * 1000) / 10);

/**
 * Referential coverage report (R9, repair 2.6): the db side joined to the
 * vault side. Three measured numbers:
 *   - concept coverage: % of above-threshold entities with a concepts/ note
 *   - link resolution: % of wikilinks resolving Obsidian-exact
 *   - session linkage: % of session notes linking ≥1 existing concept note
 *
 * @param {{ db?: object, dbPath?: string, vaultPath?: string, threshold?: number }} [opts]
 */
export function checkReferentialCoverage(opts = {}) {
  const vaultPath = opts.vaultPath || getVaultPath();
  const ownsDb = !opts.db;
  const db = opts.db
    || openStore(opts.dbPath || DEFAULT_STATE_DB, { readonly: true, integrityCheck: false });
  const threshold = opts.threshold ?? 5;

  try {
    const eligible = db
      .prepare('SELECT name FROM entities WHERE mention_count >= ? ORDER BY mention_count DESC')
      .all(threshold)
      .map((r) => r.name);

    const conceptsDir = path.join(vaultPath, 'concepts');
    const conceptSlugs = new Set(
      fs.existsSync(conceptsDir)
        ? fs.readdirSync(conceptsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
        : []
    );
    const missing = eligible.filter((name) => !conceptSlugs.has(slugifyName(name)));

    const linkReport = checkVaultLinks(vaultPath);

    const sessionsDir = path.join(vaultPath, 'sessions');
    const sessionNotes = fs.existsSync(sessionsDir)
      ? fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.md'))
      : [];
    let sessionsLinkingConcepts = 0;
    for (const note of sessionNotes) {
      const content = fs.readFileSync(path.join(sessionsDir, note), 'utf-8');
      const resolves = [...content.matchAll(WIKILINK_RE)].some((m) => {
        const target = linkTarget(m[1]);
        return target && (conceptSlugs.has(slugifyName(target)) || conceptSlugs.has(target.toLowerCase()));
      });
      if (resolves) sessionsLinkingConcepts++;
    }

    return {
      vaultPath,
      threshold,
      concepts: {
        eligible: eligible.length,
        withNote: eligible.length - missing.length,
        pct: pct(eligible.length - missing.length, eligible.length),
        missing,
      },
      links: {
        total: linkReport.links,
        resolved: linkReport.resolved,
        pct: pct(linkReport.resolved, linkReport.links),
        slugResolvable: linkReport.slugResolvable.length,
        dangling: linkReport.dangling.length,
      },
      sessions: {
        notes: sessionNotes.length,
        linkingConcepts: sessionsLinkingConcepts,
        pct: pct(sessionsLinkingConcepts, sessionNotes.length),
      },
    };
  } finally {
    if (ownsDb) db.close();
  }
}
