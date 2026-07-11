#!/usr/bin/env node
// openclaw-grappe — Grappe registry CLI (FEDERATION_SPEC §2.4, step 1.3)
//
//   openclaw-grappe form --id <id> --mode <mode> --members <n1,n2,n3>
//   openclaw-grappe status [--id <id>]
//   openclaw-grappe dissolve --id <id>
//
// KV bucket: GRAPPE_REGISTRY  key pattern: grappe.<id>
// Member freshness is read from MESH_NODE_HEALTH KV.


const GRAPPE_BUCKET = 'GRAPPE_REGISTRY';
const HEALTH_BUCKET = 'MESH_NODE_HEALTH';
const KEY_PREFIX    = 'grappe.';
const VALID_MODES   = ['adversarial', 'cooperative', 'collaborative'];

// ── NATS URL + optional token ──────────────────────────────────────────────
// Env var only — the openclaw.env file may carry a remote Tailscale URL from
// the fleet-prototype era (D4/retired).  CLI defaults to loopback.

function resolveNats() {
  const url   = process.env.OPENCLAW_NATS        || 'nats://127.0.0.1:4222';
  const token = process.env.OPENCLAW_NATS_TOKEN  || undefined;
  return { url, token };
}

// ── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const [subcmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      opts[rest[i].slice(2)] = rest[i + 1] || true;
      i++;
    }
  }
  return { subcmd, opts };
}

// ── KV helpers ─────────────────────────────────────────────────────────────

async function openKv(js, bucket, createOpts = {}) {
  return js.views.kv(bucket, createOpts);
}

function encode(sc, obj) {
  return sc.encode(JSON.stringify(obj));
}

function decode(sc, entry) {
  return JSON.parse(sc.decode(entry.value));
}

// ── Commands ───────────────────────────────────────────────────────────────

async function cmdForm(nc, sc, opts) {
  const { id, mode, members: membersRaw } = opts;
  if (!id)          return die('--id required');
  if (!mode)        return die('--mode required');
  if (!membersRaw)  return die('--members required (comma-separated node ids)');
  if (!VALID_MODES.includes(mode)) return die(`--mode must be one of: ${VALID_MODES.join(', ')}`);

  const members = membersRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (members.length < 1) return die('--members must have at least one node id');

  const manifest = {
    id,
    mode,
    members,
    formed_at: new Date().toISOString(),
    status: 'live',
    join_token_hash: null,   // step 1.4 fills this in
  };

  const js = nc.jetstream();
  // Create bucket if absent (ttl=0 → no expiry; history=1 → latest value only)
  const kv = await openKv(js, GRAPPE_BUCKET, { history: 1 });
  await kv.put(KEY_PREFIX + id, encode(sc, manifest));

  console.log(`formed grappe ${id} (${mode}, ${members.length} members): ${members.join(', ')}`);
}

async function cmdStatus(nc, sc, opts) {
  const js = nc.jetstream();

  // Open grappe registry (may not exist yet — surface a clear error)
  let kvGrappe;
  try {
    kvGrappe = await openKv(js, GRAPPE_BUCKET, { history: 1 });
  } catch (e) {
    return die(`GRAPPE_REGISTRY bucket not found — run \`openclaw-grappe form\` first (${e.message})`);
  }

  // Open health bucket for member freshness (non-fatal if absent)
  let kvHealth = null;
  try {
    kvHealth = await openKv(js, HEALTH_BUCKET, { history: 1 });
  } catch { /* no health data — show UNKNOWN */ }

  // Collect matching keys
  const grappeKeys = [];
  const filterById = opts.id ? KEY_PREFIX + opts.id : null;
  try {
    for await (const key of await kvGrappe.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      if (filterById && key !== filterById) continue;
      grappeKeys.push(key);
    }
  } catch (e) {
    return die(`could not list GRAPPE_REGISTRY keys: ${e.message}`);
  }

  if (grappeKeys.length === 0) {
    const suffix = opts.id ? ` with id "${opts.id}"` : '';
    console.log(`no grappes found${suffix}`);
    return;
  }

  const now = Date.now();

  for (const key of grappeKeys.sort()) {
    const entry = await kvGrappe.get(key);
    if (!entry || entry.operation === 'DEL' || entry.operation === 'PURGE') continue;
    const g = decode(sc, entry);

    const headerLine = `Grappe ${g.id} (${g.mode}) — ${g.status}`;
    console.log(headerLine);
    console.log(`  Formed:   ${g.formed_at}`);
    console.log(`  Members:`);
    for (const memberId of g.members) {
      let freshness = 'UNKNOWN';
      if (kvHealth) {
        try {
          const hEntry = await kvHealth.get(memberId);
          if (hEntry && hEntry.created) {
            const ageMs = now - hEntry.created.getTime();
            const ageSec = Math.floor(ageMs / 1000);
            freshness = ageSec <= 60 ? `LIVE  ${ageSec}s ago` : `STALE ${ageSec}s ago`;
          }
        } catch { /* leave as UNKNOWN */ }
      }
      console.log(`    ${memberId.padEnd(12)} ${freshness}`);
    }
    console.log('');
  }
}

async function cmdDissolve(nc, sc, opts) {
  const { id } = opts;
  if (!id) return die('--id required');

  const js = nc.jetstream();
  let kv;
  try {
    kv = await openKv(js, GRAPPE_BUCKET, { history: 1 });
  } catch (e) {
    return die(`GRAPPE_REGISTRY bucket not found: ${e.message}`);
  }

  const entry = await kv.get(KEY_PREFIX + id);
  if (!entry || entry.operation === 'DEL' || entry.operation === 'PURGE') {
    return die(`grappe "${id}" not found`);
  }

  const manifest = decode(sc, entry);
  manifest.status = 'dissolved';
  await kv.put(KEY_PREFIX + id, encode(sc, manifest));
  console.log(`dissolved grappe ${id}`);
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  const { subcmd, opts } = parseArgs(process.argv.slice(2));

  const USAGE = `usage: openclaw-grappe <form|status|dissolve> [options]
  form     --id <id> --mode <mode> --members <n1,n2,...>
  status   [--id <id>]
  dissolve --id <id>`;

  if (!subcmd || subcmd === '--help' || subcmd === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const { url, token } = resolveNats();
  const { connect, StringCodec } = await import('nats');
  const nc = await connect({ servers: url, timeout: 5000, ...(token ? { token } : {}) });
  const sc = StringCodec();

  try {
    switch (subcmd) {
      case 'form':     await cmdForm(nc, sc, opts);     break;
      case 'status':   await cmdStatus(nc, sc, opts);   break;
      case 'dissolve': await cmdDissolve(nc, sc, opts); break;
      default:
        console.error(`unknown subcommand: ${subcmd}\n${USAGE}`);
        await nc.drain();
        process.exit(1);
    }
  } finally {
    await nc.drain();
  }
}

main().catch(err => {
  console.error(`openclaw-grappe: ${err.message}`);
  process.exit(1);
});
