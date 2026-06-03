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
import { slugifyName } from './obsidian-summarizer.mjs';
import { getVaultPath } from './obsidian-vault.mjs';

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
      const exact = index.get(target.toLowerCase());
      if (exact) {
        resolved++;
        if (exact !== rel) inbound.add(exact);
        continue;
      }
      const slug = index.get(slugifyName(target));
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
