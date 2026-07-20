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
});
