/**
 * obsidian-graph.mjs — Wikilink graph parser for the Obsidian vault.
 *
 * Walks the vault directory, parses each markdown note's frontmatter and body,
 * extracts [[wikilinks]], and returns a {nodes, edges} graph structure.
 *
 * Depends on:
 *   - lib/obsidian-vault.mjs (vault path resolution)
 *   - lib/obsidian-summarizer.mjs (slugifyName for id↔filename matching)
 *   - js-yaml (frontmatter parsing — existing dependency)
 */

import { join, relative, basename, extname, dirname } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import yaml from 'js-yaml';
import { getVaultPath } from './obsidian-vault.mjs';

/**
 * Recursively walk a vault directory and return all .md file descriptors.
 *
 * @param {string} vaultPath — root vault directory
 * @returns {Promise<Array<{filePath: string, relativePath: string, id: string, subdirectory: string}>>}
 */
export async function walkVault(vaultPath) {
  const resolved = vaultPath || getVaultPath();
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist or unreadable — skip
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        const relPath = relative(resolved, fullPath);
        const subdir = relative(resolved, dirname(fullPath)) || '.';
        const id = basename(entry.name, '.md');
        results.push({
          filePath: fullPath,
          relativePath: relPath,
          id,
          subdirectory: subdir,
        });
      }
    }
  }

  await walk(resolved);
  return results;
}

/**
 * Parse a markdown note into frontmatter and body.
 *
 * @param {string} content — raw file content
 * @returns {{ frontmatter: object|null, body: string }}
 */
export function parseNote(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: null, body: content };
  }

  let frontmatter = null;
  try {
    frontmatter = yaml.load(fmMatch[1]);
  } catch {
    // Malformed YAML — treat as no frontmatter
  }

  return { frontmatter, body: fmMatch[2] };
}

/**
 * Extract all [[wikilink]] targets from text.
 * Handles both [[target]] and [[target|display text]] forms.
 *
 * @param {string} text
 * @returns {string[]} array of target strings (without display text)
 */
export function extractWikilinks(text) {
  const matches = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
  return matches.map(m => m[1].trim());
}

/**
 * Normalize a wikilink target to a graph node id (note basename).
 * Legacy notes carry path-style targets ([[sessions/x]]) and display-name
 * targets ([[NATS JetStream]]) — neither matched the basename node ids, which
 * left 42/105 cached edges permanently dangling (memory review 2026-07-04).
 */
export function normalizeLinkTarget(target, nodeIds) {
  const base = target.includes('/') ? target.slice(target.lastIndexOf('/') + 1) : target;
  if (nodeIds.has(base)) return base;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (nodeIds.has(slug)) return slug;
  return base; // dangling — keep for diagnostics
}

/** Flatten js-yaml's parse of legacy `related: [[[Name]], ...]` (nested arrays)
 *  and modern quoted strings into a flat list of link-bearing strings. */
function flattenRelated(related) {
  const out = [];
  const visit = (v) => {
    if (typeof v === 'string') out.push(v.includes('[[') ? v : `[[${v}]]`);
    else if (Array.isArray(v)) v.forEach(visit);
  };
  visit(related);
  return out;
}

/**
 * Determine edge type from frontmatter directives.
 * If frontmatter has an `edge_types` mapping (target → type), use it.
 * Otherwise default to 'mentions'.
 *
 * @param {object|null} frontmatter
 * @param {string} target — the wikilink target name
 * @returns {string} edge type
 */
function resolveEdgeType(frontmatter, target) {
  if (!frontmatter || !frontmatter.edge_types) return 'mentions';
  const mapping = frontmatter.edge_types;
  if (typeof mapping !== 'object') return 'mentions';
  // Look up target directly, or by lowercase match
  if (mapping[target]) return mapping[target];
  const lower = target.toLowerCase();
  for (const [key, val] of Object.entries(mapping)) {
    if (key.toLowerCase() === lower) return val;
  }
  return 'mentions';
}

/**
 * Build a graph from all markdown notes in the vault.
 *
 * @param {string} [vaultPath] — vault root (defaults via getVaultPath)
 * @returns {Promise<{nodes: Map<string, object>, edges: Array<{source: string, target: string, type: string}>}>}
 */
export async function buildGraph(vaultPath) {
  const resolved = vaultPath || getVaultPath();
  const notes = await walkVault(resolved);
  const nodes = new Map();
  const edges = [];

  const parsed = [];
  for (const note of notes) {
    const content = await readFile(note.filePath, 'utf-8');
    const { frontmatter, body } = parseNote(content);

    nodes.set(note.id, {
      label: note.id,
      subdirectory: note.subdirectory,
      ...(frontmatter || {}),
    });
    parsed.push({ note, frontmatter, body });
  }

  // Two passes: node ids must be complete before targets can normalize.
  const nodeIds = new Set(nodes.keys());
  for (const { note, frontmatter, body } of parsed) {
    const seen = new Set();
    const addEdge = (rawTarget) => {
      const target = normalizeLinkTarget(rawTarget, nodeIds);
      if (target === note.id || seen.has(target)) return;
      seen.add(target);
      edges.push({ source: note.id, target, type: resolveEdgeType(frontmatter, rawTarget) });
    };

    for (const target of extractWikilinks(body)) addEdge(target);

    // Frontmatter `related`: flattened so legacy nested-array notes still
    // contribute edges (the strict typeof-string branch was dead code for
    // every real note — zero concept→concept edges).
    if (frontmatter && frontmatter.related != null) {
      for (const rel of flattenRelated(frontmatter.related)) {
        for (const target of extractWikilinks(rel)) addEdge(target);
      }
    }
  }

  return { nodes, edges };
}
