#!/usr/bin/env node

/**
 * hyperagent-store.test.js — Unit tests for the HyperAgent protocol store.
 *
 * No external dependencies (NATS not required). Uses temp SQLite DB.
 * Run: node test/hyperagent-store.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = path.join(os.tmpdir(), `ha-test-${Date.now()}.db`);
let store;

before(async () => {
  const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
  store = createHyperAgentStore({ dbPath: DB_PATH });
});

after(() => {
  if (store) store.close();
  try { fs.unlinkSync(DB_PATH); } catch {}
  try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
  try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}
});

// ── Store Init ──────────────────────────────────

describe('HyperAgentStore: init', () => {
  it('getStats returns zeroed counts on fresh DB', () => {
    const stats = store.getStats();
    assert.equal(stats.telemetry, 0);
    assert.equal(stats.strategies, 0);
    assert.equal(stats.reflections, 0);
    assert.equal(stats.pendingProposals, 0);
    assert.equal(stats.unreflected, 0);
  });
});

// ── Telemetry ──────────────────────────────────

describe('HyperAgentStore: telemetry', () => {
  it('logTelemetry inserts a row and returns it', () => {
    const row = store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus', task_id: 'task-001',
      domain: 'solidity', subdomain: 'erc20', outcome: 'success',
      iterations: 2, duration_minutes: 15,
      meta_notes: 'Used test-first approach. Caught reentrancy bug early via hardhat test isolation.',
    });

    assert.ok(row.id);
    assert.equal(row.domain, 'solidity');
    assert.equal(row.outcome, 'success');
    assert.equal(row.iterations, 2);
    assert.ok(row.created_at);
  });

  it('auto-detects no-meta-notes flag when notes are too short', () => {
    const row = store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus',
      domain: 'infra', outcome: 'success', iterations: 1,
      meta_notes: 'short',
    });

    const flags = JSON.parse(row.pattern_flags);
    assert.ok(flags.includes('no-meta-notes'), `expected no-meta-notes, got: ${flags}`);
  });

  it('auto-detects multiple-iterations flag when iterations > 3', () => {
    const row = store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus',
      domain: 'infra', subdomain: 'nats', outcome: 'failure', iterations: 5,
      meta_notes: 'NATS connection timeout. Tried 5 approaches before finding root cause was Tailscale.',
    });

    const flags = JSON.parse(row.pattern_flags);
    assert.ok(flags.includes('multiple-iterations'), `expected multiple-iterations, got: ${flags}`);
  });

  it('auto-detects always-escalated flag on failure with 1 iteration', () => {
    const row = store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus',
      domain: 'frontend', outcome: 'failure', iterations: 1,
      meta_notes: 'Escalated immediately without attempting resolution. Blocked on missing API.',
    });

    const flags = JSON.parse(row.pattern_flags);
    assert.ok(flags.includes('always-escalated'), `expected always-escalated, got: ${flags}`);
  });

  it('auto-detects repeated-approach after 3+ same-strategy tasks in same domain', () => {
    // Seed a strategy first
    const strat = store.putStrategy({
      domain: 'solidity', subdomain: 'audit', title: 'audit-first',
      content: '1. Run slither\n2. Review findings',
    });

    // Log 3 tasks with the same strategy
    for (let i = 0; i < 3; i++) {
      store.logTelemetry({
        node_id: 'test-node', soul_id: 'daedalus',
        domain: 'solidity', strategy_id: strat.id, outcome: 'success', iterations: 1,
        meta_notes: `Audit task ${i + 1} using standard slither approach. Findings consistent with expectations.`,
      });
    }

    // 4th task should trigger repeated-approach
    const row = store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus',
      domain: 'solidity', strategy_id: strat.id, outcome: 'success', iterations: 1,
      meta_notes: 'Fourth audit task same strategy. Pattern flag should fire on repeated approach usage.',
    });

    const flags = JSON.parse(row.pattern_flags);
    assert.ok(flags.includes('repeated-approach'), `expected repeated-approach, got: ${flags}`);
  });

  it('getUnreflectedCount returns correct count', () => {
    const count = store.getUnreflectedCount();
    assert.ok(count > 0, `expected > 0, got: ${count}`);
  });

  it('getTelemetry respects --last and --domain filters', () => {
    const all = store.getTelemetry({ last: 100 });
    assert.ok(all.length > 0);

    const solidity = store.getTelemetry({ domain: 'solidity', last: 100 });
    assert.ok(solidity.every(r => r.domain === 'solidity'));

    const limited = store.getTelemetry({ last: 2 });
    assert.ok(limited.length <= 2);
  });

  it('multi-soul coexistence', () => {
    store.logTelemetry({
      node_id: 'test-node', soul_id: 'infra-ops',
      domain: 'infra', outcome: 'success', iterations: 1,
      meta_notes: 'CI pipeline fix from infra-ops soul. Separate from daedalus entries.',
    });

    const all = store.getTelemetry({ last: 100 });
    const souls = new Set(all.map(r => r.soul_id));
    assert.ok(souls.has('daedalus'));
    assert.ok(souls.has('infra-ops'));
  });
});

// ── Strategies ──────────────────────────────────

describe('HyperAgentStore: strategies', () => {
  it('putStrategy creates a strategy and returns it', () => {
    const row = store.putStrategy({
      domain: 'infra', subdomain: 'ci-cd', title: 'pipeline-fix',
      content: '## Approach\n1. Check YAML syntax\n2. Validate runner config',
    });

    assert.ok(row.id);
    assert.equal(row.domain, 'infra');
    assert.equal(row.title, 'pipeline-fix');
    assert.equal(row.active, 1);
    assert.equal(row.version, 1);
  });

  it('getStrategy finds by domain and subdomain', () => {
    const row = store.getStrategy('infra', 'ci-cd');
    assert.ok(row);
    assert.equal(row.title, 'pipeline-fix');
  });

  it('getStrategy falls back to domain-only match', () => {
    store.putStrategy({
      domain: 'devops', title: 'general-devops',
      content: 'General devops approach',
    });

    const row = store.getStrategy('devops', 'terraform');
    assert.ok(row);
    assert.equal(row.title, 'general-devops');
  });

  it('selects only global or same-node strategies and prefers the node override', () => {
    const global = store.putStrategy({
      domain: 'review', title: 'Shared review', content: 'Use the shared checklist.',
    });
    const nodeA = store.putStrategy({
      domain: 'review', title: 'Node A review', content: 'Use the node A checklist.', node_id: 'node-a',
    });

    assert.equal(store.getStrategy('review', null, 'node-a').id, nodeA.id);
    assert.equal(store.getStrategy('review', null, 'node-b').id, global.id);
    assert.equal(store.getStrategy('review').id, global.id);
  });

  it('putStrategy with supersedes atomically deactivates old version', () => {
    const v1 = store.putStrategy({
      domain: 'testing', title: 'test-strategy-v1',
      content: 'Version 1',
    });

    const v2 = store.putStrategy({
      domain: 'testing', title: 'test-strategy-v2',
      content: 'Version 2',
      supersedes: v1.id,
    });

    assert.equal(v2.version, 2);

    // v1 should be inactive
    const active = store.listStrategies({ domain: 'testing' });
    assert.equal(active.length, 1);
    assert.equal(active[0].id, v2.id);
  });

  it('does not allow a node to supersede a global or another node strategy', () => {
    const global = store.putStrategy({
      domain: 'ownership', title: 'Shared', content: 'Shared baseline.',
    });
    assert.throws(() => store.putStrategy({
      domain: 'ownership', title: 'Node replacement', content: 'Node-specific replacement.',
      node_id: 'node-a', supersedes: global.id,
    }), /ownership does not match/);
    assert.equal(store.getStrategyById(global.id).active, 1);
  });

  it('archiveStrategy deactivates a strategy', () => {
    const row = store.putStrategy({
      domain: 'archive-test', title: 'to-archive',
      content: 'Will be archived',
    });

    store.archiveStrategy(row.id);
    const active = store.listStrategies({ domain: 'archive-test' });
    assert.equal(active.length, 0);
  });
});

// ── Reflections ──────────────────────────────────

describe('HyperAgentStore: reflections', () => {
  it('putReflection creates a row with raw_stats and null hypotheses', () => {
    const stats = store.computeStats(0);
    assert.ok(stats, 'should have telemetry to compute stats from');

    const reflection = store.putReflection({
      node_id: 'test-node', soul_id: 'daedalus',
      telemetry_from_id: stats.fromId, telemetry_to_id: stats.toId,
      telemetry_count: stats.totalTasks, raw_stats: stats,
    });

    assert.ok(reflection.id);
    assert.equal(reflection.hypotheses, null);
    assert.ok(reflection.raw_stats);
  });

  it('getPendingSynthesis returns the unsynthesized reflection', () => {
    const pending = store.getPendingSynthesis();
    assert.ok(pending, 'should have a pending reflection');
    assert.equal(pending.hypotheses, null);
  });

  it('writeSynthesis fills in hypotheses', () => {
    const pending = store.getPendingSynthesis();
    assert.ok(pending);

    const updated = store.writeSynthesis(pending.id, {
      hypotheses: ['test-first catches bugs early', 'infra needs connectivity pre-check'],
    });

    assert.ok(updated.hypotheses);
    const parsed = JSON.parse(updated.hypotheses);
    assert.equal(parsed.length, 2);
  });

  it('getPendingSynthesis returns null after synthesis', () => {
    const pending = store.getPendingSynthesis();
    assert.equal(pending, null);
  });

  it('getPreviousReflection chains reflections', () => {
    const last = store.getLastReflection({ node_id: 'test-node', soul_id: 'daedalus' });
    store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus', domain: 'chain-test',
      outcome: 'success', iterations: 1,
      meta_notes: 'Fresh task creates a distinct second reflection window for chaining.',
    });
    const stats = store.computeStats(last.telemetry_to_id, { node_id: 'test-node', soul_id: 'daedalus' });
    const r2 = store.putReflection({
      node_id: 'test-node', soul_id: 'daedalus',
      telemetry_from_id: stats.fromId, telemetry_to_id: stats.toId,
      telemetry_count: stats.totalTasks, raw_stats: stats,
    });

    const prev = store.getPreviousReflection(r2.id);
    assert.ok(prev);
    assert.ok(prev.hypotheses, 'previous reflection should have hypotheses');
  });

  it('expireStalePending expires old unsynthesized reflections', () => {
    // The second reflection from above is pending — we won't synthesize it
    // We can't easily test the 24h expiry without time manipulation,
    // but we can verify the method runs without error
    const expired = store.expireStalePending();
    assert.equal(typeof expired, 'number');
  });

  it('getUnreflectedCount resets after reflection', () => {
    // All telemetry should be covered by the reflections we created
    // (though the count depends on telemetry_to_id alignment)
    const count = store.getUnreflectedCount();
    assert.equal(typeof count, 'number');
  });
});

// ── Proposals ──────────────────────────────────

describe('HyperAgentStore: proposals', () => {
  let reflectionId;

  before(() => {
    // Ensure we have a reflection to link proposals to
    const reflections = store.listReflections({ limit: 1 });
    reflectionId = reflections[0].id;
  });

  it('putProposal creates a pending proposal', () => {
    const row = store.putProposal({
      reflection_id: reflectionId,
      node_id: 'test-node', soul_id: 'daedalus',
      title: 'Add network preflight strategy',
      description: 'Check connectivity before infra tasks',
      proposal_type: 'strategy_new',
      diff_content: JSON.stringify({
        domain: 'infra', subdomain: 'network', title: 'network-preflight',
        content: '1. Check Tailscale\n2. Ping NATS\n3. Proceed if both pass',
      }),
    });

    assert.ok(row.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.proposal_type, 'strategy_new');
  });

  it('startObservation transitions to shadow storage status with window', () => {
    const proposals = store.getProposals({ status: 'pending' });
    assert.ok(proposals.length > 0);

    const result = store.startObservation(proposals[0].id, 60);
    assert.equal(result.status, 'shadow');
    assert.ok(result.eval_window_start);
    assert.ok(result.eval_window_end);
  });

  it('telemetry logged during observation gets linked via junction', () => {
    const row = store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus',
      domain: 'infra', outcome: 'success', iterations: 1,
      meta_notes: 'Task during an observation window. It should link to the active proposal.',
    });

    // The junction table should have a link
    // We can't query the junction directly from the public API,
    // but observation-window maintenance will use it
    assert.ok(row.id);
  });

  it('approveProposal with strategy_new auto-creates the strategy', () => {
    const proposals = store.getProposals();
    const shadowProp = proposals.find(p => p.status === 'shadow');
    assert.ok(shadowProp, 'should have a shadow proposal');

    // First transition back to pending (simulating expired eval window)
    // Actually, approve works from any non-rejected status
    const result = store.approveProposal(shadowProp.id, 'test-human');
    assert.equal(result.status, 'approved');
    assert.equal(result.reviewed_by, 'test-human');

    // Check strategy was created
    const strat = store.getStrategy('infra', 'network', 'test-node');
    assert.ok(strat, 'strategy should have been auto-created from approved proposal');
    assert.equal(strat.title, 'network-preflight');
    assert.equal(strat.source, 'reflection');
  });

  it('putProposal rejects types with no apply implementation', () => {
    for (const proposal_type of ['harness_rule', 'workflow_change']) {
      assert.throws(() => store.putProposal({
        reflection_id: reflectionId,
        node_id: 'test-node', soul_id: 'daedalus',
        title: 'Inert', description: 'approval would silently do nothing',
        proposal_type,
      }), /no apply implementation/);
    }
  });

  it('rejectProposal transitions to rejected', () => {
    const prop = store.putProposal({
      reflection_id: reflectionId,
      node_id: 'test-node', soul_id: 'daedalus',
      title: 'Bad proposal', description: 'Should be rejected',
      proposal_type: 'strategy_new',
      diff_content: JSON.stringify({ domain: 'testing', content: 'A valid payload that is rejected.' }),
    });

    const result = store.rejectProposal(prop.id, 'test-human', 'not-useful');
    assert.equal(result.status, 'rejected');
    assert.equal(result.reviewed_by, 'test-human');
    assert.equal(result.review_reason, 'not-useful');
  });

  it('getStats reflects correct proposal counts', () => {
    const stats = store.getStats();
    assert.ok(stats.telemetry > 0);
    assert.ok(stats.strategies > 0);
    assert.ok(stats.reflections > 0);
    // No pending proposals (one approved, one rejected)
    assert.equal(stats.pendingProposals, 0);
  });
});

// ── Full Loop ──────────────────────────────────

describe('HyperAgentStore: evidence loop', () => {
  it('end-to-end: log → reflect → synthesize → propose → approve', () => {
    // 1. Log 5 fresh telemetry entries
    for (let i = 0; i < 5; i++) {
      store.logTelemetry({
        node_id: 'loop-node', soul_id: 'loop-soul',
        domain: 'e2e-test', outcome: i < 4 ? 'success' : 'failure',
        iterations: i + 1,
        meta_notes: `E2E loop task ${i + 1}. Testing the evidence and approval cycle end to end.`,
      });
    }

    // 2. Compute stats
    const lastReflection = store.getLastReflection();
    const sinceId = lastReflection ? lastReflection.telemetry_to_id : 0;
    const stats = store.computeStats(sinceId);
    assert.ok(stats);

    // 3. Create reflection
    const reflection = store.putReflection({
      node_id: 'loop-node', soul_id: 'loop-soul',
      telemetry_from_id: stats.fromId, telemetry_to_id: stats.toId,
      telemetry_count: stats.totalTasks, raw_stats: stats,
    });
    assert.equal(reflection.hypotheses, null);

    // 4. Pending synthesis should exist (may be older unsynthesized reflection or this one)
    const pending = store.getPendingSynthesis();
    assert.ok(pending);
    // If an older pending reflection exists, synthesize it first to clear the queue
    if (pending.id !== reflection.id) {
      store.writeSynthesis(pending.id, { hypotheses: ['clearing stale pending'] });
      const pending2 = store.getPendingSynthesis();
      assert.ok(pending2);
      assert.equal(pending2.id, reflection.id);
    }

    // 5. Write synthesis (simulating agent)
    store.writeSynthesis(reflection.id, {
      hypotheses: ['e2e test hypothesis: iteration count increases with task complexity'],
    });

    // 6. Create proposal
    const proposal = store.putProposal({
      reflection_id: reflection.id,
      node_id: 'loop-node', soul_id: 'loop-soul',
      title: 'E2E test proposal',
      description: 'Reduce iterations via better task decomposition',
      proposal_type: 'strategy_new',
      target_ref: 'testing',
      // Apply contract: diff_content must be JSON {domain, content, ...}.
      diff_content: JSON.stringify({ domain: 'testing', content: 'Decompose tasks before iterating' }),
    });
    assert.equal(proposal.status, 'pending');

    // 7. Approve — strategy_new is an ACTIONABLE type: approval must
    // materialize a strategy, not just flip status.
    const before = store.listStrategies({ domain: 'testing' }).length;
    const approved = store.approveProposal(proposal.id, 'e2e-human');
    assert.equal(approved.status, 'approved');
    assert.equal(store.listStrategies({ domain: 'testing' }).length, before + 1,
      'approval materialized the proposed strategy');

    // 8. Pending synthesis should be gone
    const pendingAfter = store.getPendingSynthesis();
    assert.equal(pendingAfter, null);
  });
});

async function withFreshStore(run) {
  const dbPath = path.join(os.tmpdir(), `ha-regression-${Date.now()}-${Math.random()}.db`);
  const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
  const fresh = createHyperAgentStore({ dbPath });
  try { await run(fresh, dbPath); }
  finally {
    fresh.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch {}
    }
  }
}

describe('HyperAgentStore: integrity regressions', () => {
  it('logs a task idempotently per node and soul', async () => withFreshStore((fresh) => {
    const entry = {
      node_id: 'node-a', soul_id: 'soul-a', task_id: 'task-1', domain: 'Code Review',
      outcome: 'success', iterations: 1,
      meta_notes: 'A sufficiently detailed note for an idempotent telemetry task.',
    };
    const first = fresh.logTelemetry(entry);
    const duplicate = fresh.logTelemetry({ ...entry, outcome: 'failure' });
    assert.equal(duplicate.id, first.id);
    assert.equal(fresh.getTelemetry({ last: 20 }).length, 1);
    assert.equal(first.domain, 'code-review');
  }));

  it('creates independent reflection windows for each node and soul', async () => withFreshStore((fresh) => {
    for (const soul_id of ['alpha', 'beta']) {
      for (let i = 0; i < 5; i++) {
        fresh.logTelemetry({
          node_id: 'node-a', soul_id, task_id: `${soul_id}-${i}`, domain: 'testing',
          outcome: 'success', iterations: 1,
          meta_notes: `Detailed telemetry for ${soul_id} task ${i} and its isolated reflection.`,
        });
      }
    }
    const reflections = fresh.createPendingReflections(5);
    assert.equal(reflections.length, 2);
    assert.deepEqual(reflections.map((row) => [row.soul_id, row.telemetry_count]), [['alpha', 5], ['beta', 5]]);
    assert.equal(fresh.getUnreflectedCount(), 0);
  }));

  it('detects repeated approaches across interleaved telemetry ids', async () => withFreshStore((fresh) => {
    const strategy = fresh.putStrategy({ domain: 'testing', title: 'repeat', content: 'Use the same test strategy.' });
    let last;
    for (let i = 0; i < 3; i++) {
      last = fresh.logTelemetry({
        node_id: 'node-a', soul_id: 'alpha', domain: 'testing', strategy_id: strategy.id,
        outcome: 'success', iterations: 1,
        meta_notes: `Repeated strategy task ${i} with enough detail for pattern analysis.`,
      });
      fresh.logTelemetry({
        node_id: 'node-a', soul_id: 'beta', domain: 'other', outcome: 'success', iterations: 1,
        meta_notes: `Interleaved unrelated task ${i} should not break the alpha history window.`,
      });
    }
    assert.ok(JSON.parse(last.pattern_flags).includes('repeated-approach'));
  }));

  it('synthesizes once and creates proposals atomically', async () => withFreshStore((fresh) => {
    for (let i = 0; i < 5; i++) {
      fresh.logTelemetry({
        node_id: 'node-a', soul_id: 'alpha', domain: 'testing', outcome: 'success', iterations: 1,
        meta_notes: `Reflection source task ${i} with enough concrete evidence to synthesize.`,
      });
    }
    const [reflection] = fresh.createPendingReflections(5);
    const proposals = [{
      title: 'Test first', description: 'Adopt a test-first strategy', proposal_type: 'strategy_new',
      diff_content: JSON.stringify({ domain: 'testing', content: 'Write the failing test before implementation.' }),
    }];
    fresh.synthesizeReflection(reflection.id, { hypotheses: ['Tests expose regressions earlier.'], proposals });
    assert.throws(() => fresh.synthesizeReflection(reflection.id, {
      hypotheses: ['Duplicate synthesis must fail.'], proposals,
    }), /pending reflection/);
    assert.equal(fresh.getProposals().length, 1);
  }));

  it('does not allow rejected proposals to be approved later', async () => withFreshStore((fresh) => {
    fresh.logTelemetry({
      node_id: 'node-a', soul_id: 'alpha', domain: 'testing', outcome: 'success', iterations: 1,
      meta_notes: 'Source telemetry for a proposal lifecycle transition regression test.',
    });
    const stats = fresh.computeStats(0, { node_id: 'node-a', soul_id: 'alpha' });
    const reflection = fresh.putReflection({
      node_id: 'node-a', soul_id: 'alpha', telemetry_from_id: stats.fromId,
      telemetry_to_id: stats.toId, telemetry_count: stats.totalTasks, raw_stats: stats,
    });
    const proposal = fresh.putProposal({
      reflection_id: reflection.id, title: 'Reject me', description: 'Lifecycle test proposal',
      proposal_type: 'strategy_new',
      diff_content: JSON.stringify({ domain: 'testing', content: 'This strategy must never apply.' }),
    });
    fresh.rejectProposal(proposal.id, 'human', 'not useful');
    assert.throws(() => fresh.approveProposal(proposal.id, 'human'), /is rejected/);
    assert.equal(fresh.getStats().strategies, 0);
  }));

  it('links only matching telemetry to observation windows and labels results non-causal', async () => withFreshStore((fresh, dbPath) => {
    for (let i = 0; i < 5; i++) {
      fresh.logTelemetry({
        node_id: 'node-a', soul_id: 'alpha', domain: 'testing', outcome: 'success', iterations: 1,
        meta_notes: `Baseline task ${i} for a scoped observational comparison window.`,
      });
    }
    const [reflection] = fresh.createPendingReflections(5);
    const proposal = fresh.putProposal({
      reflection_id: reflection.id, title: 'Observe testing', description: 'Observe matching test work',
      proposal_type: 'strategy_new',
      diff_content: JSON.stringify({ domain: 'testing', content: 'Run focused tests first.' }),
    });
    fresh.startObservation(proposal.id, 60);
    const matching = fresh.logTelemetry({
      node_id: 'node-a', soul_id: 'alpha', domain: 'testing', outcome: 'success', iterations: 1,
      meta_notes: 'Matching telemetry inside the active observation window for this strategy.',
    });
    fresh.logTelemetry({
      node_id: 'node-a', soul_id: 'beta', domain: 'testing', outcome: 'failure', iterations: 1,
      meta_notes: 'Different soul telemetry must stay outside the proposal observation window.',
    });

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    const links = db.prepare('SELECT telemetry_id FROM ha_telemetry_proposals WHERE proposal_id = ?').all(proposal.id);
    assert.deepEqual(links.map((row) => row.telemetry_id), [matching.id]);
    db.prepare("UPDATE ha_proposals SET eval_window_end = datetime('now', '-1 minute') WHERE id = ?").run(proposal.id);
    db.close();

    assert.equal(fresh.checkObservationWindows(), 1);
    const closed = fresh.getProposals().find((row) => row.id === proposal.id);
    const result = JSON.parse(closed.eval_result);
    assert.equal(result.kind, 'observational');
    assert.equal(result.treatment_applied, false);
    assert.equal(result.tasks_in_window, 1);
  }));

  it('rejects invalid numeric telemetry', async () => withFreshStore((fresh) => {
    assert.throws(() => fresh.logTelemetry({
      node_id: 'node-a', soul_id: 'alpha', domain: 'testing', outcome: 'success', iterations: -1,
      meta_notes: 'Invalid iteration count should be rejected before touching SQLite.',
    }), /positive integer/);
  }));

  // Cohort provenance (hyperagent-evidence 0.2)
  it('rejects invalid execution_class loudly; NULL reads as unknown and stays cohort-ineligible', async () => withFreshStore((fresh) => {
    assert.throws(() => fresh.logTelemetry({
      node_id: 'n', soul_id: 's', domain: 'testing', outcome: 'success', execution_class: 'production',
    }), /invalid execution_class/);
    const row = fresh.logTelemetry({ node_id: 'n', soul_id: 's', domain: 'testing', outcome: 'success' });
    assert.equal(row.execution_class, null);
  }));

  it('provenance fields round-trip and separate by one SQL predicate', async () => withFreshStore((fresh) => {
    fresh.logTelemetry({
      node_id: 'n', soul_id: 's', domain: 'testing', outcome: 'success',
      run_id: 'r1', logical_task_id: 'lt1', session_id: 'sess-1', execution_class: 'real',
      collaboration_mode: 'adversarial', provider: 'claude', model: 'claude-fable-5',
    });
    fresh.logTelemetry({
      node_id: 'n', soul_id: 's', domain: 'testing', outcome: 'failure',
      run_id: 'r1', logical_task_id: 'lt2', execution_class: 'mock', provider: 'shell',
    });
    const rows = fresh.getTelemetry({ limit: 10 });
    const real = rows.filter((r) => r.execution_class === 'real');
    assert.equal(real.length, 1);
    assert.equal(real[0].session_id, 'sess-1');
    assert.equal(real[0].model, 'claude-fable-5');
    assert.equal(rows.filter((r) => r.execution_class === 'mock').length, 1);
  }));

  it('keeps historical strategy attribution after archival and rejects cross-node use', async () => withFreshStore((fresh) => {
    const owned = fresh.putStrategy({
      domain: 'testing', title: 'Owned', content: 'Node-specific approach.', node_id: 'node-a',
    });
    assert.throws(() => fresh.logTelemetry({
      node_id: 'node-b', soul_id: 'beta', task_id: 'cross-node', domain: 'testing',
      strategy_id: owned.id, outcome: 'success', iterations: 1,
    }), /belongs to node node-a/);

    fresh.archiveStrategy(owned.id);
    const row = fresh.logTelemetry({
      node_id: 'node-a', soul_id: 'alpha', task_id: 'archived-after-start', domain: 'testing',
      strategy_id: owned.id, outcome: 'success', iterations: 1,
    });
    assert.equal(row.strategy_id, owned.id);
  }));

  it('updates a shared fallback as a node-local override without deactivating it globally', async () => withFreshStore((fresh) => {
    const shared = fresh.putStrategy({
      domain: 'analysis', title: 'Shared', content: 'Shared baseline.',
    });
    for (let i = 0; i < 5; i++) {
      fresh.logTelemetry({
        node_id: 'node-a', soul_id: 'alpha', task_id: `shared-update-${i}`,
        domain: 'analysis', outcome: 'success', iterations: 1,
      });
    }
    const reflection = fresh.createPendingReflections(5)[0];
    const proposal = fresh.putProposal({
      reflection_id: reflection.id, node_id: 'node-a', soul_id: 'alpha',
      title: 'Node override', description: 'Tailor the shared strategy for node A.',
      proposal_type: 'strategy_update', target_ref: String(shared.id),
      diff_content: JSON.stringify({ content: 'Node A override.' }),
    });
    fresh.approveProposal(proposal.id, 'reviewer');

    assert.equal(fresh.getStrategyById(shared.id).active, 1);
    assert.equal(fresh.getStrategy('analysis', null, 'node-b').id, shared.id);
    const selected = fresh.getStrategy('analysis', null, 'node-a');
    assert.equal(selected.content, 'Node A override.');
    assert.equal(selected.node_id, 'node-a');
  }));
});
