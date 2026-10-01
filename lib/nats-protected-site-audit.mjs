import { dirname } from 'node:path';
import { PROTECTED_NATS_HANDOFF } from './nats-writer-ownership.mjs';

export const SITE_ROOT = dirname(PROTECTED_NATS_HANDOFF);
export const HANDOFF_MARKER = PROTECTED_NATS_HANDOFF;

export function parseDiskutilInfo(text) {
  return {
    apfs: /^\s*File System Personality:\s*APFS\s*$/m.test(text),
    ownersEnabled: /^\s*Owners:\s*Enabled\s*$/m.test(text),
  };
}

export function evaluateProtectedSite({ account, operatorUid, ancestors, root, marker, volume }) {
  const accountOk = Number.isInteger(operatorUid) && operatorUid > 0
    && Number.isInteger(account?.uid) && account.uid > 0 && account.uid < 500
    && account.uid !== operatorUid && Number.isInteger(account?.gid) && account.gid > 0
    && account.recordUid === account.uid && account.recordGid === account.gid
    && account.groupRecordGid === account.gid
    && account.groupName === '_openclaw_nats' && account.shell === '/usr/bin/false'
    && ['/var/empty', '/private/var/empty'].includes(account.home)
    && account.adminMember === false && Array.isArray(account.groups)
    && account.groups.includes(account.gid)
    && !account.groups.some((group) => [0, 20, 80].includes(group));
  const parentOk = Array.isArray(ancestors) && ancestors.length === 3
    && ancestors.every((parent) => parent?.isDirectory && parent.uid === 0 && parent.gid === 0
      && (parent.mode & 0o022) === 0 && parent.aclEntries === false
      && parent.device === ancestors[2]?.device);
  const rootOk = Boolean(root?.isDirectory && root.uid === 0 && root.gid === 0
    && (root.mode & 0o777) === 0o755 && root.aclEntries === false
    && root.device === ancestors?.[2]?.device);
  const checks = [
    { id: 'service-account', ok: accountOk,
      detail: account?.uid == null ? '_openclaw_nats is absent'
        : accountOk ? `dedicated uid=${account.uid} gid=${account.gid}`
          : '_openclaw_nats is not a dedicated, non-admin system account' },
    { id: 'ownership-volume', ok: volume?.apfs === true && volume?.ownersEnabled === true,
      detail: volume?.apfs && volume?.ownersEnabled ? 'APFS with ownership enabled' : 'APFS ownership not verified' },
    { id: 'protected-parent', ok: parentOk,
      detail: parentOk ? 'root:wheel, one device, no writable ancestor or ACL' : 'ancestor identity, mode, ACL or device invalid' },
    { id: 'protected-root', ok: rootOk,
      detail: rootOk ? 'root:wheel 0755, no ACL, on parent device' : root ? 'protected root identity, mode, ACL or device invalid' : 'protected root not staged' },
    { id: 'handoff-marker', ok: marker === 'absent', detail: marker === 'absent'
      ? 'unpublished' : marker === 'present' ? 'already published; use the root recovery journal' : 'marker state unobservable' },
  ];
  return { readyForStaging: checks.every((check) => check.ok), checks };
}
