const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const [manifestPath, store, binding, extension] = process.argv.slice(2);
if (!manifestPath || !store || !binding || !extension) throw new Error('manifest, declared store, binding and extension paths required');
process.umask(0o077);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entry = manifest.stores.find(row => row.store === store);
if (!entry) throw new Error('store is not declared in manifest');
const restoreRoot = fs.realpathSync(path.join(path.dirname(manifestPath), 'restores'));
const database = fs.realpathSync(path.join(restoreRoot, store));
if (!database.startsWith(restoreRoot + path.sep)) throw new Error('database is outside isolated restore directory');
const Database = require(binding);
const quoted = name => '"' + name.replaceAll('"', '""') + '"';

function hashFile(path) {
  const digest = crypto.createHash('sha256');
  const descriptor = fs.openSync(path, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest('hex');
}

const before = hashFile(database);
if (before !== entry.fileSha256) throw new Error('restored file hash differs from manifest');
if (hashFile(extension) !== manifest.extensionSha256) throw new Error('extension hash differs from manifest');
const db = new Database(database, {fileMustExist: true});
const result = {
  store,
  verifierSha256: hashFile(__filename),
  engine: process.version,
  abi: process.versions.modules,
  sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
  extensionSha256: hashFile(extension),
  fts: [],
  vectors: [],
};
try {
  db.loadExtension(extension);
  result.vecVersion = db.prepare('SELECT vec_version() AS version').get().version;
  result.integrity = db.pragma('integrity_check').every(row => row.integrity_check === 'ok');
  result.foreignKeyViolations = db.pragma('foreign_key_check').length;
  const tables = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table'").all();
  for (const {name, sql} of tables) {
    if (/\busing\s+fts5\s*\(/i.test(sql || '')) {
      const row = {table: name};
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO ' + quoted(name) + '(' + quoted(name) + ",rank) VALUES('integrity-check',1)").run();
        row.integrity = 'ok';
      } catch (error) {
        row.integrity = 'failed';
        row.code = error.code;
      } finally {
        db.exec('ROLLBACK');
      }
      result.fts.push(row);
    }
    if (/\busing\s+vec0\s*\(/i.test(sql || '')) {
      const row = {table: name, count: db.prepare('SELECT count(*) AS count FROM ' + quoted(name)).get().count};
      const columns = db.prepare('PRAGMA table_info(' + quoted(name) + ')').all();
      const key = columns.find(column => column.pk)?.name || 'rowid';
      const probe = db.prepare('SELECT ' + quoted(key) + ' AS identity,embedding FROM ' + quoted(name) + ' LIMIT 1').get();
      if (probe) {
        const nearest = db.prepare('SELECT ' + quoted(key) + ' AS identity,distance FROM ' + quoted(name) + ' WHERE embedding MATCH ? AND k=1 ORDER BY distance').get(probe.embedding);
        row.selfDistanceZero = nearest?.distance === 0;
        row.sameKey = nearest?.identity === probe.identity;
      } else {
        row.empty = true;
      }
      result.vectors.push(row);
    }
  }
} finally {
  db.close();
}
result.fileHashUnchanged = hashFile(database) === before;
result.passed = result.integrity && result.fileHashUnchanged &&
  result.fts.every(row => row.integrity === 'ok') &&
  result.vectors.every(row => row.empty || row.selfDistanceZero);
process.stdout.write(JSON.stringify(result) + '\n');
if (!result.passed) process.exitCode = 1;
