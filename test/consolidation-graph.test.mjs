import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageRelease, verifyRelease } from '../workspace-bin/stage-consolidation-graph.mjs';

const nodeBinary = '/usr/local/bin/node';
const nativeMac = process.platform === 'darwin' && fs.existsSync(nodeBinary);

test('private consolidation graph stages under the loaded timer ABI and refuses file drift', { skip: !nativeMac }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidation-graph-test-'));
  fs.chmodSync(dir, 0o700);
  const release = path.join(dir, 'release');
  try {
    const manifest = stageRelease(release, nodeBinary, '137');
    assert.equal(manifest.node.abi, '137');
    assert.ok(manifest.graph.sources.includes('bin/consolidation-scheduler.mjs'));
    assert.ok(manifest.graph.sources.includes('bin/openclaw-notify.mjs'));
    assert.ok(manifest.graph.sources.includes('packages/event-schemas/dist/index.js'));
    assert.equal(manifest.graph.child.script, 'bin/openclaw-notify.mjs');
    assert.equal(manifest.native.available[manifest.native.file], manifest.native.sha256);
    const lock = JSON.parse(fs.readFileSync(path.join(release, 'package-lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), Object.keys(lock.packages).filter(key => key.includes('node_modules/')).sort());
    verifyRelease(fs.realpathSync(release), nodeBinary, '137');
    const generated = path.join(release, 'packages/event-schemas/dist/index.js');
    const original = fs.readFileSync(generated);
    fs.appendFileSync(generated, '\n');
    assert.throws(() => verifyRelease(fs.realpathSync(release), nodeBinary, '137'), /private release drift/);
    fs.writeFileSync(generated, original);
    const native = path.join(release, manifest.native.file);
    const binary = fs.readFileSync(native);
    fs.writeFileSync(native, 'not a native addon');
    assert.throws(() => verifyRelease(fs.realpathSync(release), nodeBinary, '137'), /failed/);
    fs.writeFileSync(native, binary);
    const otherNative = Object.keys(manifest.native.available).find(file => file !== manifest.native.file);
    if (otherNative) {
      const other = path.join(release, otherNative);
      const originalOther = fs.readFileSync(other);
      fs.appendFileSync(other, '\n');
      assert.throws(() => verifyRelease(fs.realpathSync(release), nodeBinary, '137'), /private release drift/);
      fs.writeFileSync(other, originalOther);
    }
    verifyRelease(fs.realpathSync(release), nodeBinary, '137');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
