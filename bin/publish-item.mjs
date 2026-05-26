#!/usr/bin/env node
/**
 * publish-item.mjs — CLI tool for operator-curated privacy management.
 *
 * Usage:
 *   node bin/publish-item.mjs --name "entity name" --type entity
 *   node bin/publish-item.mjs --name "entity name" --type entity --unpublish
 *   node bin/publish-item.mjs --list
 *
 * @module bin/publish-item
 */

import { createExtractionStore } from '../lib/extraction-store.mjs';
import { parseArgs } from 'node:util';

// ─── Exports (for testing) ────────────────────────────────────────────────────

/**
 * Look up an item by name/label in the extraction store.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} name
 * @param {'entity'|'decision'|'theme'} itemType
 * @returns {{ id: number, name: string }|null}
 */
export function lookupItem(db, name, itemType) {
  const lowerName = name.toLowerCase();

  if (itemType === 'entity') {
    const row = db.prepare(
      'SELECT id, name FROM entities WHERE LOWER(name) = ?'
    ).get(lowerName);
    return row || null;
  }

  if (itemType === 'theme') {
    const row = db.prepare(
      'SELECT id, label as name FROM themes WHERE LOWER(label) = ?'
    ).get(lowerName);
    return row || null;
  }

  if (itemType === 'decision') {
    const row = db.prepare(
      'SELECT id, decision as name FROM decisions WHERE LOWER(decision) = ?'
    ).get(lowerName);
    return row || null;
  }

  return null;
}

/**
 * List all published items with enriched details.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{item_id: number, item_type: string, name: string, published_at: string}>}
 */
export function listPublishedItems(db) {
  const published = db.prepare(
    'SELECT item_id, item_type, published_at, published_by_session FROM published_items ORDER BY published_at DESC'
  ).all();

  return published.map(p => {
    let name = `unknown (id=${p.item_id})`;
    try {
      if (p.item_type === 'entity') {
        const row = db.prepare('SELECT name FROM entities WHERE id = ?').get(p.item_id);
        if (row) name = row.name;
      } else if (p.item_type === 'theme') {
        const row = db.prepare('SELECT label FROM themes WHERE id = ?').get(p.item_id);
        if (row) name = row.label;
      } else if (p.item_type === 'decision') {
        const row = db.prepare('SELECT decision FROM decisions WHERE id = ?').get(p.item_id);
        if (row) name = row.decision;
      }
    } catch { /* ignore lookup errors */ }

    return {
      item_id: p.item_id,
      item_type: p.item_type,
      name,
      published_at: p.published_at,
    };
  });
}

// ─── CLI Entry ────────────────────────────────────────────────────────────────

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('/publish-item.mjs') ||
  process.argv[1].endsWith('\\publish-item.mjs')
);

if (isMainModule) {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      type: { type: 'string', default: 'entity' },
      unpublish: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      'db-path': { type: 'string' },
    },
    strict: false,
  });

  const store = createExtractionStore({ dbPath: values['db-path'] });

  try {
    if (values.list) {
      const items = listPublishedItems(store.db);
      if (!items.length) {
        console.log('No published items.');
      } else {
        console.log(`Published items (${items.length}):\n`);
        for (const item of items) {
          console.log(`  [${item.item_type}] ${item.name} (id=${item.item_id}, published ${item.published_at})`);
        }
      }
      process.exit(0);
    }

    if (!values.name) {
      console.error('Usage: node bin/publish-item.mjs --name "item name" --type entity|decision|theme [--unpublish]');
      console.error('       node bin/publish-item.mjs --list');
      process.exit(1);
    }

    const itemType = values.type;
    if (!['entity', 'decision', 'theme'].includes(itemType)) {
      console.error(`Unknown item type: ${itemType}. Must be entity, decision, or theme.`);
      process.exit(1);
    }

    const item = lookupItem(store.db, values.name, itemType);
    if (!item) {
      console.error(`No ${itemType} found with name: "${values.name}"`);
      process.exit(1);
    }

    if (values.unpublish) {
      store.unpublishItem(item.id, itemType);
      console.log(`Unpublished ${itemType} "${item.name}" (id=${item.id}) — now private.`);
    } else {
      store.publishItem(item.id, itemType);
      console.log(`Published ${itemType} "${item.name}" (id=${item.id}) — now public.`);
    }
  } finally {
    store.close();
  }
}
