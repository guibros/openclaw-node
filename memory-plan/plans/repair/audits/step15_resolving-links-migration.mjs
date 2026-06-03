import fs from 'node:fs';
import path from 'node:path';
import { slugifyName, buildSessionNoteResolver } from '/Users/moltymac/openclaw-nodedev/lib/obsidian-summarizer.mjs';
import { checkVaultLinks } from '/Users/moltymac/openclaw-nodedev/lib/obsidian-link-checker.mjs';
import { atomicWriteFileSync } from '/Users/moltymac/openclaw-nodedev/lib/atomic-write.mjs';

const vault = '/Users/moltymac/.openclaw/obsidian-local';
const conceptsDir = path.join(vault, 'concepts');
const resolver = buildSessionNoteResolver(vault);

// Pass 1: aliases from H1 for concept notes lacking them.
let aliased = 0;
for (const f of fs.readdirSync(conceptsDir).filter((x) => x.endsWith('.md'))) {
  const p = path.join(conceptsDir, f);
  let c = fs.readFileSync(p, 'utf-8');
  if (/^aliases:/m.test(c)) continue;
  const h1 = c.match(/^# (.+)$/m);
  if (!h1) continue;
  const name = h1[1].trim().replace(/"/g, '\\"');
  const next = c.replace(/^type: concept$/m, `type: concept\naliases: ["${name}"]`);
  if (next !== c) { atomicWriteFileSync(p, next); aliased++; }
}

// Pass 2: with aliases in place, fix the remaining dangling links in place.
const report = checkVaultLinks(vault);
const danglingByFile = new Map();
for (const d of report.dangling) {
  if (!danglingByFile.has(d.file)) danglingByFile.set(d.file, new Set());
  danglingByFile.get(d.file).add(d.target);
}

let sessionLinksFixed = 0, sessionLinksTexted = 0, relatedDropped = 0, filesTouched = 0;
for (const [rel, targets] of danglingByFile) {
  const p = path.join(vault, rel);
  let c = fs.readFileSync(p, 'utf-8');
  const before = c;
  for (const target of targets) {
    const esc = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (target.startsWith('sessions/')) {
      const sid = target.slice('sessions/'.length);
      const note = resolver(sid);
      if (note) { c = c.replaceAll(`[[${target}]]`, `[[sessions/${note}]]`); sessionLinksFixed++; }
      else { c = c.replaceAll(`- [[${target}]]`, `- session ${sid}`).replaceAll(`[[${target}]]`, `sessions/${sid}`); sessionLinksTexted++; }
    } else {
      // related-list / body name links with no note: unlink to plain text.
      c = c.replace(new RegExp(`\\[\\[${esc}\\]\\](, )?`, 'g'), (m, sep) => relatedDropped++ && false || (sep ? '' : ''));
    }
  }
  // tidy empty related lists
  c = c.replace(/^related: \[\s*\]$/m, '');
  if (c !== before) { atomicWriteFileSync(p, c); filesTouched++; }
}

console.log(JSON.stringify({ aliased, filesTouched, sessionLinksFixed, sessionLinksTexted, relatedDropped }));
