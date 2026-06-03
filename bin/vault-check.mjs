#!/usr/bin/env node
/**
 * vault-check.mjs — CLI for the vault link-integrity checker (R9, repair 2.4)
 * and the referential coverage report (repair 2.6).
 *
 * Usage: node bin/vault-check.mjs [--vault <path>] [--json]
 *        node bin/vault-check.mjs --coverage [--db <state.db>] [--vault <path>] [--json]
 */

import { checkVaultLinks, checkReferentialCoverage } from '../lib/obsidian-link-checker.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const vaultPath = flag('--vault');
const asJson = args.includes('--json');

if (args.includes('--coverage')) {
  const cov = checkReferentialCoverage({ vaultPath, dbPath: flag('--db') });
  if (asJson) {
    console.log(JSON.stringify(cov, null, 2));
  } else {
    console.log(`Vault: ${cov.vaultPath} | threshold: mention_count ≥ ${cov.threshold}`);
    console.log(`Concept coverage: ${cov.concepts.withNote}/${cov.concepts.eligible} (${cov.concepts.pct}%)`);
    if (cov.concepts.missing.length) {
      console.log(`  missing: ${cov.concepts.missing.slice(0, 10).join(', ')}${cov.concepts.missing.length > 10 ? ` … +${cov.concepts.missing.length - 10}` : ''}`);
    }
    console.log(`Link resolution: ${cov.links.resolved}/${cov.links.total} (${cov.links.pct}%) | slug-resolvable ${cov.links.slugResolvable} | dangling ${cov.links.dangling}`);
    console.log(`Session notes linking concepts: ${cov.sessions.linkingConcepts}/${cov.sessions.notes} (${cov.sessions.pct}%)`);
  }
} else {
  const report = checkVaultLinks(vaultPath);

  if (asJson) {
    // No process.exit() — it truncates large unflushed stdout.
    console.log(JSON.stringify(report, null, 2));
  } else {
    const cap = (list, n = 10) =>
      list.slice(0, n).map((x) => (typeof x === 'string' ? `  ${x}` : `  ${x.file} → [[${x.target}]]`)).join('\n')
      + (list.length > n ? `\n  … and ${list.length - n} more` : '');

    console.log(`Vault: ${report.vaultPath}`);
    console.log(`Notes: ${report.notes} | Wikilinks: ${report.links}`);
    console.log(`Resolved (Obsidian-exact): ${report.resolved}`);
    console.log(`Slug-resolvable (name→slug gap, 2.8): ${report.slugResolvable.length}`);
    if (report.slugResolvable.length) console.log(cap(report.slugResolvable, 5));
    console.log(`Dangling (no note at all): ${report.dangling.length}`);
    if (report.dangling.length) console.log(cap(report.dangling));
    console.log(`Orphans (no inbound links): ${report.orphans.length}`);
    if (report.orphans.length) console.log(cap(report.orphans, 5));
  }
}
