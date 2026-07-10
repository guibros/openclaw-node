# AUDIT_PRE — Step 1.1 · NATS cluster configs hardened + manifest/install wired + R=3 scratch proof

## §0 Micro Re-Orient (≤6 lines)

Block 1 / Step 1.1 of 25 open steps. Last step (0.2) produced `docs/FEDERATION_SPEC.md` — the
contract. This step lays the trust floor: harden the 3-node NATS configs (loopback+token, D2),
wire them into service-manifest + install.sh render path, and prove R=3 on scratch ports —
never touching the live :4222 bus (PID 1989, single-node at `~/.openclaw/nats/nats.conf`).
North-star line: "the floor the grappes stand on" (ROADMAP Block 1 intent). Still the right
next step: yes.

## §1 Intent

Close step 1.1: hardened NATS cluster configs in the repo, wired into install.sh's service
render loop, proven to form a functional R=3 cluster on scratch ports. The live :4222 bus is
untouched — cutover is the gated step 1.5 (D6).

## §2 Design (consume 0.2 carry-forwards)

**Key findings from the pre-screen:**

- Live NATS: PID 1989, `/Users/moltymac/.openclaw/nats/nats.conf` (single-node, loopback-only).
  Already loopback-only and no-auth. The repo's `services/nats/nats-{1,2,3}.conf` are
  NEVER-USED cluster templates — safe to harden and prove without touching PID 1989.
- Current conf defects (D2): `listen: 0.0.0.0:XXXX` (all-interfaces) and no `authorization`.
  Cluster routes already use `127.0.0.1` — only client/monitor listeners need fixing.
- Plist templates are in `services/nats/` but install.sh reads from `services/launchd/`. The
  nats plists also use `${OPENCLAW_REPO}` which is not a variable install.sh substitutes
  (it uses `${OPENCLAW_REPO_DIR}`). Both defects fixed by creating correct templates in
  `services/launchd/`.
- service-manifest.json has no NATS entries. Three entries with `role: "both"` and
  `autostart: false` needed.
- install.sh reads OPENCLAW_NATS_TOKEN from env/openclaw.env but doesn't generate one.
  Adding: generate-if-absent (openssl rand -hex 32) + persist to openclaw.env, then render
  nats conf templates to `~/.openclaw/config/nats-{1,2,3}.conf`.
- OPENCLAW_NATS_TOKEN: not currently set in openclaw.env on this node (env file has
  OPENCLAW_NATS=nats://100.91.131.61:4222 but no token line). Token generation IS part of
  this step.
- nats CLI at `/opt/homebrew/bin/nats`. Scratch ports 4322-4324/6322-6324/8322-8324: all free.
- `~/.openclaw/config/` is already created by install.sh Step 2 directory setup.
- 0.2 carry-forward: adoption-and-harden framing confirmed (spec §2.1). Cutover is 1.5's
  separate concern.

**Authorization token in NATS conf:** NATS configs do not expand env vars at runtime. Two
options: (a) rendered file at install time with the real token embedded, (b) a static token in
the scratch proof. Decision (here, not DECISIONS): use the template-render approach for
production configs (install.sh envsubst the conf templates to `~/.openclaw/config/`); scratch
proof uses a hardcoded test token in /tmp configs.

## §3 Risk register

| Risk | Mitigation |
|---|---|
| Scratch cluster formation takes >30s and times out | Use `sleep 5` + poll monitor API |
| nats CLI token test requires NATS CLI options I don't know | Use HTTP monitor API and direct nc or test-publish via nats CLI |
| install.sh token generation breaks existing installs | Conditional: generate only if `OPENCLAW_NATS_TOKEN` is empty after env file load |
| Scratch processes don't die cleanly and block future port use | Trap EXIT in test script; kill by PID explicitly; verify port free after |
| Atomicity tripwire: too many sub-steps | Planned upfront: 3 conf edits + 3 new plists + 1 manifest edit + 1 install.sh edit = one logical outcome; not a sprawl |

## §4 Needs pre-screen

| Need | Present? |
|---|---|
| `services/nats/nats-{1,2,3}.conf` | ✅ all three read |
| `services/nats/ai.openclaw.nats-{1,2,3}.plist` | ✅ present (source templates) |
| nats-server binary at `/opt/homebrew/bin/nats-server` | ✅ confirmed via `type` |
| nats CLI at `/opt/homebrew/bin/nats` | ✅ confirmed |
| Scratch ports 4322-4324 / 6322-6324 / 8322-8324 | ✅ all free (lsof shows no listeners) |
| `OPENCLAW_NATS_TOKEN` provisioned | ⚠ NOT currently in openclaw.env — generation is part of this step; no Need is MISSING, the generation gap is the step's work |
| FEDERATION_SPEC.md (0.2) | ✅ present |
| `~/.openclaw/config/` directory | ✅ created by install.sh Step 2 |

All Needs present. The token generation gap is the step's own work, not a blocker.

## §6 File-delta outline (§6 per PROTOCOL §3)

1. `services/nats/nats-1.conf` — `listen: 0.0.0.0` → `127.0.0.1`; add `authorization { token: "${OPENCLAW_NATS_TOKEN}" }`; monitor port bind to 127.0.0.1
2. `services/nats/nats-2.conf` — same for port 4223/6223/8223
3. `services/nats/nats-3.conf` — same for port 4224/6224/8224
4. `services/launchd/ai.openclaw.nats-1.plist` — new; correct variable names (`${OPENCLAW_REPO_DIR}`, `${HOME}`); conf path = rendered `${HOME}/.openclaw/config/nats-1.conf`
5. `services/launchd/ai.openclaw.nats-2.plist` — new; node 2
6. `services/launchd/ai.openclaw.nats-3.plist` — new; node 3
7. `services/service-manifest.json` — add `openclaw-nats-1/-2/-3` with `role: "both"`, `autostart: false`
8. `install.sh` — after env-file load (step 7): (a) generate OPENCLAW_NATS_TOKEN if empty and persist to openclaw.env; (b) render nats conf templates to `~/.openclaw/config/nats-{1,2,3}.conf`
