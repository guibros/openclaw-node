/**
 * operator-auth.test.mjs — signed operator actions + the authorization matrix.
 *
 * Covers the review's forgery paths directly: unsigned approve, a peer's
 * fabricated { success: true } completion, replayed and stale requests,
 * an untrusted signer, and the plan-subtask mass-assignment envelope.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getOrCreateIdentity, createSeenEventCache } from '../lib/node-identity.mjs';
import {
  signOperatorRequest,
  verifyOperatorRequest,
  trustedOperatorKeys,
  authorizeTaskMutation,
  stripOperatorEnvelope,
  OPERATOR_ENVELOPE_FIELDS,
} from '../lib/operator-auth.mjs';

let tmp, lead, peer;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-auth-'));
  lead = getOrCreateIdentity(path.join(tmp, 'lead'));
  peer = getOrCreateIdentity(path.join(tmp, 'peer'));
  delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
});

const leadKeys = () => [lead.publicKeyBase64];

describe('signOperatorRequest / verifyOperatorRequest', () => {
  it('round-trips a request signed by a trusted key', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead' });
    assert.equal(req.task_id, 'T-1');
    assert.equal(req.operator_action, true);
    assert.ok(req.event_id && req.timestamp && req.signature && req.signer_pubkey);
    const r = verifyOperatorRequest(req, { trustedKeys: leadKeys(), seenIds: null });
    assert.deepEqual(r, { ok: true, reason: 'verified' });
  });

  it('refuses an UNSIGNED request (the old one-message approve)', () => {
    const r = verifyOperatorRequest({ task_id: 'T-1' }, { trustedKeys: leadKeys(), seenIds: null });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing-signature');
  });

  it('refuses a request signed by a key outside the allowlist (a peer with the NATS token)', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: peer, nodeId: 'peer' });
    const r = verifyOperatorRequest(req, { trustedKeys: leadKeys(), seenIds: null });
    assert.deepEqual(r, { ok: false, reason: 'untrusted-signer' });
  });

  it('refuses a tampered payload (signature covers the whole request)', () => {
    const req = signOperatorRequest({ task_id: 'T-1', reason: 'ok' }, { identity: lead, nodeId: 'lead' });
    const tampered = { ...req, task_id: 'T-VICTIM' };
    const r = verifyOperatorRequest(tampered, { trustedKeys: leadKeys(), seenIds: null });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid-signature');
  });

  it('refuses a replay of the same event_id', () => {
    const seen = createSeenEventCache();
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead' });
    assert.equal(verifyOperatorRequest(req, { trustedKeys: leadKeys(), seenIds: seen }).ok, true);
    const again = verifyOperatorRequest(req, { trustedKeys: leadKeys(), seenIds: seen });
    assert.deepEqual(again, { ok: false, reason: 'replay' });
  });

  it('refuses a stale request (outside the 5-minute window)', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead', now: Date.now() - 10 * 60_000 });
    const r = verifyOperatorRequest(req, { trustedKeys: leadKeys(), seenIds: null });
    assert.equal(r.ok, false);
    assert.match(r.reason, /^freshness:too-old/);
  });

  it('fails CLOSED when no operator key is configured', () => {
    const req = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead' });
    const r = verifyOperatorRequest(req, { trustedKeys: [], seenIds: null });
    assert.deepEqual(r, { ok: false, reason: 'no-trusted-operator-keys-configured' });
  });

  it('strips a caller-supplied envelope before signing (no smuggled signer_pubkey)', () => {
    const req = signOperatorRequest(
      { task_id: 'T-1', signer_pubkey: 'forged', signature: 'forged', event_id: 'chosen' },
      { identity: lead, nodeId: 'lead' },
    );
    assert.notEqual(req.signer_pubkey, 'forged');
    assert.notEqual(req.event_id, 'chosen');
    assert.equal(verifyOperatorRequest(req, { trustedKeys: leadKeys(), seenIds: null }).ok, true);
  });
});

describe('trustedOperatorKeys', () => {
  it('prefers OPENCLAW_OPERATOR_TRUSTED_KEYS when set', () => {
    process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = ' k1 , k2 ,';
    assert.deepEqual(trustedOperatorKeys(), ['k1', 'k2']);
    delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
  });

  it('falls back to the local node identity (zero-config on the lead)', () => {
    const keys = trustedOperatorKeys({ identity: lead });
    assert.deepEqual(keys, [lead.publicKeyBase64]);
  });
});

describe('authorizeTaskMutation — the matrix', () => {
  const task = { task_id: 'T-1', owner: 'worker-a' };
  const verify = (p) => verifyOperatorRequest(p, { trustedKeys: leadKeys(), seenIds: null });

  it('owner may perform owner-allowed actions without a signature (start/complete/release)', () => {
    const d = authorizeTaskMutation({ action: 'complete', params: { task_id: 'T-1', node_id: 'worker-a' }, task, allowOwner: true, allowOperator: true, verify });
    assert.deepEqual(d, { ok: true, via: 'owner' });
  });

  it('a NON-owner with the bus token cannot complete another node\'s task (R5 forgery)', () => {
    const d = authorizeTaskMutation({ action: 'complete', params: { task_id: 'T-1', node_id: 'worker-b', result: { success: true } }, task, allowOwner: true, allowOperator: true, verify });
    assert.equal(d.ok, false);
    assert.match(d.reason, /not-owner\(worker-b!=worker-a\)/);
    assert.match(d.reason, /operator:missing-signature/);
  });

  it('a signed operator request may force-complete (Mission Control intervene)', () => {
    const params = signOperatorRequest({ task_id: 'T-1', result: { success: true, forced: true } }, { identity: lead, nodeId: 'lead' });
    const d = authorizeTaskMutation({ action: 'complete', params, task, allowOwner: true, allowOperator: true, verify });
    assert.deepEqual(d, { ok: true, via: 'operator' });
  });

  it('operator-only actions refuse the owner without a signature (no self-approval by ownership)', () => {
    const d = authorizeTaskMutation({ action: 'approve', params: { task_id: 'T-1', node_id: 'worker-a' }, task, allowOwner: false, allowOperator: true, verify });
    assert.equal(d.ok, false);
    assert.match(d.reason, /^approve: operator:missing-signature/);
  });

  it('owner-only actions refuse a signed operator request (nobody "starts" someone else\'s task)', () => {
    const params = signOperatorRequest({ task_id: 'T-1' }, { identity: lead, nodeId: 'lead' });
    const d = authorizeTaskMutation({ action: 'start', params, task, allowOwner: true, allowOperator: false, verify });
    assert.deepEqual(d, { ok: false, reason: 'start: not-owner' });
  });

  it('an unclaimed task has no owner to match', () => {
    const d = authorizeTaskMutation({ action: 'release', params: { task_id: 'T-1', node_id: 'worker-a' }, task: { task_id: 'T-1', owner: null }, allowOwner: true, allowOperator: true, verify });
    assert.equal(d.ok, false);
    assert.match(d.reason, /not-owner\(unclaimed\)/);
  });
});

describe('stripOperatorEnvelope — the plan-subtask mass-assignment sink', () => {
  it('removes every envelope field and keeps the payload', () => {
    const params = signOperatorRequest(
      { plan_id: 'P', subtask_id: 'S', status: 'completed', result: { x: 1 } },
      { identity: lead, nodeId: 'lead' },
    );
    const body = stripOperatorEnvelope(params);
    for (const f of OPERATOR_ENVELOPE_FIELDS) assert.equal(body[f], undefined, `${f} must be stripped`);
    assert.deepEqual(body, { plan_id: 'P', subtask_id: 'S', status: 'completed', result: { x: 1 } });
  });
});

describe('P4-5: lease fencing in the owner path', () => {
  const verify = () => ({ ok: false, reason: 'unsigned' });
  const task = { task_id: 'T-9', owner: 'worker-a', lease_token: 'tok-current' };

  it('owner with the current lease token is allowed', () => {
    const d = authorizeTaskMutation({ action: 'complete', params: { task_id: 'T-9', node_id: 'worker-a', lease_token: 'tok-current' }, task, allowOwner: true, allowOperator: true, verify });
    assert.deepEqual(d, { ok: true, via: 'owner' });
  });

  it('owner with a stale or missing token is refused (task was re-claimed since)', () => {
    for (const lease_token of ['tok-old', undefined]) {
      const d = authorizeTaskMutation({ action: 'complete', params: { task_id: 'T-9', node_id: 'worker-a', lease_token }, task, allowOwner: true, allowOperator: false, verify });
      assert.equal(d.ok, false);
      assert.match(d.reason, /stale lease/);
    }
  });

  it('a task claimed before leases existed is not fenced', () => {
    const d = authorizeTaskMutation({ action: 'complete', params: { task_id: 'T-9', node_id: 'worker-a' }, task: { task_id: 'T-9', owner: 'worker-a' }, allowOwner: true, allowOperator: false, verify });
    assert.equal(d.ok, true);
  });
});
