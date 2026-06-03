import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugifyName } from '../lib/obsidian-summarizer.mjs';

const routeSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..',
    'mission-control', 'src', 'app', 'api', 'memory-content', 'route.ts'),
  'utf-8'
);

function extractRouteSlugify() {
  const match = routeSrc.match(/function slugify\(name: string\): string \{([\s\S]*?)\n\}/);
  assert.ok(match, 'route.ts must contain the slugify mirror');
  return new Function('name', match[1].replace(/\breturn name\b/, 'return String(name)'));
}

const BATTERY = [
  'NATS JetStream',
  'Gui',
  'projects/arcane/geoblar/THE_HIDDEN_TRUTH_INDEX.md',
  'NATS KV interference bug pattern',
  'a very long entity name that easily exceeds sixty characters once slugified for the vault',
  '  --leading and trailing separators--  ',
  'Üñíçødé Náme with Áccents',
  'UTC-5/UTC-4 (DST) timezone handling',
  'multiple---consecutive___separators...here',
  'x',
];

test('route slugify is byte-equivalent to the writer slugifyName across a hostile battery', () => {
  const routeSlugify = extractRouteSlugify();
  for (const name of BATTERY) {
    assert.equal(routeSlugify(name), slugifyName(name), `divergence on: ${JSON.stringify(name)}`);
  }
});

test('long names are not capped — the writer never truncates, so the reader must not either', () => {
  const long = BATTERY[4];
  assert.ok(slugifyName(long).length > 60, 'fixture must exceed 60 chars');
  assert.equal(extractRouteSlugify()(long), slugifyName(long));
});

test('the route mirror carries no length cap (R7 regression lock)', () => {
  const match = routeSrc.match(/function slugify\(name: string\): string \{[\s\S]*?\n\}/);
  assert.doesNotMatch(match[0], /\.slice\(/);
});
