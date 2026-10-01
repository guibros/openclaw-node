export const SITE_ROOT = '/private/var/db/openclaw-nats';
export const HANDOFF_MARKER = `${SITE_ROOT}/writer-handoff.json`;

export function parseDiskutilInfo(text) {
  return {
    apfs: /^\s*File System Personality:\s*APFS\s*$/m.test(text),
    ownersEnabled: /^\s*Owners:\s*Enabled\s*$/m.test(text),
  };
}

export function evaluateProtectedSite({ account, operatorUid, parent, root, marker, volume }) {
  const accountOk = Number.isInteger(account?.uid) && account.uid > 0
    && account.uid !== operatorUid && Number.isInteger(account?.gid);
  const parentOk = Boolean(parent?.isDirectory && parent.uid === 0 && parent.gid === 0
    && (parent.mode & 0o022) === 0);
  const rootOk = Boolean(root?.isDirectory && root.uid === 0 && root.gid === 0
    && (root.mode & 0o777) === 0o755);
  const checks = [
    { id: 'service-account', ok: accountOk,
      detail: account?.uid == null ? '_openclaw_nats is absent'
        : account.uid === operatorUid ? '_openclaw_nats shares the operator UID'
          : `uid=${account.uid} gid=${account.gid}` },
    { id: 'ownership-volume', ok: volume?.apfs === true && volume?.ownersEnabled === true,
      detail: volume?.apfs && volume?.ownersEnabled ? 'APFS with ownership enabled' : 'APFS ownership not verified' },
    { id: 'protected-parent', ok: parentOk,
      detail: parentOk ? 'root:wheel without group/world write' : parent ? 'parent identity or mode invalid' : 'parent absent or unobservable' },
    { id: 'protected-root', ok: rootOk,
      detail: rootOk ? 'root:wheel 0755' : root ? 'protected root identity or mode invalid' : 'protected root not staged' },
    { id: 'handoff-marker', ok: marker === 'absent', detail: marker === 'absent'
      ? 'unpublished' : marker === 'present' ? 'already published; use the root recovery journal' : 'marker state unobservable' },
  ];
  return { readyForStaging: checks.every((check) => check.ok), checks };
}
