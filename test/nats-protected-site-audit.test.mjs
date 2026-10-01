import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProtectedSite, parseDiskutilInfo, parseLsAclEntries, parseAdminMembership } from '../lib/nats-protected-site-audit.mjs';

const staged = {
  account: { uid: 400, gid: 400, recordUid: 400, recordGid: 400, groupRecordGid: 400,
    groupName: '_openclaw_nats', groups: [400], shell: '/usr/bin/false',
    home: '/var/empty', adminMember: false },
  operatorUid: 501,
  ancestors: Array.from({ length: 3 }, () => ({ isDirectory: true, uid: 0, gid: 0, mode: 0o40755,
    device: 7, aclEntries: false })),
  root: { isDirectory: true, uid: 0, gid: 0, mode: 0o40755, device: 7, aclEntries: false },
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
    assert.equal(evaluateProtectedSite({ ...staged,
      account: { ...staged.account, uid: 501, recordUid: 501 } }).readyForStaging, false);
    assert.equal(evaluateProtectedSite({ ...staged, operatorUid: 0 }).readyForStaging, false);
  });

  it('requires a dedicated non-admin system account', () => {
    for (const account of [
      { uid: 502, recordUid: 502 },
      { gid: 20, recordGid: 20, groupName: 'staff', groups: [20] },
      { gid: 0, recordGid: 0, groupName: 'wheel', groups: [0] },
      { groups: [400, 80], adminMember: true },
      { shell: '/bin/zsh' },
      { home: '/Users/shared' },
      { recordUid: 401 },
      { groupRecordGid: 401 },
    ]) {
      assert.equal(evaluateProtectedSite({ ...staged,
        account: { ...staged.account, ...account } }).readyForStaging, false);
    }
  });

  it('refuses a handoff root mounted on another device', () => {
    const result = evaluateProtectedSite({ ...staged, root: { ...staged.root, device: 8 } });
    assert.equal(result.readyForStaging, false);
    assert.equal(result.checks.find((check) => check.id === 'protected-root').ok, false);
  });

  it('refuses ACL entries on an ancestor or the protected root', () => {
    assert.equal(evaluateProtectedSite({ ...staged,
      ancestors: [{ ...staged.ancestors[0], aclEntries: true }, ...staged.ancestors.slice(1)] }).readyForStaging, false);
    assert.equal(evaluateProtectedSite({ ...staged,
      root: { ...staged.root, aclEntries: true } }).readyForStaging, false);
  });

  it('parses the macOS ownership facts without inferring them from APFS alone', () => {
    assert.deepEqual(parseDiskutilInfo('File System Personality: APFS\nOwners: Enabled\n'),
      { apfs: true, ownersEnabled: true });
    assert.deepEqual(parseDiskutilInfo('File System Personality: APFS\nOwners: Disabled\n'),
      { apfs: true, ownersEnabled: false });
  });

  it('reads ACL entries even when extended attributes take the mode suffix', () => {
    assert.equal(parseLsAclEntries('drwxr-xr-x@ 4 root wheel 128 Oct 1 12:00 /private/var/db\n 0: user:guest allow write,delete\n'), true);
    assert.equal(parseLsAclEntries('drwxr-xr-x@ 4 root wheel 128 Oct 1 12:00 /private/var/db\n'), false);
    assert.throws(() => parseLsAclEntries('drwxr-xr-x+ 4 root wheel 128 Oct 1 12:00 /private/var/db\n'));
  });

  it('accepts dseditgroup non-membership output regardless of its exit status', () => {
    assert.equal(parseAdminMembership('no _openclaw_nats is NOT a member of admin\n'), false);
    assert.equal(parseAdminMembership('yes _openclaw_nats is a member of admin\n'), true);
    assert.throws(() => parseAdminMembership('Group not found.\n'));
  });
});
