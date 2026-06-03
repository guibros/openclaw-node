#!/usr/bin/env node
/**
 * vault-check.mjs — CLI for the vault link-integrity checker (R9, repair 2.4).
 *
 * Usage: node bin/vault-check.mjs [--vault <path>] [--json]
 */

import { checkVaultLinks } from '../lib/obsidian-link-checker.mjs';

const args = process.argv.slice(2);
const vaultIdx = args.indexOf('--vault');
const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : undefined;
const asJson = args.includes('--json');

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
