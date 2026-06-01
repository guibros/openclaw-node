import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runHealthCheck,
  deriveStatus,
  formatHealthReport,
  parseAlertTargets,
  parseLaunchctlPid,
  COMPONENT_NAMES,
  DEFAULT_INTERVAL_SEC,
  ALERT_TARGETS_DEFAULT,
} from '../lib/health-check.mjs';
import { createHealthWatch } from '../bin/health-watch.mjs';

// ---------------------------------------------------------------------------
// Mock check functions
// ---------------------------------------------------------------------------

const mockOk = async () => ({ ok: true, detail: 'mock ok' });
const mockFail = async () => ({ ok: false, detail: 'mock fail' });

function allMockOpts(fn) {
  return {
    checkDaemon: fn,
    checkNats: fn,
    checkOllama: fn,
    checkEmbedder: fn,
    checkSqlite: fn,
    checkWorkspaceWritable: fn,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('COMPONENT_NAMES', () => {
  it('contains exactly 6 component names', () => {
    assert.equal(COMPONENT_NAMES.length, 6);
    assert.deepStrictEqual([...COMPONENT_NAMES], [
      'daemon', 'nats', 'ollama', 'embedder', 'sqlite', 'workspace_writable',
    ]);
  });
});

describe('runHealthCheck', () => {
  it('returns all 6 components with correct shape', async () => {
    const result = await runHealthCheck(allMockOpts(mockOk));

    for (const name of COMPONENT_NAMES) {
      assert.ok(result[name], `missing component: ${name}`);
      assert.equal(typeof result[name].ok, 'boolean', `${name}.ok must be boolean`);
      assert.equal(typeof result[name].detail, 'string', `${name}.detail must be string`);
      assert.equal(typeof result[name].latency_ms, 'number', `${name}.latency_ms must be number`);
    }
  });

  it('reports ok=true when all checks pass', async () => {
    const result = await runHealthCheck(allMockOpts(mockOk));
    for (const name of COMPONENT_NAMES) {
      assert.equal(result[name].ok, true, `${name} should be ok`);
    }
  });

  it('reports ok=false when checks fail', async () => {
    const result = await runHealthCheck(allMockOpts(mockFail));
    for (const name of COMPONENT_NAMES) {
      assert.equal(result[name].ok, false, `${name} should fail`);
    }
  });
});

describe('parseLaunchctlPid', () => {
  // Regression: `launchctl list <label>` returns a property-list DICT, not the
  // table format the old parser assumed. The PID is mid-output on a `"PID" = N;`
  // line and the last line is `};` — the old "last line, first token" logic read
  // `};` as the PID and reported a live daemon as "not running".
  const DICT = `{
\t"LimitLoadToSessionType" = "Aqua";
\t"Label" = "ai.openclaw.memory-daemon";
\t"OnDemand" = false;
\t"LastExitStatus" = 9;
\t"PID" = 31660;
\t"Program" = "/usr/local/bin/node";
};`;
  it('extracts the PID from launchctl dict output (running)', () => {
    const r = parseLaunchctlPid(DICT);
    assert.equal(r.ok, true);
    assert.equal(r.detail, 'pid=31660');
  });
  it('reports not-running when no PID line is present', () => {
    const r = parseLaunchctlPid('{\n\t"Label" = "x";\n\t"LastExitStatus" = 0;\n};');
    assert.equal(r.ok, false);
    assert.match(r.detail, /not running/);
  });
});

describe('deriveStatus', () => {
  it('returns healthy when all components ok', async () => {
    const result = await runHealthCheck(allMockOpts(mockOk));
    assert.equal(deriveStatus(result), 'healthy');
  });

  it('returns unhealthy when all components fail', async () => {
    const result = await runHealthCheck(allMockOpts(mockFail));
    assert.equal(deriveStatus(result), 'unhealthy');
  });

  it('returns degraded when some components fail', async () => {
    const result = await runHealthCheck({
      checkDaemon: mockOk,
      checkNats: mockFail,
      checkOllama: mockOk,
      checkEmbedder: mockFail,
      checkSqlite: mockOk,
      checkWorkspaceWritable: mockOk,
    });
    assert.equal(deriveStatus(result), 'degraded');
  });
});

describe('formatHealthReport', () => {
  it('produces markdown with all component sections', async () => {
    const result = await runHealthCheck(allMockOpts(mockOk));
    const report = formatHealthReport(result);

    assert.ok(report.includes('# Daemon Health Report'), 'missing title');
    assert.ok(report.includes('**Status:** healthy'), 'missing status');
    assert.ok(report.includes('| Component |'), 'missing table header');
    for (const name of COMPONENT_NAMES) {
      assert.ok(report.includes(`| ${name} |`), `missing component row: ${name}`);
    }
  });
});

describe('parseAlertTargets', () => {
  it('returns all 3 targets with default value', () => {
    const targets = parseAlertTargets(undefined);
    assert.deepStrictEqual(targets, ['file', 'nats', 'banner']);
  });

  it('parses custom CSV', () => {
    const targets = parseAlertTargets('file,banner');
    assert.deepStrictEqual(targets, ['file', 'banner']);
  });

  it('filters invalid targets', () => {
    const targets = parseAlertTargets('file,invalid,nats');
    assert.deepStrictEqual(targets, ['file', 'nats']);
  });

  it('returns default for empty string', () => {
    const targets = parseAlertTargets('');
    assert.deepStrictEqual(targets, ['file', 'nats', 'banner']);
  });
});

describe('createHealthWatch', () => {
  it('start and stop lifecycle works without error', async () => {
    let tickCount = 0;
    const watcher = createHealthWatch({
      intervalSec: 0.05, // 50ms for fast test
      targets: [], // no alerts
      healthCheckFn: async () => {
        const result = {};
        for (const name of COMPONENT_NAMES) {
          result[name] = { ok: true, detail: 'mock', latency_ms: 0 };
        }
        return result;
      },
      onTick(status) {
        tickCount++;
      },
    });

    watcher.start();
    // Wait for at least 2 ticks
    await new Promise(resolve => setTimeout(resolve, 200));
    watcher.stop();

    assert.ok(tickCount >= 1, `expected at least 1 tick, got ${tickCount}`);
  });
});

describe('constants', () => {
  it('DEFAULT_INTERVAL_SEC is 60', () => {
    assert.equal(DEFAULT_INTERVAL_SEC, 60);
  });

  it('ALERT_TARGETS_DEFAULT is file,nats,banner', () => {
    assert.equal(ALERT_TARGETS_DEFAULT, 'file,nats,banner');
  });
});
