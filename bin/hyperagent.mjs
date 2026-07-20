#!/usr/bin/env node
/**
 * hyperagent.mjs — CLI for the HyperAgent evidence-driven strategy protocol.
 *
 * Pure data infrastructure — no LLM calls. Manages telemetry, strategies,
 * reflections, and proposals in SQLite. LLM synthesis happens at the agent
 * level via harness rules.
 *
 * Usage:
 *   hyperagent status
 *   hyperagent log <json>
 *   hyperagent telemetry [--domain X] [--last N]
 *   hyperagent strategies [--domain X]
 *   hyperagent strategy <id>
 *   hyperagent seed-strategy <json>
 *   hyperagent reflect [--force]
 *   hyperagent reflect --write-synthesis <json>
 *   hyperagent proposals
 *   hyperagent approve <id>
 *   hyperagent reject <id> [reason]
 *   hyperagent observe <id> [--window 60]
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { createRequire } from 'module';
import { createHyperAgentStore } from '../lib/hyperagent-store.mjs';

const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('hyperagent');

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');

const NODE_ID = process.env.OPENCLAW_NODE_ID || os.hostname();
const SOUL_ID = process.env.OPENCLAW_SOUL_ID || 'unknown';

// ── Helpers ────────────────────────────────────

function parseArg(args, flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function readJsonInput(args, usage) {
  const raw = hasFlag(args, '--stdin') ? fs.readFileSync(0, 'utf8').trim() : args[0];
  if (!raw) die(`usage: ${usage}`);
  try { return JSON.parse(raw); }
  catch { die('invalid JSON'); }
}

function printTable(rows, columns) {
  if (rows.length === 0) { console.log('(none)'); return; }
  const widths = columns.map(c => Math.max(c.label.length, ...rows.map(r => String(c.get(r)).length)));
  const header = columns.map((c, i) => c.label.padEnd(widths[i])).join('  ');
  console.log(header);
  console.log(columns.map((_, i) => '─'.repeat(widths[i])).join('  '));
  for (const row of rows) {
    console.log(columns.map((c, i) => String(c.get(row)).padEnd(widths[i])).join('  '));
  }
}

// ── Commands ────────────────────────────────────

function cmdStatus(store) {
  const stats = store.getStats();
  console.log(`HyperAgent Protocol — ${OPENCLAW_HOME}`);
  console.log(`  Telemetry entries: ${stats.telemetry}`);
  console.log(`  Active strategies: ${stats.strategies}`);
  console.log(`  Reflections:       ${stats.reflections}`);
  console.log(`  Pending proposals: ${stats.pendingProposals}`);
  console.log(`  Unreflected tasks: ${stats.unreflected}`);

  const pendingSynthesis = store.getPendingSynthesis();
  if (pendingSynthesis) console.log(`  Pending synthesis: reflection #${pendingSynthesis.id}`);
}

function cmdLog(store, args) {
  const entry = readJsonInput(args, 'hyperagent log <json|--stdin>');

  if (!entry.domain) die('domain is required');
  if (!entry.outcome) die('outcome is required');

  const row = store.logTelemetry({
    node_id: NODE_ID,
    soul_id: SOUL_ID,
    task_id: entry.task_id || null,
    domain: entry.domain,
    subdomain: entry.subdomain || null,
    strategy_id: entry.strategy_id ?? null,
    outcome: entry.outcome,
    iterations: entry.iterations ?? 1,
    duration_minutes: entry.duration_minutes ?? null,
    meta_notes: entry.meta_notes ?? null,
  });

  const flags = JSON.parse(row.pattern_flags || '[]');
  console.log(`logged: id=${row.id} domain=${row.domain} outcome=${row.outcome} flags=[${flags.join(',')}]`);
}

function cmdTelemetry(store, args) {
  const domain = parseArg(args, '--domain');
  const last = parseInt(parseArg(args, '--last', '20'));
  const rows = store.getTelemetry({ domain, last });

  printTable(rows, [
    { label: 'ID', get: r => r.id },
    { label: 'Domain', get: r => r.domain },
    { label: 'Sub', get: r => r.subdomain || '-' },
    { label: 'Outcome', get: r => r.outcome },
    { label: 'Iter', get: r => r.iterations },
    { label: 'Flags', get: r => { const f = JSON.parse(r.pattern_flags || '[]'); return f.length ? f.join(',') : '-'; }},
    { label: 'Date', get: r => r.created_at?.slice(0, 10) || '-' },
  ]);
}

function cmdStrategies(store, args) {
  const domain = parseArg(args, '--domain');
  const rows = store.listStrategies({ domain });

  printTable(rows, [
    { label: 'ID', get: r => r.id },
    { label: 'Domain', get: r => r.domain },
    { label: 'Sub', get: r => r.subdomain || '-' },
    { label: 'Title', get: r => r.title.slice(0, 40) },
    { label: 'Ver', get: r => r.version },
    { label: 'Source', get: r => r.source },
    { label: 'Updated', get: r => r.updated_at?.slice(0, 10) || '-' },
  ]);
}

function cmdConsult(store, args) {
  const domain = parseArg(args, '--domain');
  const subdomain = parseArg(args, '--subdomain');
  if (!domain) die('usage: hyperagent consult --domain <domain> [--subdomain <subdomain>]');
  const row = store.getStrategy(domain, subdomain, NODE_ID);
  if (!row) return;
  printJson({
    strategy_id: row.id,
    domain: row.domain,
    subdomain: row.subdomain,
    title: row.title,
    content: row.content,
    version: row.version,
  });
}

function cmdStrategy(store, args) {
  const id = parseInt(args[0]);
  if (!id) die('usage: hyperagent strategy <id>');

  const row = store.getStrategyById(id);
  if (!row) die(`strategy ${id} not found`);

  console.log(`# Strategy: ${row.title}`);
  console.log(`Domain: ${row.domain}${row.subdomain ? '/' + row.subdomain : ''}`);
  console.log(`Version: ${row.version} | Source: ${row.source} | Active: ${row.active ? 'yes' : 'no'}`);
  console.log(`Updated: ${row.updated_at}`);
  console.log('---');
  console.log(row.content);
}

function cmdSeedStrategy(store, args) {
  const data = readJsonInput(args, 'hyperagent seed-strategy <json|--stdin>');

  if (!data.domain || !data.title || !data.content) {
    die('required: domain, title, content');
  }

  const row = store.putStrategy({
    domain: data.domain,
    subdomain: data.subdomain || null,
    title: data.title,
    content: data.content,
    source: data.source || 'manual',
    node_id: data.node_id || null,
    supersedes: data.supersedes || null,
  });

  console.log(`created: id=${row.id} domain=${row.domain} title="${row.title}"`);
}

function cmdReflect(store, args) {
  // --pending: query DB for reflections awaiting synthesis
  if (hasFlag(args, '--pending')) {
    return cmdReflectPending(store);
  }

  // --write-synthesis: accept LLM output and write to DB
  if (hasFlag(args, '--write-synthesis')) {
    const valueIndex = args.indexOf('--write-synthesis') + 1;
    const data = readJsonInput(
      hasFlag(args, '--stdin') ? ['--stdin'] : [args[valueIndex]],
      'hyperagent reflect --write-synthesis <json|--stdin>'
    );

    if (!data.reflection_id) die('reflection_id required');
    const proposals = (data.proposals || []).map((proposal) => ({
      ...proposal,
      proposal_type: proposal.proposal_type,
      target_ref: proposal.target_ref ?? null,
      diff_content: proposal.diff_content == null
        ? null
        : (typeof proposal.diff_content === 'string' ? proposal.diff_content : JSON.stringify(proposal.diff_content)),
    }));
    const created = store.synthesizeReflection(data.reflection_id, {
      hypotheses: data.hypotheses || [],
      proposals,
    });
    for (const row of created) {
      console.log(`proposal created: id=${row.id} type=${row.proposal_type} "${row.title}"`);
    }

    console.log(`synthesis written to reflection ${data.reflection_id}`);
    return;
  }

  // Regular reflect: compute stats from unreflected telemetry
  const force = hasFlag(args, '--force');
  const identity = { node_id: NODE_ID, soul_id: SOUL_ID };
  const unreflected = store.getUnreflectedCount(identity);

  if (unreflected < 5 && !force) {
    console.log(`only ${unreflected} unreflected tasks (need 5). Use --force to override.`);
    return;
  }

  // Get the last reflection's to_id
  const lastReflection = store.getLastReflection(identity);
  const sinceId = lastReflection ? lastReflection.telemetry_to_id : 0;

  // Compute stats
  const stats = store.computeStats(sinceId, identity);
  if (!stats) {
    console.log('no telemetry to reflect on.');
    return;
  }

  // Write reflection row (raw stats only, no hypotheses yet)
  const reflection = store.putReflection({
    node_id: NODE_ID,
    soul_id: SOUL_ID,
    telemetry_from_id: stats.fromId,
    telemetry_to_id: stats.toId,
    telemetry_count: stats.totalTasks,
    raw_stats: stats,
  });

  // Auto-expire stale pending reflections (>24h without synthesis)
  store.expireStalePending();

  console.log(`reflection ${reflection.id} created (${stats.totalTasks} tasks)`);
  console.log(`  success rate: ${stats.successRate}%`);
  console.log(`  avg iterations: ${stats.avgIterations}`);
  console.log(`  strategy hit rate: ${stats.strategyHitRate}%`);
  console.log(`  pending synthesis — agent will pick up via harness rule`);
}

function cmdReflectPending(store) {
  // Query for reflections awaiting synthesis (hypotheses IS NULL, < 24h old)
  const pending = store.getPendingSynthesis();
  if (!pending) {
    // Silent — no output means nothing to do. Harness rule exits cleanly.
    return;
  }

  // Get the telemetry in the reflection window
  const entries = store.getTelemetrySince(pending.telemetry_from_id - 1, {
    node_id: pending.node_id,
    soul_id: pending.soul_id,
  })
    .filter(e => e.id >= pending.telemetry_from_id && e.id <= pending.telemetry_to_id);

  const sample = entries.slice(-5).map(e => ({
    id: e.id,
    domain: e.domain,
    subdomain: e.subdomain,
    outcome: e.outcome,
    iterations: e.iterations,
    flags: JSON.parse(e.pattern_flags || '[]'),
    meta_notes: e.meta_notes,
  }));

  // Get previous hypotheses for continuity
  const previous = store.getPreviousReflection(pending.id);
  const previousHypotheses = previous && previous.hypotheses
    ? JSON.parse(previous.hypotheses)
    : null;

  const output = {
    reflection_id: pending.id,
    node_id: pending.node_id,
    soul_id: pending.soul_id,
    stats: JSON.parse(pending.raw_stats),
    telemetry_sample: sample,
    previous_hypotheses: previousHypotheses,
  };

  // Output JSON — the agent reads this, synthesizes, and calls --write-synthesis
  printJson(output);
}

function cmdProposals(store) {
  const rows = store.getProposals();

  printTable(rows, [
    { label: 'ID', get: r => r.id },
    { label: 'Status', get: r => r.status },
    { label: 'Type', get: r => r.proposal_type },
    { label: 'Title', get: r => r.title.slice(0, 40) },
    { label: 'Eval', get: r => r.eval_telemetry_count || '-' },
    { label: 'Date', get: r => r.created_at?.slice(0, 10) || '-' },
  ]);
}

function cmdApprove(store, args) {
  const id = parseInt(args[0]);
  if (!id) die('usage: hyperagent approve <id>');

  const result = store.approveProposal(id, 'human');

  console.log(`approved: id=${result.id} type=${result.proposal_type} "${result.title}"`);
}

function cmdReject(store, args) {
  const id = parseInt(args[0]);
  if (!id) die('usage: hyperagent reject <id> [reason]');

  const reason = args.slice(1).join(' ') || null;
  const result = store.rejectProposal(id, 'human', reason);

  console.log(`rejected: id=${result.id} "${result.title}"`);
}

function cmdObserve(store, args) {
  const id = parseInt(args[0]);
  if (!id) die('usage: hyperagent observe <id> [--window 60]');

  const window = parseInt(parseArg(args, '--window', '60'));
  const result = store.startObservation(id, window);

  console.log(`observation started: id=${result.id} window=${window}min (proposal not applied)`);
  console.log(`  start: ${result.eval_window_start}`);
  console.log(`  end:   ${result.eval_window_end}`);
}

// ── Main ────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

if (!command || command === '--help' || command === '-h') {
  console.log(`hyperagent — evidence-driven strategy protocol CLI

commands:
  status                         overview stats
  log <json|--stdin>             log telemetry entry
  telemetry [--domain X] [--last N]  list entries
  strategies [--domain X]        list active strategies
  consult --domain X [--subdomain Y]  print the best strategy as JSON
  strategy <id>                  show strategy detail
  seed-strategy <json|--stdin>   import strategy
  reflect [--force]              trigger reflection
  reflect --pending              get pending reflection for synthesis (JSON)
  reflect --write-synthesis <json|--stdin>  write LLM synthesis
  proposals                      list proposals
  approve <id>                   approve proposal
  reject <id> [reason]           reject proposal
  observe <id> [--window 60]     collect a non-causal observation window

env:
  OPENCLAW_HOME      base dir (default: ~/.openclaw)
  OPENCLAW_NODE_ID   node identifier (default: hostname)
  OPENCLAW_SOUL_ID   soul identifier (default: unknown)`);
  process.exit(0);
}

let store;
try {
  store = createHyperAgentStore({ dbPath: path.join(OPENCLAW_HOME, 'state.db') });
} catch (err) {
  die(`failed to open store: ${err.message}`);
}

// ── Tracer Instrumentation ────────────────────
cmdStatus = tracer.wrap('cmdStatus', cmdStatus, { tier: 3 });
cmdLog = tracer.wrap('cmdLog', cmdLog, { tier: 3 });
cmdTelemetry = tracer.wrap('cmdTelemetry', cmdTelemetry, { tier: 3 });
cmdStrategies = tracer.wrap('cmdStrategies', cmdStrategies, { tier: 3 });
cmdConsult = tracer.wrap('cmdConsult', cmdConsult, { tier: 3 });
cmdStrategy = tracer.wrap('cmdStrategy', cmdStrategy, { tier: 3 });
cmdSeedStrategy = tracer.wrap('cmdSeedStrategy', cmdSeedStrategy, { tier: 3 });
cmdReflect = tracer.wrap('cmdReflect', cmdReflect, { tier: 3 });
cmdProposals = tracer.wrap('cmdProposals', cmdProposals, { tier: 3 });
cmdApprove = tracer.wrap('cmdApprove', cmdApprove, { tier: 3 });
cmdReject = tracer.wrap('cmdReject', cmdReject, { tier: 3 });
cmdObserve = tracer.wrap('cmdObserve', cmdObserve, { tier: 3 });

try {
  switch (command) {
    case 'status': cmdStatus(store); break;
    case 'log': cmdLog(store, commandArgs); break;
    case 'telemetry': cmdTelemetry(store, commandArgs); break;
    case 'strategies': cmdStrategies(store, commandArgs); break;
    case 'consult': cmdConsult(store, commandArgs); break;
    case 'strategy': cmdStrategy(store, commandArgs); break;
    case 'seed-strategy': cmdSeedStrategy(store, commandArgs); break;
    case 'reflect': cmdReflect(store, commandArgs); break;
    case 'proposals': cmdProposals(store); break;
    case 'approve': cmdApprove(store, commandArgs); break;
    case 'reject': cmdReject(store, commandArgs); break;
    case 'observe': cmdObserve(store, commandArgs); break;
    default: die(`unknown command: ${command}. Run hyperagent --help`);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  store.close();
}
