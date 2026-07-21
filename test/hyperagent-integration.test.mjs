import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperagent-cli-'));
const cli = path.resolve('bin/hyperagent.mjs');
const env = {
  ...process.env,
  OPENCLAW_HOME: home,
  OPENCLAW_NODE_ID: 'integration-node',
  OPENCLAW_SOUL_ID: 'integration-soul',
};

after(() => fs.rmSync(home, { recursive: true, force: true }));

function run(args, input) {
  return spawnSync(process.execPath, [cli, ...args], {
    env,
    input: input == null ? undefined : JSON.stringify(input),
    encoding: 'utf8',
  });
}

describe('hyperagent CLI integration', () => {
  it('accepts telemetry through stdin without shell interpolation', () => {
    const result = run(['log', '--stdin'], {
      task_id: 'cli-task-1', domain: 'Code Review', outcome: 'success', iterations: 1,
      meta_notes: "The user's apostrophe and $SHELL text remain inert JSON data.",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /domain=code-review/);
    assert.match(run(['status']).stdout, /Telemetry entries: 1/);
  });

  it('consult returns the selected strategy content and id', () => {
    const seeded = run(['seed-strategy', '--stdin'], {
      domain: 'testing', subdomain: 'unit', title: 'Test first',
      content: 'Write a focused failing test before implementation.',
    });
    assert.equal(seeded.status, 0, seeded.stderr);
    const result = run(['consult', '--domain', 'testing', '--subdomain', 'unit']);
    assert.equal(result.status, 0, result.stderr);
    const strategy = JSON.parse(result.stdout);
    assert.equal(strategy.title, 'Test first');
    assert.equal(strategy.content, 'Write a focused failing test before implementation.');
    assert.ok(strategy.strategy_id > 0);
  });

  it('runs reflection synthesis and proposal approval end to end', () => {
    for (let i = 0; i < 5; i++) {
      const result = run(['log', '--stdin'], {
        task_id: `reflection-${i}`, domain: 'integration', outcome: 'success', iterations: 1,
        meta_notes: `Integration reflection task ${i} provides concrete evidence for synthesis.`,
      });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(run(['reflect']).status, 0);
    const pendingResult = run(['reflect', '--pending']);
    assert.equal(pendingResult.status, 0, pendingResult.stderr);
    const pending = JSON.parse(pendingResult.stdout);

    const synthesis = run(['reflect', '--write-synthesis', '--stdin'], {
      reflection_id: pending.reflection_id,
      hypotheses: ['Focused integration tasks have a stable one-iteration baseline.'],
      proposals: [{
        title: 'Integration strategy', description: 'Preserve the focused baseline',
        proposal_type: 'strategy_new',
        diff_content: { domain: 'integration', content: 'Keep integration tasks focused and measurable.' },
      }],
    });
    assert.equal(synthesis.status, 0, synthesis.stderr);
    assert.match(synthesis.stdout, /proposal created: id=/);

    const proposals = run(['proposals']);
    const proposalId = Number(proposals.stdout.match(/^\s*(\d+)\s+pending/m)?.[1]);
    assert.ok(proposalId > 0, proposals.stdout);
    const approved = run(['approve', String(proposalId)]);
    assert.equal(approved.status, 0, approved.stderr);
    assert.match(run(['consult', '--domain', 'integration']).stdout, /Keep integration tasks focused/);
  });
});

// Cohort provenance (hyperagent-evidence 0.2): the REAL producer funnel writes
// rows a single SQL query separates by execution class — no free text.
describe('cohort provenance through the real producer funnel', () => {
  it('real and mock tasks are mechanically separable; provenance survives round-trip', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-prov-'));
    const dbPath = path.join(scratch, 'state.db');
    process.env.OPENCLAW_STATE_DB = dbPath;
    process.env.OPENCLAW_HA_RUN_ID = 'run-prov-test';
    try {
      const { recordHyperagentTask, deriveExecutionClass } = await import('../bin/mesh-agent.js');

      assert.equal(deriveExecutionClass({ execution_class: 'chaos' }, 'claude'), 'chaos');
      assert.equal(deriveExecutionClass({}, 'shell'), 'mock');
      assert.equal(deriveExecutionClass({}, 'claude'), 'real');

      await recordHyperagentTask(
        { task_id: 'prov-real-1', title: 'real one', domain: 'integration', collaboration: { mode: 'adversarial' }, llm_provider: 'claude' },
        { outcome: 'success', iterations: 2, startedAt: Date.now() - 60000, notes: 'real', sessionId: 'sess-1' });
      await recordHyperagentTask(
        { task_id: 'prov-mock-1', title: 'mock one', domain: 'integration', llm_provider: 'shell', plan_id: 'plan-9' },
        { outcome: 'failure', iterations: 1, startedAt: Date.now() - 1000, notes: 'mock' });

      const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
      const store = createHyperAgentStore({ dbPath });
      const rows = store.getTelemetry({ limit: 10 });
      const real = rows.filter((r) => r.execution_class === 'real');
      const mock = rows.filter((r) => r.execution_class === 'mock');
      assert.equal(real.length, 1);
      assert.equal(mock.length, 1);
      assert.equal(real[0].session_id, 'sess-1');
      assert.equal(real[0].collaboration_mode, 'adversarial');
      assert.equal(real[0].run_id, 'run-prov-test');
      assert.equal(real[0].provider, 'claude');
      assert.equal(real[0].logical_task_id, 'prov-real-1', 'solo task is its own logical task');
      assert.equal(mock[0].logical_task_id, 'plan-9', 'plan linkage wins for subtask rows');
      assert.equal(mock[0].provider, 'shell');
      store.close();
    } finally {
      delete process.env.OPENCLAW_STATE_DB;
      delete process.env.OPENCLAW_HA_RUN_ID;
      fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
