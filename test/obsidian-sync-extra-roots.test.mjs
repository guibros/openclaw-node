import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routeExtraFile } from '../workspace-bin/obsidian-sync.mjs';

const ROUTES = [
  { pattern: 'README.md', domain: '22-openclaw-node' },
  { pattern: 'docs/**', domain: '22-openclaw-node', subfolder: 'docs' },
  { pattern: 'memory-plan/canonical/*.md', domain: '22-openclaw-node', subfolder: 'protocol' },
  { pattern: 'memory-plan/plans/*/DECISIONS.md', domain: '22-openclaw-node', subfolder: 'plans', stripPrefix: 'memory-plan/plans/' },
];

describe('routeExtraFile — extra source trees into the global vault', () => {
  it('routes plain and subfoldered patterns with kebab-cased names', () => {
    assert.equal(routeExtraFile('README.md', ROUTES).dest, '22-openclaw-node/readme.md');
    assert.equal(routeExtraFile('docs/NODE_WATCH_SPEC.md', ROUTES).dest, '22-openclaw-node/docs/node-watch-spec.md');
    assert.equal(routeExtraFile('memory-plan/canonical/MASTER_PLAN.md', ROUTES).dest, '22-openclaw-node/protocol/master-plan.md');
  });
  it('stripPrefix preserves dirs so same-named files never clobber', () => {
    assert.equal(
      routeExtraFile('memory-plan/plans/repair/DECISIONS.md', ROUTES).dest,
      '22-openclaw-node/plans/repair/decisions.md',
    );
    assert.equal(
      routeExtraFile('memory-plan/plans/protocol/DECISIONS.md', ROUTES).dest,
      '22-openclaw-node/plans/protocol/decisions.md',
    );
  });
  it('unmatched and excluded files return null', () => {
    assert.equal(routeExtraFile('lib/notify.mjs', ROUTES), null);
    assert.equal(routeExtraFile('docs/big.md', ROUTES, ['docs/**']), null);
  });
  it('domain frontmatter strips the numeric prefix', () => {
    assert.equal(routeExtraFile('README.md', ROUTES).domain, 'openclaw-node');
  });
});
