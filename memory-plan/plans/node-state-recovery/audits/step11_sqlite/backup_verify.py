import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import struct
import sys
import time
import tempfile


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

EXCLUDED_DIRECTORIES = {'backups': 'historical recovery copies', 'browser': 'browser vendor state'}
EXCLUDED_COMPONENTS = {'node_modules': 'dependency fixtures', '.git': 'repository metadata'}
EXCLUDED_LINKS = {
    'workspace/lib': 'runtime source-code link',
    'workspace/.claude/rules': 'prompt source-code link',
    'plugin-skills/browser-automation': 'skill source-code link',
}
EXCLUDED_FILES = {
    'state.db.bak-2026-07-04-pre-v4': 'historical recovery copy',
    'state.db.bak-2026-07-03-predeployday': 'historical recovery copy',
    'state.db.bak-pre-heal-20260530-142727': 'historical recovery copy',
    'state.db.bak-pre-consolidate-20260531-234925': 'historical recovery copy',
    'memory/main.sqlite.tmp-5c2f6a45-63d5-46c4-b5f1-e2d57f017fc6': 'unpromoted gateway reindex temporary; unchanged since 2026-02-04, no open owner',
    'memory/main.sqlite.tmp-4c374136-e5c9-42e1-895e-509021c85fb9': 'unpromoted gateway reindex temporary; unchanged since 2026-02-04, no open owner',
}


def inventory_stores(root, declared=STORES):
    found = set()
    excluded = {}

    def scan_error(error):
        raise error

    for current, directories, files in os.walk(root, followlinks=False, onerror=scan_error):
        retained = []
        for name in directories:
            path = Path(current) / name
            relative = str(path.relative_to(root))
            reason = EXCLUDED_DIRECTORIES.get(relative) or EXCLUDED_COMPONENTS.get(name)
            if reason:
                excluded[relative + '/'] = reason
            elif path.is_symlink():
                if relative not in EXCLUDED_LINKS:
                    raise RuntimeError('undeclared directory symlink in SQLite inventory: ' + relative)
                excluded[relative + '/'] = EXCLUDED_LINKS[relative]
            else:
                retained.append(name)
        directories[:] = retained
        for name in files:
            path = Path(current) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                if not path.is_file():
                    continue
            elif not stat.S_ISREG(mode):
                continue
            with path.open('rb') as source:
                if source.read(16) != b'SQLite format 3\0':
                    continue
            relative = str(path.relative_to(root))
            if relative in EXCLUDED_FILES:
                excluded[relative] = EXCLUDED_FILES[relative]
            else:
                found.add(relative)
    unknown = found - set(declared)
    missing = set(declared) - found
    if unknown or missing:
        raise RuntimeError('SQLite inventory differs: undeclared=' + repr(sorted(unknown)) + '; missing=' + repr(sorted(missing)))
    return {'declared': sorted(found), 'excluded': excluded, 'physicalRoot': str(root.resolve())}


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
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as target:
            json.dump(manifest, target, indent=2)
            target.write('\n')
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


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
        pinned_at = time.time()
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
        'pinnedAt': pinned_at,
        'snapshotEndedAt': time.time(),
        'fileSha256': file_digest(backup),
        'sourceSnapshotEqualsRestore': True,
        'fingerprint': before,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--extension', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if any(not extension.is_file() for extension in args.extension):
        raise FileNotFoundError('sqlite-vec extension missing')
    if any(not (args.root / store).is_file() for store in STORES):
        raise FileNotFoundError('declared application store missing')
    inventory = inventory_stores(args.root)
    required = sum((args.root / store).stat().st_size +
                   (Path(str(args.root / store) + '-wal').stat().st_size if Path(str(args.root / store) + '-wal').exists() else 0)
                   for store in STORES) * 3
    if shutil.disk_usage(args.output.parent).free < required:
        raise RuntimeError('insufficient free space')
    args.output.mkdir(mode=0o700)
    manifest = {
        'startedAt': time.time(),
        'sqliteVersion': sqlite3.sqlite_version,
        'python': sys.version.split()[0],
        'helperSha256': file_digest(Path(__file__)),
        'extensions': [{'path': str(extension.resolve()), 'sha256': file_digest(extension)} for extension in args.extension],
        'inventory': inventory,
        'method': 'read-only WAL pinned transactions without extensions; SQLite backup API; isolated file restores',
        'setConsistency': 'per-store snapshots; not one cross-store or JetStream point in time',
        'stores': [],
        'complete': False,
    }
    manifest_path = args.output / 'manifest.json'
    write_manifest(manifest_path, manifest)
    store = None
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
