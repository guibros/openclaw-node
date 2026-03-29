# Test Suite — openclaw-node

## Quick Start

```bash
# Run all unit tests (root + Mission Control)
npm run test:all

# Root tests only (node:test)
npm test

# Mission Control tests only (vitest)
npm run test:mc

# Integration tests (requires NATS)
npm run test:integration

# Single test file
node --test test/mesh-plans.test.js
```

## Test Runner

- **Root tests** (`test/`): Node.js built-in test runner (`node:test`) + `assert/strict`
- **Mission Control** (`mission-control/src/lib/__tests__/`): Vitest + `expect`
- No external test dependencies for root tests — zero install, runs everywhere Node 18+ is available

## Root Tests (`test/`)

### Unit Tests

| File | Module | Tests | What it covers |
|------|--------|-------|----------------|
| `mesh-plans.test.js` | `lib/mesh-plans.js` | 32 | Plan creation, wave computation (DAG), delegation routing decision tree, PlanStore CRUD + lifecycle |
| `mesh-registry.test.js` | `lib/mesh-registry.js` | 9 | Tool registration to KV, NATS subscriptions, listTools, shutdown cleanup, remote call |
| `nats-resolve.test.js` | `lib/nats-resolve.js` | 10 | 4-step URL/token resolution chain (env var, openclaw.env, .mesh-config, fallback), natsConnectOpts |
| `agent-activity.test.js` | `lib/agent-activity.js` | 16 | Path encoding, JSONL session file discovery, activity state detection, cost/summary extraction |
| `memory-budget.test.mjs` | `lib/memory-budget.mjs` | 19 | Freeze/thaw lifecycle, character budget enforcement, trimming, event emission, stats |
| `kanban-io.test.js` | `lib/kanban-io.js` | 13 | Markdown task parsing, field updates, file locking |
| `llm-providers.test.js` | `lib/llm-providers.js` | 15 | Provider factory, arg building, env cleaning |
| `mesh-harness.test.js` | `lib/mesh-harness.js` | 10+ | Rule loading by scope, output scanning, enforcement |
| `mesh-tasks-status.test.js` | `lib/mesh-tasks.js` | 7 | Task status enum, createTask defaults |
| `collab-unit.test.js` | `lib/mesh-collab.js` | 30 | Session lifecycle, dead node handling, convergence (unanimous/majority/quorum), turn advancement |
| `collab-circling.test.js` | `lib/mesh-collab.js` | 25+ | Circling strategy mode, artifact management, phase transitions |
| `hyperagent-store.test.js` | `lib/hyperagent-store.mjs` | 28 | Store operations, strategy persistence, reflection lifecycle |
| `plan-templates.test.js` | `lib/plan-templates.js` | 10+ | Template definitions, variable substitution |
| `role-loader.test.js` | `lib/role-loader.js` | 20+ | YAML parsing, role finding, validation, forbidden patterns |
| `rule-loader.test.js` | `lib/rule-loader.js` | 15+ | Frontmatter parsing, glob matching, rule priority sorting |
| `field-roundtrip.test.js` | Field serialization | 5 | Serialize/parse round-trip for task fields |
| `regression-bugs.test.js` | Various | 11 | Regression suite for previously fixed bugs |

### Integration Tests (require NATS)

| File | What it covers |
|------|----------------|
| `distributed-mc.test.js` | Distributed MC sync: KV mirror + sync engine across nodes |
| `collab-integration.test.js` | Multi-node collaboration with simulated KV |
| `collab-agent-lifecycle.test.js` | Full agent lifecycle within collaboration sessions |
| `e2e-collab.test.js` | End-to-end collaboration pipeline |
| `agent-recruit.test.js` | Agent recruitment and node selection |

## Mission Control Tests (`mission-control/src/lib/__tests__/`)

