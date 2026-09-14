/**
 * session-trace-emitter.test.mjs — the emitter's first coverage.
 *
 * The defect this pins: the emitter classified entries by their top-level
 * `type` and carried ENTRY_MAP keys for `tool_use`/`tool_result`, but in the
 * transcript shape lib/transcript-parser.mjs documents those are content
 * blocks inside `message.content`. The keys never matched, so every tool call,
 * tool result and tool error was absent from observability_events — a run whose
 * tool failed left only the downstream symptom, as an ordinary assistant
 * message with no error flag.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionTraceEmitter } from '../workspace-bin/session-trace-emitter.mjs';

function stubTracer() {
  const events = [];
  return {
    events,
    emit(fn, data = {}) { events.push({ fn, ...data }); },
    of(fn) { return events.filter((e) => e.fn === fn); },
  };
}

let tmpdir;
beforeEach(() => { tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-emitter-')); });
afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }); });

/** Write entries as JSONL and run one emitter pass over them. */
function run(entries, { emitter, tracer, name = 'session.jsonl' } = {}) {
  const t = tracer ?? stubTracer();
  const e = emitter ?? createSessionTraceEmitter(t);
  const file = path.join(tmpdir, name);
  fs.appendFileSync(file, entries.map((x) => JSON.stringify(x)).join('\n') + '\n');
  e.processNewEntries(file);
  return { tracer: t, emitter: e, file };
}

const assistantToolCall = (id, name, input) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  timestamp: '2026-09-14T16:00:01Z',
});

const toolResult = (id, content, isError) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }],
  },
  timestamp: '2026-09-14T16:00:02Z',
});

describe('session trace emitter — tool activity', () => {
  it('regression_F-TRACE1: emits tool.call for a tool_use content block', () => {
    const { tracer } = run([
      assistantToolCall('toolu_01', 'execute_code', { command: 'pip-audit' }),
    ]);

    const calls = tracer.of('tool.call');
    assert.equal(calls.length, 1, 'a tool call in message.content must reach the trace');
    assert.equal(calls[0].category, 'state_transition');
    assert.equal(calls[0].tier, 1);
    assert.match(calls[0].args_summary, /execute_code/);
    assert.equal(calls[0].result_summary, 'pip-audit');
  });

  it('regression_F-TRACE2: a failed tool result is categorized error, not lifecycle', () => {
    const { tracer } = run([
      { type: 'user', message: { role: 'user', content: 'Scan the environment.' } },
      assistantToolCall('toolu_01', 'execute_code', { environment: 'cloud_runner' }),
      toolResult('toolu_01', 'ValidationError: environment "cloud_runner" is not supported', true),
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I could not complete the scan.' }] } },
    ]);

    const results = tracer.of('tool.result');
    assert.equal(results.length, 1);
    assert.equal(results[0].category, 'error', 'an errored tool must not be filed as compute');
    assert.equal(results[0].tier, 1, 'tier 1 so smart-mode sampling cannot drop it');
    assert.match(results[0].error, /ValidationError/);

    // The point of the fix: the failure is visible on its own, not merely
    // inferable from the assistant message that follows it.
    assert.ok(
      tracer.events.some((e) => e.category === 'error'),
      'the trace must carry an error event for a failed tool call',
    );
  });

  it('regression_F-TRACE3: names the tool on the result by pairing tool_use_id', () => {
    const { tracer } = run([
      assistantToolCall('toolu_A', 'Read', { file_path: '/etc/hosts' }),
      toolResult('toolu_A', 'ok', false),
    ]);

    const [result] = tracer.of('tool.result');
    assert.equal(result.args_summary, 'tool=Read');
    assert.equal(result.category, 'compute');
    assert.equal(result.error, null);
  });

  it('pairs a result that arrives in a later tick', () => {
    const tracer = stubTracer();
    const emitter = createSessionTraceEmitter(tracer);

    run([assistantToolCall('toolu_B', 'Bash', { command: 'ls' })], { tracer, emitter });
    run([toolResult('toolu_B', 'file-a\nfile-b', false)], { tracer, emitter });

    const [result] = tracer.of('tool.result');
    assert.equal(result.args_summary, 'tool=Bash', 'pairing must survive across ticks');
  });

  it('degrades to unknown when the call was never seen', () => {
    const { tracer } = run([toolResult('toolu_missing', 'orphan result', false)]);
    const [result] = tracer.of('tool.result');
    assert.equal(result.args_summary, 'tool=unknown');
  });

  it('handles a top-level tool_result entry without double-emitting', () => {
    const { tracer } = run([
      assistantToolCall('toolu_C', 'Grep', { pattern: 'needle' }),
      { type: 'tool_result', tool_use_id: 'toolu_C', is_error: false, content: 'no matches' },
    ]);

    assert.equal(tracer.of('tool.result').length, 1, 'exactly one result event per tool result');
    assert.equal(tracer.of('tool.result')[0].args_summary, 'tool=Grep');
  });

  it('reads array-shaped tool result content', () => {
    const { tracer } = run([
      assistantToolCall('toolu_D', 'Read', { file_path: '/tmp/x' }),
      toolResult('toolu_D', [{ type: 'text', text: 'line one' }], false),
    ]);
    assert.match(tracer.of('tool.result')[0].result_summary, /line one/);
  });
});

describe('session trace emitter — message envelopes still work', () => {
  it('keeps emitting lifecycle events and token/cost meta', () => {
    const { tracer } = run([
      { type: 'user', message: { role: 'user', content: 'hello' } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        usage: { input_tokens: 1200, output_tokens: 80 },
      },
    ]);

    assert.equal(tracer.of('message.user').length, 1);
    const [assistant] = tracer.of('message.assistant');
    assert.equal(JSON.parse(assistant.meta).input_tokens, 1200);
  });

  it('emits both the envelope and the tool event for one entry', () => {
    const { tracer } = run([assistantToolCall('toolu_E', 'Write', { file_path: '/tmp/y' })]);
    assert.equal(tracer.of('message.assistant').length, 1);
    assert.equal(tracer.of('tool.call').length, 1);
  });

  it('reset clears pending tool pairings', () => {
    const tracer = stubTracer();
    const emitter = createSessionTraceEmitter(tracer);

    run([assistantToolCall('toolu_F', 'Bash', { command: 'true' })], { tracer, emitter });
    emitter.reset();
    run([toolResult('toolu_F', 'ok', false)], { tracer, emitter, name: 'second.jsonl' });

    assert.equal(tracer.of('tool.result')[0].args_summary, 'tool=unknown');
  });
});
