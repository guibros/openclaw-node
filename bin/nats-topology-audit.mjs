#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { observeNatsTopology, publicNatsTopologyEvidence } from '../lib/nats-topology-audit.mjs';

const { values } = parseArgs({ options: { expect: { type: 'string' }, 'public-evidence': { type: 'boolean' } } });
if (values.expect && !['three-member-cluster', 'standalone-plus-two'].includes(values.expect)) {
  throw new Error('expected topology must be three-member-cluster or standalone-plus-two');
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`monitor HTTP ${response.status}`);
  return response.json();
}

const observed = await observeNatsTopology(fetchJson);
const report = { observedAt: new Date().toISOString(),
  ...(values['public-evidence'] ? publicNatsTopologyEvidence(observed) : observed) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (values.expect && observed.classification !== values.expect) process.exitCode = 1;
