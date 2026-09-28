const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');

const [binding, extension] = process.argv.slice(2);
const Database = binding === 'node:sqlite' ? require(binding).DatabaseSync : require(binding);
const open = source => new Database(source, binding === 'node:sqlite' ? {allowExtension: true} : {});
process.umask(0o077);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-native-fixture-'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try {
  fs.mkdirSync(path.join(root, 'restores'), {mode: 0o700});
  const source = path.join(root, 'fixture.db');
  const db = open(source);
  db.loadExtension(extension);
  db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY,body TEXT); CREATE VIRTUAL TABLE search USING fts5(body,content='docs',content_rowid='id'); CREATE VIRTUAL TABLE vectors USING vec0(embedding FLOAT[4]); CREATE VIRTUAL TABLE text_vectors USING vec0(id TEXT PRIMARY KEY,embedding FLOAT[4]);");
  db.prepare('INSERT INTO docs VALUES(1,?)').run('original');
  db.prepare("INSERT INTO search(search) VALUES('rebuild')").run();
  db.prepare('INSERT INTO vectors(rowid,embedding) VALUES(1,?)').run(Buffer.from(new Float32Array([1, 2, 3, 4]).buffer));
  db.prepare('INSERT INTO text_vectors(id,embedding) VALUES(?,?)').run('key', Buffer.from(new Float32Array([1, 2, 3, 4]).buffer));
  db.prepare('INSERT INTO vectors(rowid,embedding) VALUES(2,?)').run(Buffer.from(new Float32Array([5, 6, 7, 8]).buffer));
  db.prepare('INSERT INTO text_vectors(id,embedding) VALUES(?,?)').run('last', Buffer.from(new Float32Array([5, 6, 7, 8]).buffer));
  db.close();
  const restored = path.join(root, 'restores', 'fixture.db');
  const manifest = path.join(root, 'manifest.json');
  function verify() {
    fs.copyFileSync(source, restored);
    fs.writeFileSync(manifest, JSON.stringify({extensions: [{sha256: hash(extension)}], stores: [{store: 'fixture.db', fileSha256: hash(source)}]}));
    return spawnSync(process.execPath, [path.join(__dirname, 'verify_native.cjs'), manifest, 'fixture.db', binding, extension], {encoding: 'utf8'});
  }
  const good = verify();
  assert.equal(good.status, 0, good.stderr);
  const goodResult = JSON.parse(good.stdout);
  assert.equal(goodResult.vectors.length, 2);
  assert.ok(goodResult.vectors.every(row => row.probes.length === 2 && row.probes.every(probe => probe.selfDistanceZero && probe.sameKey)));
  assert.equal(goodResult.fileHashUnchanged, true);
  const writer = open(source);
  writer.prepare('UPDATE docs SET body=? WHERE id=1').run('drifted');
  writer.close();
  const bad = verify();
  assert.equal(bad.status, 1, bad.stderr);
  const badResult = JSON.parse(bad.stdout);
  assert.equal(badResult.integrity, true);
  assert.equal(badResult.fts[0].integrity, 'failed');
  if (binding === 'node:sqlite') assert.equal(badResult.fts[0].sqliteCode, 267);
  else assert.equal(badResult.fts[0].code, 'SQLITE_CORRUPT_VTAB');
  assert.equal(badResult.fileHashUnchanged, true);
  console.log(JSON.stringify({nativeGood: true, vectorSelfQuery: true, driftDetectedWithoutRepair: true}));
} finally {
  fs.rmSync(root, {recursive: true});
}
