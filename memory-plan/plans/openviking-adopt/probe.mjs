// probe.mjs — Blocks 1+2 deploy-and-verify on the node, run by deploy.sh.
//
// One knowledge index pass (applies knowledge schema v2 and builds the
// directory summaries, LLM-written if Ollama answers), then the INVENTORY
// runtime probes for 1.1 / 2.1 / 2.2. Prints human lines plus machine lines
// `STEP <id> <PASS|FAIL|PENDING> <detail>` that deploy.sh records.
//
// Env: KNOWLEDGE_ROOT, KNOWLEDGE_DB (as the MCP server uses them).
// PROBE_SKIP_INDEX=1 skips the embedder-dependent parts (container smoke).

import { join } from 'node:path';

const root = process.env.KNOWLEDGE_ROOT || process.cwd();
const core = await import(join(process.cwd(), 'lib/mcp-knowledge/core.mjs'));
const ds = await import(join(process.cwd(), 'lib/mcp-knowledge/directory-summaries.mjs'));

const out = (id, status, detail) => console.log(`STEP ${id} ${status} ${detail}`);

const db = core.initDatabase(core.DB_PATH);
const version = db.pragma('user_version', { simple: true });
console.log(`knowledge db ${core.DB_PATH} user_version=${version}`);
if (version < 2) out('2.1', 'FAIL', `knowledge schema is v${version}, expected ≥2 (is lib/ the new checkout?)`);

if (process.env.PROBE_SKIP_INDEX === '1') {
  out('1.1', 'PENDING', 'PROBE_SKIP_INDEX=1');
  out('2.1', 'PENDING', 'PROBE_SKIP_INDEX=1');
  out('2.2', 'PENDING', 'PROBE_SKIP_INDEX=1');
  db.close();
  process.exit(0);
}

// LLM for directory abstracts, if the local model answers.
let llmClient = null;
if (process.env.KNOWLEDGE_SUMMARY_LLM !== '0') {
  try {
    const { createLlmClient } = await import(join(process.cwd(), 'lib/llm-client.mjs'));
    const c = createLlmClient();
    const h = await c.healthCheck();
    if (h.ok) { llmClient = c; console.log(`llm reachable (${h.model}); directory abstracts will be model-written`); }
    else console.log(`llm not reachable (${h.error}); deterministic abstracts`);
  } catch (e) { console.log(`llm client unavailable: ${e.message}`); }
}

console.log(`index pass over ${root} …`);
const t0 = Date.now();
const r = await core.indexWorkspace(db, root, { llmClient });
console.log(`indexed ${r.indexed}, unchanged ${r.skipped}, removed ${r.deleted}, files ${r.total}; directories built ${r.directories.built}, unchanged ${r.directories.unchanged}, upgraded ${r.directories.upgraded}, llm ${r.directories.llm} (${Math.round((Date.now() - t0) / 1000)}s)`);

// 2.1 — every directory has an abstract; tree depth 2 readable.
const stats = core.getStats(db);
const tree = ds.listDirectoryTree(db, { depth: 2 });
const empty = tree.filter((t) => !t.abstract);
if (stats.directories > 0 && empty.length === 0) {
  out('2.1', 'PASS', `directory_summaries=${stats.directories}; knowledge_tree depth 2 → ${tree.length} rows, all with abstracts`);
  for (const t of tree.slice(0, 12)) console.log(`  ${'  '.repeat(t.depth)}${t.dir_path || '(root)'}/ — ${t.abstract.slice(0, 90)}`);
} else {
  out('2.1', 'FAIL', `directory_summaries=${stats.directories}, ${empty.length} without abstract`);
}

// 2.2 — LLM-written abstracts present when the model was reachable; a
// no-change re-pass makes zero LLM calls.
if (llmClient) {
  let calls = 0;
  const counting = { generateAnalysis: (...a) => { calls++; return llmClient.generateAnalysis(...a); } };
  const r2 = await core.indexWorkspace(db, root, { llmClient: counting });
  const llmRows = core.getStats(db).directories_llm;
  if (llmRows > 0 && r2.directories.built === 0 && (calls === 0 || r2.directories.upgraded === calls)) {
    out('2.2', 'PASS', `directories_llm=${llmRows}; no-change re-pass: built 0, llm calls ${calls} (all upgrades of deterministic rows)`);
  } else {
    out('2.2', 'FAIL', `directories_llm=${llmRows}, re-pass built ${r2.directories.built}, llm calls ${calls}`);
  }
} else {
  out('2.2', 'PENDING', `Ollama not reachable at probe time; ${core.getStats(db).directories_llm} llm-written rows so far. Re-run --probe with the model up.`);
}

// 1.1 — a scoped query stays inside its prefix; an unscoped one leaves it.
const prefixes = tree.filter((t) => t.depth === 1).map((t) => t.dir_path);
if (prefixes.length < 2) {
  out('1.1', 'PENDING', `only ${prefixes.length} top-level directories indexed; need ≥2 to prove scoping`);
} else {
  const [a, b] = prefixes;
  const q = 'memory decisions and daily notes';
  const scoped = await core.semanticSearch(db, q, 8, { pathPrefix: a });
  const scopedB = await core.semanticSearch(db, q, 8, { pathPrefix: b });
  const open = await core.semanticSearch(db, q, 20);
  const inA = scoped.every((h) => h.path === a || h.path.startsWith(a + '/'));
  const inB = scopedB.every((h) => h.path === b || h.path.startsWith(b + '/'));
  const openLeaves = open.some((h) => !(h.path === a || h.path.startsWith(a + '/')));
  if (scoped.length && scopedB.length && inA && inB && openLeaves) {
    out('1.1', 'PASS', `path_prefix=${a}/ → ${scoped.length} hits all inside; path_prefix=${b}/ → ${scopedB.length} inside; unscoped → ${open.length} hits spanning directories; hits carry dir_abstract=${open.every((h) => 'dir_abstract' in h)}`);
  } else {
    out('1.1', 'FAIL', `scoped(${a})=${scoped.length} inside=${inA}; scoped(${b})=${scopedB.length} inside=${inB}; unscoped leaves=${openLeaves}`);
  }
}

db.close();
