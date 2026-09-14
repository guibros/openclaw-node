# CORRECTION — the "211 environmental failures" were mine, not the environment's

**Found:** 2026-09-14, Montreal, running the ROADMAP's block-exit gates after the plan blocked.

## The claim that was wrong

Every step closed in this session's lineage quoted a root-suite figure like "2199 / 1913 pass /
**211 fail**", and described the 211 as *"this container's standing environmental failures (no NATS,
no ollama, no `~/.openclaw` runtime)"*. That sentence is in several commit messages, in step audits,
and in PR #12's body.

It is wrong. Rebuilding one native module:

```
npm rebuild better-sqlite3
```

takes the same suite to **2198 tests / 2191 pass / 0 fail / 7 skipped**, confirmed on two
consecutive runs. Every one of the 211 was `better-sqlite3`'s bindings file failing to load.

## Where it came from

I installed dependencies with `npm ci --ignore-scripts` early in the session, which skips the native
build. `require('better-sqlite3')` then succeeds and `new Database(...)` throws `Could not locate the
bindings file` — so the failure surfaces deep inside 60-odd store, extraction, consolidation and
HyperAgent suites rather than as one obvious "install is broken" error. It looked exactly like an
un-provisioned container, and I read it as one.

## What should have caught it sooner

**CI was reporting `# fail 0` the whole time.** The first job log I read for the audit-gate failure
said `# tests 2293 · # pass 2287 · # fail 0` — and I quoted that number in the same breath as my own
211 without ever reconciling the two. CI runs plain `npm ci`, so it built the binding; my container
did not. Two numbers that disagree by 211 are a question, not a coincidence, and I treated the
difference as a property of the environment instead of investigating it.

The one place it did get caught was Mission Control, where the same `--ignore-scripts` broke
`hyperagent-read.test.ts`, I ran `npm rebuild better-sqlite3` and the suite went green. I fixed the
symptom in `mission-control/` and never asked whether the root install had the same wound.

## What this does and does not change

**Does not change: the regression conclusions.** Every comparison was like-for-like — baseline and
branch run in the same container with the same missing binding, failure lists diffed by name and
identical both ways. "Zero regressions" holds at every step. Nothing was merged on a false green.

**Does change: the branch's health as described.** "211 failures we cannot do anything about" and
"0 failures, suite fully green" are materially different statements about the same code, and only
the second one is true. The step audits' numbers stay as they were recorded — they are an honest log
of what the runs printed — but this file is the correction they should be read against.

## Also verified in the same pass

The ROADMAP's block-exit gates, run rather than trusted:

| Gate | Result |
|---|---|
| root suite, binding present | **2191 / 2198, 0 fail**, twice |
| Mission Control suite | 149 / 149; `eslint .` exit 0; `tsc --noEmit` clean |
| `plan-lint.sh integrations` | 20 PASS · 1 WARN · 0 FAIL → CONFORMANT |
| `skill-routing-eval` | **836 / 836 = 100.0%**; none of the eight skills added here appear in the collision or over-triggered lists |
| `skill-audit --min-grade B` × 8 | all exit 0 — 100, 100, 100, 100, 100, 95, 93, 88 |
| `docs/diagrams/*.html` | 0 external font references in both files |
| `config/harness-rules.json` | 14 rules; `lazy-senior-ladder` present, tier 2, `["local","mesh"]`, `post_validate → bash ./bin/check-added-deps.sh` |
| `bin/node-acceptance.mjs` | **GATE: REJECTED** — see below |

`node-acceptance` is rejected for the reason MASTER_PLAN §4.1 exists: `L0-DEPLOY` reports the deploy
surface missing (no `~/.openclaw/workspace/bin/memory-daemon.mjs`, no `lib/`, no event-schemas
`dist`), and NATS, ollama and the embedder cache are all absent. That is not this branch's failure —
there is no deployment in this container to accept. It is the same `install.sh --update` item
`BLOCKED.md` already carries, and it stays with the operator.

One genuine signal did come out of it: `MEM-L2-INGEST` went from FAIL to **PASS** on the rebuild,
which is what started this correction.

Note for anyone comparing: CI counts 2293 tests where this container counts 2198. Not investigated —
CI's `pretest` builds the workspaces, which likely enables suites that cannot run here. Recorded as
an open discrepancy rather than explained away.