| File | Module | Tests | What it covers |
|------|--------|-------|----------------|
| `wikilinks.test.ts` | `memory/wikilinks.ts` | 18 | `[[wikilink]]` extraction, task ID extraction, file ref extraction, resolution maps, cross-reference dedup |
| `daily-log.test.ts` | `parsers/daily-log.ts` | 9 | Date extraction from filename, H1 title fallback, directory listing, chronological sort |
| `memory-md.test.ts` | `parsers/memory-md.ts` | 8 | H1 title extraction, `##` section parsing state machine, empty sections, full content preservation |
| `task-markdown.test.ts` | `parsers/task-markdown.ts` | 25 | Task YAML parsing, status mapping, mesh fields, collaboration fields, serialization round-trip |
| `status-kanban.test.ts` | `parsers/task-markdown.ts` | 8 | Status-to-kanban mapping, kanban-to-status reverse mapping |
| `mesh-kv-sync.test.ts` | `sync/mesh-kv.ts` | 20 | KV-to-DB sync, CAS writes, watcher notifications, conflict resolution |

## Mock Patterns

### NATS Module Mock (used by all NATS-dependent tests)

```javascript
const Module = require('module');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const mockNats = {
  StringCodec: () => ({
    encode: (str) => encoder.encode(str),
    decode: (buf) => decoder.decode(buf),
  }),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'nats') return 'nats';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['nats'] = {
  id: 'nats', filename: 'nats', loaded: true, exports: mockNats,
};
```

Place this **before any `require()` that depends on NATS**. See `test/collab-unit.test.js` for the canonical example.

### MockKV (in-memory NATS KV replacement)

```javascript
class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() {
    const iter = this.store.keys();
    return {
      [Symbol.asyncIterator]() {
        return { next() { return Promise.resolve(iter.next()); } };
      },
    };
  }
}
```

Used by `mesh-plans.test.js`, `mesh-registry.test.js`, `collab-unit.test.js`, and the MC `mock-kv.ts`.

### Filesystem Mocking

- Root tests: use `fs.mkdtempSync` for real temp directories, cleaned up in `afterEach`
- MC tests: same pattern via vitest `beforeEach`/`afterEach`
- No monkey-patching of `fs` — real file I/O against temp dirs

## Writing New Tests

### Root test (node:test)

```javascript
#!/usr/bin/env node
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock NATS if needed (see pattern above)

const { myFunction } = require('../lib/my-module');

describe('myFunction', () => {
  it('does the thing', () => {
    assert.equal(myFunction('input'), 'expected');
  });
});
```

Run: `node --test test/my-module.test.js`

### MC test (vitest)

```typescript
import { describe, it, expect } from "vitest";
import { myFunction } from "../path/to/module";

describe("myFunction", () => {
  it("does the thing", () => {
    expect(myFunction("input")).toBe("expected");
  });
});
```

Run: `cd mission-control && npx vitest run src/lib/__tests__/my-module.test.ts`

## CI

GitHub Actions runs on every push/PR to `main`:
- Root unit tests on Node 18, 20, 22
- MC tests on Node 22

See `.github/workflows/test.yml`.

## Coverage Gaps (known)

These modules have no direct unit tests. Integration tests cover some indirectly.

| Module | Reason |
|--------|--------|
| `bin/mesh-task-daemon.js` | 1948 LOC daemon — too coupled to NATS for unit tests. Covered by `distributed-mc.test.js` |
| `bin/mesh-agent.js` | 1648 LOC agent wrapper — tested via `collab-agent-lifecycle.test.js` |
| `bin/mesh-bridge.js` | Bidirectional sync — needs live NATS |
| `lib/session-store.mjs` | Session persistence — needs filesystem integration tests |
| `lib/transcript-parser.mjs` | JSONL parsing — needs fixture files |
| `lib/pre-compression-flush.mjs` | Compression pipeline — needs fixture files |
| `mission-control/.../memory/entities.ts` | NLP-like entity extraction |
| `mission-control/.../memory/extract.ts` | Heuristic-based fact extraction |
| `mission-control/.../scheduler.ts` | Cron evaluation, timezone handling |
| `mission-control/.../hooks.ts` | 845 LOC lifecycle hooks |
