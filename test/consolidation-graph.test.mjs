import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageRelease, verifyRelease } from '../workspace-bin/stage-consolidation-graph.mjs';

const nodeBinary = '/opt/homebrew/Cellar/node@22/22.22.0/bin/node';

test('private consolidation graph stages under the timer ABI and refuses file drift', { skip: !fs.existsSync(nodeBinary) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidation-graph-test-'));
  fs.chmodSync(dir, 0o700);
  const release = path.join(dir, 'release');
  try {
    const manifest = stageRelease(release, nodeBinary);
    assert.equal(manifest.node.abi, '127');
    assert.ok(manifest.graph.sources.includes('bin/consolidation-scheduler.mjs'));
    assert.ok(manifest.graph.sources.includes('bin/openclaw-notify.mjs'));
    assert.ok(manifest.graph.sources.includes('packages/event-schemas/dist/index.js'));
    assert.equal(manifest.graph.child.script, 'bin/openclaw-notify.mjs');
    const lock = JSON.parse(fs.readFileSync(path.join(release, 'package-lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), Object.keys(lock.packages).filter(key => key.includes('node_modules/')).sort());
    verifyRelease(fs.realpathSync(release), nodeBinary);
    const generated = path.join(release, 'packages/event-schemas/dist/index.js');
    const original = fs.readFileSync(generated);
    fs.appendFileSync(generated, '\n');
    assert.throws(() => verifyRelease(fs.realpathSync(release), nodeBinary), /private release drift/);
    fs.writeFileSync(generated, original);
    const native = path.join(release, manifest.native.file);
    const binary = fs.readFileSync(native);
    fs.writeFileSync(native, 'not a native addon');
    assert.throws(() => verifyRelease(fs.realpathSync(release), nodeBinary), /failed/);
    fs.writeFileSync(native, binary);
    verifyRelease(fs.realpathSync(release), nodeBinary);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
