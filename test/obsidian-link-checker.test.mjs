import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { checkVaultLinks } from '../lib/obsidian-link-checker.mjs';

describe('checkVaultLinks', () => {
  let vault;

  before(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vault-check-'));
    await mkdir(join(vault, 'concepts'), { recursive: true });
    await mkdir(join(vault, 'sessions'), { recursive: true });

    await writeFile(join(vault, 'concepts', 'alpha.md'),
      '---\ntype: concept\n---\n# Alpha\nLinks: [[Beta Note]], [[Ghost Entity]], [[gamma-prime]] and [[Gamma Display|shown]]');
    await writeFile(join(vault, 'concepts', 'beta-note.md'),
      '---\ntype: concept\n---\n# Beta\nBack to [[alpha]].');
    await writeFile(join(vault, 'concepts', 'gamma-prime.md'),
      '---\ntype: concept\naliases: [Gamma Display, Gamma]\n---\n# Gamma\nNo outbound links.');
    await writeFile(join(vault, 'sessions', 'lonely-session.md'),
      '---\ntype: session\n---\n# Lonely\nPoints at [[alpha#heading]].');
  });

  after(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('classifies exact, slug-resolvable, and dangling links', () => {
    const r = checkVaultLinks(vault);
    assert.equal(r.notes, 4);
    assert.equal(r.links, 6);
    // exact: [[gamma-prime]], [[Gamma Display|shown]] (alias), [[alpha]], [[alpha#heading]]
    assert.equal(r.resolved, 4);
    // slug-resolvable: [[Beta Note]] → beta-note.md
    assert.deepEqual(r.slugResolvable, [{ file: join('concepts', 'alpha.md'), target: 'Beta Note' }]);
    // dangling: [[Ghost Entity]]
    assert.deepEqual(r.dangling, [{ file: join('concepts', 'alpha.md'), target: 'Ghost Entity' }]);
  });

  it('reports orphans — notes with zero inbound links', () => {
    const r = checkVaultLinks(vault);
    assert.deepEqual(r.orphans, [join('sessions', 'lonely-session.md')]);
  });

  it('a seeded dangling link is detected by name and clears when removed', async () => {
    const seeded = join(vault, 'concepts', 'seeded.md');
    await writeFile(seeded, '# Seeded\n[[repair-2-4-seeded-dangling-target]]');
    const withSeed = checkVaultLinks(vault);
    assert.ok(withSeed.dangling.some((d) => d.target === 'repair-2-4-seeded-dangling-target'));

    await rm(seeded);
    const cleared = checkVaultLinks(vault);
    assert.ok(!cleared.dangling.some((d) => d.target === 'repair-2-4-seeded-dangling-target'));
  });

  it('missing vault path returns an empty report, not a throw', () => {
    const r = checkVaultLinks(join(vault, 'does-not-exist'));
    assert.equal(r.notes, 0);
    assert.equal(r.links, 0);
  });
});
