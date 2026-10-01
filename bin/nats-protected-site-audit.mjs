#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { SITE_ROOT, HANDOFF_MARKER, parseDiskutilInfo, parseLsAclEntries, parseAdminMembership,
  uniqueDsclRecord, groupHasMembers, evaluateProtectedSite } from '../lib/nats-protected-site-audit.mjs';

const run = promisify(execFile);
const { values } = parseArgs({ options: { 'operator-uid': { type: 'string' } } });

function operatorUid() {
  const current = process.getuid();
  const explicit = values['operator-uid'];
  if (current !== 0) {
    if (explicit !== undefined && Number(explicit) !== current) throw new Error('operator UID differs from caller');
    return current;
  }
  if (explicit !== undefined && process.env.SUDO_UID && explicit !== process.env.SUDO_UID) {
    throw new Error('operator UID differs from sudo caller');
  }
  const selected = Number(explicit ?? process.env.SUDO_UID);
  if (!Number.isInteger(selected) || selected <= 0) throw new Error('operator UID required under root');
  return selected;
}

function recordField(output, key) {
  return output.match(new RegExp(`^${key}:\\s+([^\\n]+)$`, 'm'))?.[1]?.trim() || null;
}

async function identity(path) {
  try {
    const value = await fs.lstat(path);
    const listing = await run('/bin/ls', ['-lde', path]);
    return { isDirectory: value.isDirectory(), uid: value.uid, gid: value.gid, mode: value.mode,
      device: value.dev, aclEntries: parseLsAclEntries(listing.stdout) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function account(operator) {
  let uid;
  try {
    uid = await run('/usr/bin/id', ['-u', '_openclaw_nats']);
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
  const [gid, groupName, groups, operatorGroups, record, groupRecord, admin] = await Promise.all([
    run('/usr/bin/id', ['-g', '_openclaw_nats']),
    run('/usr/bin/id', ['-gn', '_openclaw_nats']),
    run('/usr/bin/id', ['-G', '_openclaw_nats']),
    run('/usr/bin/id', ['-G', String(operator)]),
    run('/usr/bin/dscl', ['.', '-read', '/Users/_openclaw_nats', 'UniqueID', 'PrimaryGroupID', 'UserShell', 'NFSHomeDirectory']),
    run('/usr/bin/dscl', ['.', '-read', '/Groups/_openclaw_nats', 'PrimaryGroupID', 'GroupMembership', 'GroupMembers', 'NestedGroups']),
    run('/usr/sbin/dseditgroup', ['-o', 'checkmember', '-m', '_openclaw_nats', 'admin'])
      .catch((error) => {
        if (error.code !== 67) throw error;
        return { stdout: error.stdout ?? '' };
      }),
  ]);
  const uidValue = Number(uid.stdout.trim());
  const gidValue = Number(gid.stdout.trim());
  const [userSearch, groupSearch, primaryGroupSearch] = await Promise.all([
    run('/usr/bin/dscl', ['.', '-search', '/Users', 'UniqueID', String(uidValue)]),
    run('/usr/bin/dscl', ['.', '-search', '/Groups', 'PrimaryGroupID', String(gidValue)]),
    run('/usr/bin/dscl', ['.', '-search', '/Users', 'PrimaryGroupID', String(gidValue)]),
  ]);
  return {
    uid: uidValue, gid: gidValue,
    groupName: groupName.stdout.trim(), groups: groups.stdout.trim().split(/\s+/).map(Number),
    operatorGroups: operatorGroups.stdout.trim().split(/\s+/).map(Number),
    shell: recordField(record.stdout, 'UserShell'), home: recordField(record.stdout, 'NFSHomeDirectory'),
    adminMember: parseAdminMembership(admin.stdout),
    uniqueUserRecord: uniqueDsclRecord(userSearch.stdout, 'UniqueID', '_openclaw_nats'),
    uniqueGroupRecord: uniqueDsclRecord(groupSearch.stdout, 'PrimaryGroupID', '_openclaw_nats'),
    uniquePrimaryGroupUser: uniqueDsclRecord(primaryGroupSearch.stdout, 'PrimaryGroupID', '_openclaw_nats'),
    groupMembersEmpty: !groupHasMembers(groupRecord.stdout),
    recordUid: Number(recordField(record.stdout, 'UniqueID')),
    recordGid: Number(recordField(record.stdout, 'PrimaryGroupID')),
    groupRecordGid: Number(recordField(groupRecord.stdout, 'PrimaryGroupID')),
  };
}

async function volume() {
  const df = await run('/bin/df', ['-P', '/private/var/db']);
  const device = df.stdout.trim().split('\n')[1]?.trim().split(/\s+/)[0];
  if (!device?.startsWith('/dev/')) throw new Error('volume device unavailable');
  const info = await run('/usr/sbin/diskutil', ['info', device]);
  return parseDiskutilInfo(info.stdout);
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('protected site audit requires macOS');
  const operator = operatorUid();
  const [serviceAccount, privateRoot, varRoot, dbRoot, root, marker, filesystem] = await Promise.all([
    account(operator), identity('/private'), identity('/private/var'), identity('/private/var/db'),
    identity(SITE_ROOT), identity(HANDOFF_MARKER), volume(),
  ]);
  const report = evaluateProtectedSite({ account: serviceAccount, operatorUid: operator,
    ancestors: [privateRoot, varRoot, dbRoot], root,
    marker: marker ? 'present' : 'absent', volume: filesystem });
  process.stdout.write(`${JSON.stringify({ observedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
  if (!report.readyForStaging) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`protected site unobservable: ${error.message}\n`);
  process.exitCode = 2;
});
