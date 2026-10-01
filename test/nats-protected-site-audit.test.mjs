import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProtectedSite, parseDiskutilInfo } from '../lib/nats-protected-site-audit.mjs';

const staged = {
  account: { uid: 400, gid: 400 },
  operatorUid: 501,
  ancestors: Array.from({ length: 3 }, () => ({ isDirectory: true, uid: 0, gid: 0, mode: 0o40755, device: 7 })),
  root: { isDirectory: true, uid: 0, gid: 0, mode: 0o40755, device: 7 },
  marker: 'absent',
  volume: { apfs: true, ownersEnabled: true },
};

describe('protected NATS site audit', () => {
  it('requires the distinct service account, owned filesystem and unpublished root', () => {
    assert.equal(evaluateProtectedSite(staged).readyForStaging, true);
    const missing = evaluateProtectedSite({ ...staged, account: null, root: null });
    assert.equal(missing.readyForStaging, false);
    assert.deepEqual(missing.checks.filter((check) => !check.ok).map((check) => check.id),
      ['service-account', 'protected-root']);
  });

  it('refuses a group-writable ancestor and an existing handoff marker', () => {
    const report = evaluateProtectedSite({ ...staged,
      ancestors: [{ ...staged.ancestors[0], mode: 0o40775 }, ...staged.ancestors.slice(1)], marker: 'present' });
    assert.equal(report.readyForStaging, false);
    assert.deepEqual(report.checks.filter((check) => !check.ok).map((check) => check.id),
      ['protected-parent', 'handoff-marker']);
  });

  it('does not accept the operator UID as the protected writer', () => {
    assert.equal(evaluateProtectedSite({ ...staged, account: { uid: 501, gid: 400 } }).readyForStaging, false);
  });

  it('refuses a handoff root mounted on another device', () => {
    const result = evaluateProtectedSite({ ...staged, root: { ...staged.root, device: 8 } });
    assert.equal(result.readyForStaging, false);
    assert.equal(result.checks.find((check) => check.id === 'protected-root').ok, false);
  });

  it('parses the macOS ownership facts without inferring them from APFS alone', () => {
    assert.deepEqual(parseDiskutilInfo('File System Personality: APFS\nOwners: Enabled\n'),
      { apfs: true, ownersEnabled: true });
    assert.deepEqual(parseDiskutilInfo('File System Personality: APFS\nOwners: Disabled\n'),
      { apfs: true, ownersEnabled: false });
  });
});
