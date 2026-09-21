/**
 * fed-benchmark-pipeline.test.mjs — step 2.7: the collector learns pipeline's terminal shape
 * (PIPELINE_MODE_SPEC §6, step-28 RUN_RULES clause 7) and the grappe arm under test is pipeline
 * by default with the D14 arm still reproducible.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { grappeFinalArtifact, grappeCollabSpec } from '../bin/fed-benchmark.mjs';

const BIG = 'pipeline artifact body '.repeat(20); // > 400 chars
const pipe = (artifacts, degraded = [], outcome = 'completed') => ({
  mode: 'pipeline', status: 'completed',
  pipeline: { artifacts: { workArtifact: null, reviewArtifacts: {}, finalArtifact: null, ...artifacts }, degraded, outcome },
});

describe('grappeFinalArtifact — pipeline shapes', () => {
  it('a final artifact is the deliverable, not degraded', () => {
    const a = grappeFinalArtifact(pipe({ workArtifact: 'd', finalArtifact: BIG }));
    assert.equal(a.key, 'pipeline_finalArtifact');
    assert.equal(a.content, BIG.trim());
    assert.equal(a.degraded, false);
    assert.deepEqual(a.degraded_ledger, []);
  });

  it('a final artifact with a non-empty ledger is still collectable, flagged degraded, ledger carried (clause 7)', () => {
    const ledger = [{ pass: 2, node_id: 'rb', reason: 'timeout' }];
    const a = grappeFinalArtifact(pipe({ workArtifact: 'd', finalArtifact: BIG }, ledger));
    assert.equal(a.degraded, true);
    assert.deepEqual(a.degraded_ledger, ledger);
  });

  it('no final: the draft ships, degraded (T2 revise-absent)', () => {
    const a = grappeFinalArtifact(pipe({ workArtifact: BIG }));
    assert.equal(a.key, 'pipeline_workArtifact');
    assert.equal(a.degraded, true);
  });

  it('no artifact at all is the only non-delivery', () => {
    assert.throws(() => grappeFinalArtifact(pipe({}, [], 'failed')), /shipped no artifact \(outcome failed\)/);
  });

  it('the D14 ≥400-char floor carries over', () => {
    assert.throws(() => grappeFinalArtifact(pipe({ finalArtifact: 'too short' })), /degenerate \(9 chars/);
  });

  it('circling sessions are collected exactly as before (regression)', () => {
    const circ = (arts) => ({ mode: 'circling_strategy', status: 'completed', circling: { artifacts: arts } });
    const ok = grappeFinalArtifact(circ({ sr1_step0_worker_workArtifact: BIG, sr1_step0_worker_completionDiff: '[x] done' }));
    assert.equal(ok.key, 'sr1_step0_worker_workArtifact');
    assert.throws(() => grappeFinalArtifact(circ({ sr1_step0_worker_workArtifact: BIG })), /completionDiff .* missing/);
    assert.equal(grappeFinalArtifact(circ({})), null);
  });
});

describe('grappeCollabSpec — the arm under test', () => {
  it('defaults to pipeline, three passes (the D16 forward design)', () => {
    assert.deepEqual(grappeCollabSpec({}), { mode: 'pipeline', passes: 3 });
  });

  it('FED_GRAPPE_MODE=circling_strategy reproduces the D14 arm byte for byte', () => {
    assert.deepEqual(grappeCollabSpec({ FED_GRAPPE_MODE: 'circling_strategy' }), { mode: 'circling_strategy', max_subrounds: 1, automation_tier: 1 });
  });

  it('the RUN_RULES lock knobs flow through', () => {
    assert.deepEqual(
      grappeCollabSpec({ FED_PIPELINE_PASSES: '5', FED_PIPELINE_PASS_BUDGET_MS: '600000', FED_PIPELINE_MAX_COST_USD: '4.5' }),
      { mode: 'pipeline', passes: 5, pass_budget_ms: 600000, max_cost_usd: 4.5 },
    );
  });
});
