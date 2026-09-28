# Step 1.1 — SQLite recovery snapshots

Closed after Claude's independent Message 68 review of e750e3e on 2026-09-28.

## 1 — Promised versus landed

| Promise | Landed | Evidence |
|---|---|---|
| Read-only pinned source transactions feed SQLite backup | yes | Deployed helper 89f4a965 ran against twelve WAL stores; source connections load no extension |
| Isolated restores match physical content and metadata | yes | 116 physical-table typed/rowid digests, schema/header/FK results and file hashes match |
| Native FTS/vector checks without repair | yes | Six rank=1 FTS checks and eight first/last vector probes; restored hashes unchanged |
| Owner-engine claims are accurate | yes | Gateway SQLite 3.50.4/vec 0.1.9; daemon/knowledge 3.49.2/0.1.7; MC 3.53.2; Codex/lcm compatibility only |
| Store coverage and private durable manifests | yes | Unknown headers/links refused; exact exclusions recorded; atomic fsynced manifests; dirs 0700/files 0600 |
| Focused fixtures and existing baseline green | yes | Seven Python fixtures and native fixtures pass from deployed copies; e750e3e Node20/22 and MC CI green, explicit recovery CI step executed |
| Services remain running without source repairs | yes | Gateway/MC/daemon/viewer/watcher PIDs and supervisor run counts unchanged |
| Independent follow-up acceptance | yes | Message 68: no source blocker; child 1.1 can close. Independent gateway engine fixture, seven Python fixtures, corruption and four-writer regressions pass |

## 2 — Greppable deltas

`rg -n 'inventory_stores|reader.backup|pinnedAt|os.replace' backup_verify.py`
finds coverage, snapshot, time and atomic-publication paths. `rg -n
'node:sqlite|selfDistanceZero|integrity-check' verify_native.cjs` finds native
owner-engine, representative vector and rolled-back FTS checks. Full commands
and observed runtime versions are in RECOVERY.md and RUNTIME_EVIDENCE.md.

## 3 — Cross-references

The roadmap and inventory keep JetStream recovery at 1.2 and a final coordinated
application/bus point at 1.3. Parent node-readiness 1.3 remains open. Both chains
stay unloaded. No source storage, application configuration or topology changed.

## 4 — Findings

[POSITIVE] Snapshots survive active writers and preserve physical content. Claude
independently rejected five defective digest/pinning mutants and exercised
additional corruption, precision and four-process concurrency cases.

[POSITIVE] Installed owner engines read their actual restored tables. Application
initialization and index rebuilds are excluded from verification.

[NEGATIVE] Faithful copies can preserve structurally valid incorrect application
values. Vector self-queries are representative, not exhaustive corruption scans.
The twelve snapshots are individual points, not a coordinated recovery set.

[NEGATIVE] Inventory scanning fails closed on files disappearing during atomic
rename churn. This does not invalidate the verified set; 1.3 must handle ENOENT
while retaining declared-store and unknown-header refusal before taking the
coordinated set. Source commits overlapping a production pin are not claimed;
concurrency acceptance rests on the independent writer fixtures.

## 5 — Phase 8 patches

The owner-engine, coverage, manifest durability and fixture CI corrections were
implemented and rerun before this audit. No unrelated patches.

## 6 — Feeds and carry-forwards

Runtime tools, private snapshots, isolated restores and the manifest live under
`~/.openclaw/backups/node-readiness/sqlite-20260928-verified-3/`; the next recovery
steps consume the deployed helpers and verified mechanism. Source/runbook/fixture
commands live in this audit directory and PR #143.

For 1.2: preserve standalone and cluster histories separately, including member
1's offline R=1 stores, and explicitly treat health-stream expiry. For 1.3:
identify/drain all writers; include raw JSONL, file cursors and configuration
needed for application replay; capture coupled consumer positions in a common
quiet window. Do not resume execution from an inconsistent restored set.
Classify primary versus derived data, include the gateway memory-source files,
vault, tokens/configuration, notification ledger and foreman timelines, and
explicitly decide browser-profile recovery. Copies on this disk provide logical
rollback; they do not protect against loss of the entire machine.
