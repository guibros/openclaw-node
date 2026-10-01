#!/usr/bin/env node
import { assertLegacyNatsWriterAllowed } from '../lib/nats-writer-ownership.mjs';

try {
  assertLegacyNatsWriterAllowed();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
