const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { diffRules, mergeRules } = require('../bin/harness-sync');

describe('harness-sync managed rules', () => {
  it('upgrades managed command text while preserving the active toggle', () => {
    const source = [{
      id: 'hyperagent-task-start',
      managed: true,
      active: true,
      content: 'new safe command',
      activateOn: ['task start'],
      scope: ['local', 'mesh'],
    }];
    const deployed = [{
      id: 'hyperagent-task-start',
      active: false,
      content: 'old broken command',
      activateOn: ['old event'],
      scope: ['local'],
    }];

    const report = diffRules(source, deployed);
    assert.deepEqual(report.fieldUpdates[0].updates.map((update) => update.key).sort(),
      ['activateOn', 'content', 'managed', 'scope']);

    const [merged] = mergeRules(source, deployed, false);
    assert.equal(merged.content, 'new safe command');
    assert.deepEqual(merged.activateOn, ['task start']);
    assert.deepEqual(merged.scope, ['local', 'mesh']);
    assert.equal(merged.active, false);
  });

  it('preserves content edits on ordinary user-owned rules', () => {
    const source = [{ id: 'personal', content: 'upstream', active: true, scope: ['local'] }];
    const deployed = [{ id: 'personal', content: 'mine', active: true, scope: ['local'] }];
    assert.equal(mergeRules(source, deployed, false)[0].content, 'mine');
  });

  // Retirement semantics (hyperagent-evidence 0.1): plain source deletion CANNOT
  // retire a managed rule — deployed-not-in-source is preserved as userOnly.
  it('retired managed rule is removed from deployed and reported', () => {
    const source = [{ id: 'old-managed', managed: true, retired: true }];
    const deployed = [
      { id: 'old-managed', managed: true, type: 'inject', content: 'legacy text', active: true },
      { id: 'users-own', content: 'keep me', active: true },
    ];
    const report = diffRules(source, deployed);
    assert.deepEqual(report.retirements, ['old-managed']);
    assert.equal(report.newRules.length, 0, 'retired rule never reported as new');
    const merged = mergeRules(source, deployed, false);
    assert.deepEqual(merged.map((r) => r.id), ['users-own'], 'retired removed; user rule untouched');
  });

  it('retired managed rule is never installed fresh', () => {
    const source = [{ id: 'old-managed', managed: true, retired: true }];
    const merged = mergeRules(source, [], false);
    assert.equal(merged.length, 0);
    assert.equal(diffRules(source, []).retirements.length, 0, 'nothing to retire on a clean deploy');
  });

  it('retirement requires managed:true — unmanaged retired ids are left alone', () => {
    const source = [{ id: 'weird', retired: true }];
    const deployed = [{ id: 'weird', content: 'user thing', active: true }];
    const merged = mergeRules(source, deployed, false);
    assert.equal(merged.length, 1, 'non-managed rule not force-removed');
  });
});
