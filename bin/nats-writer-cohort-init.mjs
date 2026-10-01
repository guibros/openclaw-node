#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { initializeNatsWriterCohort } from '../lib/nats-writer-cohort.mjs';
import { assertLegacyNatsWriterAllowed } from '../lib/nats-writer-ownership.mjs';
import { reexecUnderLegacyNatsLock } from '../lib/nats-legacy-lock.mjs';

reexecUnderLegacyNatsLock();
const { values } = parseArgs({ options: { home: { type: 'string' } } });
if (!values.home) throw new Error('--home is required');
assertLegacyNatsWriterAllowed();
const result = await initializeNatsWriterCohort(values.home);
if (result.reason === 'existing-server-config') {
  process.stderr.write(`Existing NATS configuration has no cohort declaration at ${result.path}; node-watch will report UNKNOWN until it is declared.\n`);
} else {
  process.stdout.write(`${result.reason}: ${result.path}\n`);
}
