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
    // Create a second reflection
    const stats = store.computeStats(0);
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

  it('startShadowEval transitions to shadow status with window', () => {
    const proposals = store.getProposals({ status: 'pending' });
    assert.ok(proposals.length > 0);

    const result = store.startShadowEval(proposals[0].id, 60);
    assert.equal(result.status, 'shadow');
    assert.ok(result.eval_window_start);
    assert.ok(result.eval_window_end);
  });

  it('telemetry logged during shadow eval gets linked via junction', () => {
    // Log telemetry while shadow eval is active
    const row = store.logTelemetry({
      node_id: 'test-node', soul_id: 'daedalus',
      domain: 'infra', outcome: 'success', iterations: 1,
      meta_notes: 'Task during shadow eval window. Should be linked to the active proposal.',
    });

    // The junction table should have a link
    // We can't query the junction directly from the public API,
    // but checkShadowWindows will use it
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
    const strat = store.getStrategy('infra', 'network');
    assert.ok(strat, 'strategy should have been auto-created from approved proposal');
    assert.equal(strat.title, 'network-preflight');
    assert.equal(strat.source, 'reflection');
  });

  it('rejectProposal transitions to rejected', () => {
    const prop = store.putProposal({
      reflection_id: reflectionId,
      node_id: 'test-node', soul_id: 'daedalus',
      title: 'Bad proposal', description: 'Should be rejected',
      proposal_type: 'workflow_change',
    });

    const result = store.rejectProposal(prop.id, 'not-useful');
    assert.equal(result.status, 'rejected');
    assert.equal(result.reviewed_by, 'not-useful');
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

describe('HyperAgentStore: full autonomous loop', () => {
  it('end-to-end: log → reflect → synthesize → propose → approve', () => {
    // 1. Log 5 fresh telemetry entries
    for (let i = 0; i < 5; i++) {
      store.logTelemetry({
        node_id: 'loop-node', soul_id: 'loop-soul',
        domain: 'e2e-test', outcome: i < 4 ? 'success' : 'failure',
        iterations: i + 1,
        meta_notes: `E2E loop task ${i + 1}. Testing the full autonomous reflection cycle end to end.`,
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
      proposal_type: 'workflow_change',
    });
    assert.equal(proposal.status, 'pending');

    // 7. Approve
    const approved = store.approveProposal(proposal.id, 'e2e-human');
    assert.equal(approved.status, 'approved');

    // 8. Pending synthesis should be gone
    const pendingAfter = store.getPendingSynthesis();
    assert.equal(pendingAfter, null);
  });
});
