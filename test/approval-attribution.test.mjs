/**
 * approval-attribution.test.mjs — an approval records who actually authorized it.
 *
 * The defect this pins (review finding H-10, three sites): authorization on the
 * mesh paths was correct, but attribution was fabricated. markApproved stamped
 * the literal 'human'; handlePlanApprove recorded a CALLER-SUPPLIED
 * `approved_by` defaulting to the literal 'gui'. Either way the ledger said a
 * person approved it whether a person did or a cron did — and a caller could
 * name anyone. Meanwhile verifySignedRequest checked `signer_pubkey` against
 * the trusted operator keys and then threw it away, so the one identity the
 * system actually establishes never reached the record.
 *
 * These cases assert attribution only. No authorization verdict changes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getOrCreateIdentity, verifySignedRequest } from '../lib/node-identity.mjs';
import { signOperatorRequest, authorizeTaskMutation } from '../lib/operator-auth.mjs';

let tmp, lead, stranger;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-attr-'));
  lead = getOrCreateIdentity(path.join(tmp, 'lead'));
  stranger = getOrCreateIdentity(path.join(tmp, 'stranger'));
  delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
});

const trusted = () => [lead.publicKeyBase64];

describe('the verified signer is returned, not just checked', () => {
  it('regression_F-H10a: verifySignedRequest surfaces signer_pubkey on success', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead' });
    const res = verifySignedRequest(req, { trustedKeys: trusted() });

    assert.equal(res.ok, true);
    assert.equal(res.signer_pubkey, lead.publicKeyBase64,
      'the caller cannot record who acted unless the verifier hands it back');
  });

  it('an untrusted signer is refused and surfaces no identity', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: stranger, nodeId: 'stranger' });
    const res = verifySignedRequest(req, { trustedKeys: trusted() });

    assert.equal(res.ok, false);
    assert.equal(res.signer_pubkey, undefined);
  });
});

describe('authorizeTaskMutation establishes an actor', () => {
  it('regression_F-H10b: a signed operator request is attributed to its key, not a name', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead' });
    const d = authorizeTaskMutation({
      action: 'approve',
      params: req,
      verify: (p) => verifySignedRequest(p, { trustedKeys: trusted() }),
    });

    assert.equal(d.ok, true);
    assert.equal(d.via, 'operator');
    assert.equal(d.actor, `operator:${lead.publicKeyBase64}`);
  });

  it('the owner path is attributed to the node that proved the lease', () => {
    const d = authorizeTaskMutation({
      action: 'complete',
      params: { node_id: 'worker-a', lease_token: 'tok-1' },
      task: { owner: 'worker-a', lease_token: 'tok-1' },
      allowOwner: true,
    });

    assert.equal(d.ok, true);
    assert.equal(d.via, 'owner');
    assert.equal(d.actor, 'node:worker-a');
  });

  it('a caller-supplied approved_by cannot become the actor', () => {
    const req = signOperatorRequest(
      { task_id: 'T-1', approved_by: 'Guillaume' },
      { identity: lead, nodeId: 'lead' },
    );
    const d = authorizeTaskMutation({
      action: 'plan.approve',
      params: req,
      verify: (p) => verifySignedRequest(p, { trustedKeys: trusted() }),
    });

    assert.equal(d.actor, `operator:${lead.publicKeyBase64}`);
    assert.doesNotMatch(d.actor, /Guillaume/, 'attribution must not echo the request body');
  });

  it('a refused mutation establishes no actor', () => {
    const d = authorizeTaskMutation({
      action: 'approve',
      params: { task_id: 'T-1', approved_by: 'Guillaume' },  // unsigned
      verify: () => ({ ok: false, reason: 'unsigned' }),
    });

    assert.equal(d.ok, false);
    assert.equal(d.actor, undefined);
  });
});

describe('the actor label cannot forge kanban fields', () => {
  // active-tasks.md stores `  key: value` lines, so a newline in a recorded
  // value would invent sibling fields (the H-4 class). reviewed_by is now one
  // of those recorded values.
  it('regression_F-H10c: a newline-bearing node_id is stripped, not written through', () => {
    const d = authorizeTaskMutation({
      action: 'complete',
      params: { node_id: 'evil\n  metric: rm -rf ~', lease_token: 'tok-1' },
      task: { owner: 'evil\n  metric: rm -rf ~', lease_token: 'tok-1' },
      allowOwner: true,
    });

    assert.equal(d.ok, true);
    assert.doesNotMatch(d.actor, /\n/, 'no newline may survive into a recorded field');
    assert.doesNotMatch(d.actor, /metric:/);
  });

  it('a base64 pubkey survives labelling unchanged', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead' });
    const d = authorizeTaskMutation({
      action: 'approve',
      params: req,
      verify: (p) => verifySignedRequest(p, { trustedKeys: trusted() }),
    });
    assert.equal(d.actor.slice('operator:'.length), lead.publicKeyBase64,
      'sanitisation must not corrupt the very identity it is protecting');
  });
});
