#!/usr/bin/env node

/**
 * check-llm-baseline.mjs — Deployment-time system check for the extraction LLM.
 *
 * Reads available system RAM and recommends the appropriate Qwen3 model tier
 * for the local LLM extraction runtime (Ollama). Used during node installation
 * to pick the right model without hardcoding to one machine class.
 *
 * Usage:
 *   node bin/check-llm-baseline.mjs                  # report + recommend
 *   node bin/check-llm-baseline.mjs --json           # machine-readable
 *   node bin/check-llm-baseline.mjs --install        # also `ollama pull` it
 *   node bin/check-llm-baseline.mjs --check-ollama   # verify Ollama installed
 *
 * Exit codes:
 *   0 — system supports at least the floor tier (Qwen3-8B); recommendation printed
 *   2 — system below floor (<8 GB RAM after reservations); local LLM not viable
 *   1 — error (Ollama check failed, etc.)
 *
 * Tier policy (operator-authored, Block 3 §0):
 *   ≥48 GB RAM   → qwen3:32b-instruct-q4_K_M   (~18 GB)
 *   ≥32 GB RAM   → qwen3:14b-instruct-q4_K_M   (~9  GB)
 *   ≥16 GB RAM   → qwen3:8b-instruct-q4_K_M    (~5  GB)
 *   <16 GB RAM   → BELOW FLOOR — operator must use cloud LLM or skip extraction
 *
 * 4B tier is intentionally excluded per operator decision: JSON-mode reliability
 * is too low below 8B for this task.
 */

import os from 'node:os';
import { execFile } from 'node:child_process';
import { parseArgs } from 'node:util';

const GB = 1024 * 1024 * 1024;
// Reserved RAM not available for LLM (OS + the rest of the node process + buffer).
// Apple Silicon unified memory is more flexible; Linux/Windows need conservative reserve.
const RESERVED_GB = 4;

const TIERS = [
  { min_gb: 48, model: 'qwen3:32b-instruct-q4_K_M', size_gb: 18, name: 'Qwen3-32B',
    note: 'High-end tier. Best quality, slowest inference (~5-15 tok/s on consumer hw).' },
  { min_gb: 32, model: 'qwen3:14b-instruct-q4_K_M', size_gb: 9,  name: 'Qwen3-14B',
    note: 'Sweet spot. Reliable JSON-mode + implicit-fact extraction. ~10-25 tok/s.' },
  { min_gb: 16, model: 'qwen3:8b-instruct-q4_K_M',  size_gb: 5,  name: 'Qwen3-8B',
    note: 'Floor tier. JSON-mode reliable, explicit + most implicit facts. ~15-40 tok/s.' },
];

const FLOOR_GB = 16;

function recommend(totalGb, availGb) {
  if (totalGb < FLOOR_GB) {
    return { tier: null, reason: `system has ${totalGb.toFixed(1)} GB RAM (< floor ${FLOOR_GB} GB)` };
  }
  for (const t of TIERS) {
    if (totalGb >= t.min_gb) return { tier: t };
  }
  return { tier: null, reason: 'no tier matched (should not happen)' };
}

function checkOllama() {
  return new Promise((resolve) => {
    execFile('ollama', ['--version'], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve({ installed: false, error: err.message });
      resolve({ installed: true, version: String(stdout).trim() });
    });
  });
}

function pullModel(modelTag) {
  return new Promise((resolve) => {
    const child = execFile('ollama', ['pull', modelTag], { timeout: 0 });
    child.stdout?.on('data', (d) => process.stdout.write(d));
    child.stderr?.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => resolve({ ok: code === 0, code }));
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

async function main() {
  const { values: opts } = parseArgs({
    options: {
      json:           { type: 'boolean', default: false },
      install:        { type: 'boolean', default: false },
      'check-ollama': { type: 'boolean', default: false },
      help:           { type: 'boolean', short: 'h', default: false },
    },
  });

  if (opts.help) {
    console.log(`Usage: node bin/check-llm-baseline.mjs [--json] [--install] [--check-ollama]

Probes system RAM and recommends a Qwen3 model tier for local LLM extraction.

Options:
  --json           Output machine-readable JSON instead of human report
  --install        After recommending, run \`ollama pull <model>\` to fetch it
  --check-ollama   Verify Ollama is installed; non-zero exit if missing
  --help, -h       Show this help`);
    process.exit(0);
  }

  const totalBytes = os.totalmem();
  const totalGb = totalBytes / GB;
  const availGb = Math.max(0, totalGb - RESERVED_GB);

  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus().length;

  const rec = recommend(totalGb, availGb);

  const ollama = (opts.install || opts['check-ollama']) ? await checkOllama() : null;

  if (opts.json) {
    console.log(JSON.stringify({
      system: { platform, arch, cpus, total_ram_gb: Number(totalGb.toFixed(2)),
                reserved_gb: RESERVED_GB, avail_ram_gb: Number(availGb.toFixed(2)) },
      ollama,
      recommendation: rec.tier
        ? { tier: rec.tier.name, model: rec.tier.model, size_gb: rec.tier.size_gb }
        : { tier: null, reason: rec.reason },
    }, null, 2));
  } else {
    console.log('System profile');
    console.log(`  Platform:        ${platform} ${arch}`);
    console.log(`  CPU cores:       ${cpus}`);
    console.log(`  Total RAM:       ${totalGb.toFixed(1)} GB`);
    console.log(`  Reserved (OS+):  ${RESERVED_GB} GB`);
    console.log(`  Available:       ${availGb.toFixed(1)} GB`);
    console.log('');
    if (ollama) {
      if (ollama.installed) console.log(`  Ollama:          installed (${ollama.version})`);
      else                  console.log(`  Ollama:          NOT INSTALLED  (${ollama.error})`);
      console.log('');
    }
    console.log('Tier recommendation');
    if (!rec.tier) {
      console.log(`  ✗ ${rec.reason}`);
      console.log('  Local LLM extraction is not viable on this machine.');
      console.log('  Options: deploy on a larger host, or wire a cloud LLM adapter.');
      process.exit(2);
    }
    console.log(`  → ${rec.tier.name}  (${rec.tier.model})`);
    console.log(`  Model size:      ~${rec.tier.size_gb} GB`);
    console.log(`  ${rec.tier.note}`);
    console.log('');
    console.log('Override with env var: LLM_MODEL=<ollama-tag>');
  }

  if (opts['check-ollama'] && ollama && !ollama.installed) {
    console.error('\nOllama not found. Install:');
    console.error('  macOS:   brew install ollama');
    console.error('  Linux:   curl -fsSL https://ollama.com/install.sh | sh');
    console.error('  Windows: download from https://ollama.com/download');
    process.exit(1);
  }

  if (opts.install && rec.tier) {
    if (!ollama || !ollama.installed) {
      console.error('\nOllama is required for --install. Install first (see --check-ollama).');
      process.exit(1);
    }
    console.log(`\nPulling ${rec.tier.model} via Ollama (may take several minutes)...`);
    const pull = await pullModel(rec.tier.model);
    if (!pull.ok) {
      console.error(`\nPull failed (exit ${pull.code ?? '?'}): ${pull.error || 'see output above'}`);
      process.exit(1);
    }
    console.log(`\n✓ ${rec.tier.model} is installed and ready.`);
    console.log('  Start the server: ollama serve');
    console.log('  Benchmark:        node bin/llm-benchmark.mjs');
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
