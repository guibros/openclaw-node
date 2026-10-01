import fs from 'node:fs';

export const PROTECTED_NATS_HANDOFF = '/private/var/db/openclaw-nats/writer-handoff.json';

export function assertLegacyNatsWriterAllowed(stateFile = PROTECTED_NATS_HANDOFF) {
  try {
    fs.lstatSync(stateFile);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error(`cannot verify protected NATS writer handoff at ${stateFile}: ${error.code || error.message}; legacy writer changes refused`);
  }
  throw new Error(`protected NATS writer handoff active at ${stateFile}; user-owned NATS config, auth, and launchd jobs must not be changed`);
}
