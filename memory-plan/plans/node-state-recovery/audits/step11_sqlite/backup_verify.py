import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import struct
import sys
import time


STORES = (
    'lcm.db',
    'state.db',
    'graph-cache.db',
    'tasks/runs.sqlite',
    'memory/main.sqlite',
    'workspace/.knowledge.db',
    'workspace/projects/mission-control/data/mission-control.db',
    'agents/main/agent/codex-home/logs_2.sqlite',
    'agents/main/agent/codex-home/state_5.sqlite',
    'agents/main/agent/codex-home/goals_1.sqlite',
    'plugin-state/state.sqlite',
    'flows/registry.sqlite',
)


def quoted(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def encode_value(value):
    if value is None:
        return b'n'
    if isinstance(value, int):
        return b'i' + str(value).encode('ascii')
    if isinstance(value, float):
        return b'f' + struct.pack('>d', value)
    if isinstance(value, str):
        return b's' + value.encode('utf-8')
    return b'b' + value


def digest_rows(rows):
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        digest.update(struct.pack('>Q', len(row)))
        for value in row:
            encoded = encode_value(value)
            digest.update(struct.pack('>Q', len(encoded)))
            digest.update(encoded)
        count += 1
    return {'rows': count, 'sha256': digest.hexdigest()}


def connect_readonly(path):
    connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=15)
    try:
        connection.execute('PRAGMA query_only=ON')
        if connection.execute('PRAGMA journal_mode').fetchone()[0] != 'wal':
            raise RuntimeError('live pinned snapshots require WAL journal mode')
        connection.execute('BEGIN')
        connection.execute('SELECT count(*) FROM sqlite_schema').fetchone()
        return connection
    except BaseException:
        connection.close()
        raise


def fingerprint(connection):
    integrity = [row[0] for row in connection.execute('PRAGMA integrity_check')]
    if integrity != ['ok']:
        raise RuntimeError('integrity_check failed')
    schema = digest_rows(connection.execute(
        'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'
    ))
    tables = {}
    for database, name, kind, columns, without_rowid, strict in sorted(
        connection.execute('PRAGMA table_list').fetchall()
    ):
        if database != 'main' or kind in ('view', 'virtual') or name == 'sqlite_schema':
            continue
        info = connection.execute('PRAGMA table_xinfo(' + quoted(name) + ')').fetchall()
        if without_rowid:
            order = ','.join(quoted(row[1]) for row in sorted(info, key=lambda row: row[5]) if row[5])
            columns = [quoted(row[1]) for row in info if row[6] != 1]
        else:
            names = {row[1].lower() for row in info}
            order = next(quoted(alias) for alias in ('_rowid_', 'rowid', 'oid') if alias not in names)
            columns = [order] + [quoted(row[1]) for row in info if row[6] != 1]
        expressions = []
        for column in columns:
            expressions.extend(['typeof(' + column + ')', 'CASE WHEN typeof(' + column + ")='text' THEN CAST(" + column + ' AS BLOB) ELSE ' + column + ' END'])
        rows = connection.execute('SELECT ' + ','.join(expressions) + ' FROM ' + quoted(name) + ' ORDER BY ' + order)
        tables[name] = {'kind': kind, **digest_rows(rows)}
    return {
        'integrity': 'ok',
        'schema': schema,
        'userVersion': connection.execute('PRAGMA user_version').fetchone()[0],
        'applicationId': connection.execute('PRAGMA application_id').fetchone()[0],
        'pageSize': connection.execute('PRAGMA page_size').fetchone()[0],
        'encoding': connection.execute('PRAGMA encoding').fetchone()[0],
        'autoVacuum': connection.execute('PRAGMA auto_vacuum').fetchone()[0],
        'journalMode': connection.execute('PRAGMA journal_mode').fetchone()[0],
        'foreignKeys': digest_rows(connection.execute('PRAGMA foreign_key_check').fetchall()),
        'tables': tables,
    }


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def write_manifest(path, manifest):
    with path.open('w') as target:
        json.dump(manifest, target, indent=2)
        target.write('\n')
        target.flush()
        os.fsync(target.fileno())
    sync_directory(path.parent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_file(path):
    with path.open('rb') as source:
        os.fsync(source.fileno())
    sync_directory(path.parent)


def snapshot_store(root, relative, output):
    source = root / relative
    backup = output / 'snapshots' / relative
    restore = output / 'restores' / relative
    backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    restore.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    started = time.monotonic()
    snapshot_time = time.time()
    with closing(connect_readonly(source)) as reader:
        before = fingerprint(reader)
        destination = sqlite3.connect(str(backup))
        try:
            deadline = time.monotonic() + 300

            def progress(status, remaining, total):
                if time.monotonic() > deadline:
                    raise TimeoutError('backup deadline exceeded')

            reader.backup(destination, pages=256, progress=progress, sleep=0.05)
        finally:
            destination.close()
        reader.rollback()
    shutil.copyfile(backup, restore)
    sync_file(backup)
    sync_file(restore)
    with closing(connect_readonly(restore)) as restored:
        after = fingerprint(restored)
        restored.rollback()
    if before != after:
        raise RuntimeError('restored logical fingerprint differs')
    if file_digest(backup) != file_digest(restore):
        raise RuntimeError('restore file hash differs')
    return {
        'store': relative,
        'bytes': backup.stat().st_size,
        'seconds': round(time.monotonic() - started, 3),
        'snapshotStartedAt': snapshot_time,
        'snapshotEndedAt': time.time(),
        'fileSha256': file_digest(backup),
        'sourceSnapshotEqualsRestore': True,
        'fingerprint': before,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--extension', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if not args.extension.is_file():
        raise FileNotFoundError('sqlite-vec extension missing')
    if any(not (args.root / store).is_file() for store in STORES):
        raise FileNotFoundError('declared application store missing')
    required = sum((args.root / store).stat().st_size for store in STORES) * 3
    if shutil.disk_usage(args.output.parent).free < required:
        raise RuntimeError('insufficient free space')
    args.output.mkdir(mode=0o700)
    manifest = {
        'startedAt': time.time(),
        'sqliteVersion': sqlite3.sqlite_version,
        'python': sys.version.split()[0],
        'helperSha256': file_digest(Path(__file__)),
        'extensionSha256': file_digest(args.extension),
        'method': 'read-only WAL pinned transactions without extensions; SQLite backup API; isolated file restores',
        'setConsistency': 'per-store snapshots; not one cross-store or JetStream point in time',
        'stores': [],
        'complete': False,
    }
    manifest_path = args.output / 'manifest.json'
    write_manifest(manifest_path, manifest)
    try:
        for store in STORES:
            result = snapshot_store(args.root, store, args.output)
            manifest['stores'].append(result)
            write_manifest(manifest_path, manifest)
            print(json.dumps({'store': store, 'verified': True, 'bytes': result['bytes'], 'seconds': result['seconds']}), flush=True)
        for path in args.output.rglob('*'):
            expected = 0o700 if path.is_dir() else 0o600
            if path.stat().st_mode & 0o777 != expected:
                raise RuntimeError('backup permissions differ')
        manifest['complete'] = True
        manifest['completedAt'] = time.time()
        write_manifest(manifest_path, manifest)
        print(json.dumps({'complete': True, 'stores': len(manifest['stores']), 'output': str(args.output)}), flush=True)
    except BaseException as error:
        manifest['failedStore'] = store
        manifest['errorType'] = type(error).__name__
        write_manifest(manifest_path, manifest)
        print(json.dumps({'complete': False, 'store': store, 'errorType': type(error).__name__}), flush=True)
        raise


if __name__ == '__main__':
    main()
