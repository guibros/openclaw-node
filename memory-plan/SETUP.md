# OpenClaw Memory Plan — Setup & Operations

How to enable, monitor, pause, and inspect the autonomous 30-minute tick.

---

## 1. Files map

```
memory-plan/
├── FRAMEWORK.md                # operational procedure (project-resolved)
├── FRAMEWORK_CANONICAL.md      # generic framework (for reference)
├── REFERENCE_PLAN.md           # the full implementation plan
├── INVENTORY.md                # 45 steps with status [ ]/[A]/[x]
├── VERSION_LOG.md              # append-only per-bump ledger
├── RESUME.md                   # cold-pickup state + §0 frozen decisions
├── VERSION                     # single-line version carrier (currently v0.0)
├── TICK_PROMPT.md              # prompt fed to headless claude on each tick
├── BLOCK_TEMPLATE.md           # template for BLOCKED.md
├── BLOCKED.md                  # PAUSE SIGNAL (present = plan paused)
├── SETUP.md                    # this file
├── audits/
│   └── stepNN_<slug>/          # one folder per step
│       ├── AUDIT_PRE.md
│       └── AUDIT_POST.md
└── tick-logs/
    └── YYYYMMDD-HHMMSS.log     # one log per tick invocation

workspace-bin/
└── memory-plan-tick.sh         # invoked by launchd
```

---

## 2. Manual first tick (recommended before enabling cron)

Before turning on the 30-min cron, run one tick by hand to verify the pipeline:

```bash
cd /Users/moltymac/openclaw
./workspace-bin/memory-plan-tick.sh
```

Then inspect:

```bash
ls -1t memory-plan/tick-logs/ | head -3
cat memory-plan/tick-logs/$(ls -1t memory-plan/tick-logs/ | head -1)
cat memory-plan/VERSION
git -C /Users/moltymac/openclaw log --oneline -5
```

A healthy first tick should:
- Read FRAMEWORK/RESUME/INVENTORY/VERSION
- Pre-flight: clean tree, VERSION=v0.0, next step = 0.1
- Run Phases 1 → 4 → 5 → 7 → 8 → 8.5 → 9 for Step 0.1
- Commit `v0.1 — Wire MemoryBudget.reload() into daemon flush paths + ...`
- Leave VERSION=v0.1, INVENTORY row 0.1 flipped `[x]`

If the tick blocks, `memory-plan/BLOCKED.md` will be present. Read it, address the cause, delete the file, then run again.

---

## 3. Enable the 30-min launchd cron

Create the plist at `~/Library/LaunchAgents/com.openclaw.memory-plan-tick.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.memory-plan-tick</string>

  <key>ProgramArguments</key>
  <array>
    <string>/Users/moltymac/openclaw/workspace-bin/memory-plan-tick.sh</string>
  </array>

  <key>StartInterval</key>
  <integer>1800</integer>  <!-- 30 minutes -->

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>/Users/moltymac/openclaw/memory-plan/tick-logs/launchd.stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/moltymac/openclaw/memory-plan/tick-logs/launchd.stderr.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>/Users/moltymac</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>/Users/moltymac/openclaw</string>
</dict>
</plist>
```

Then load it:

```bash
launchctl load -w ~/Library/LaunchAgents/com.openclaw.memory-plan-tick.plist
```

The next tick will fire 30 minutes after load. To trigger an immediate run:

```bash
launchctl kickstart -k gui/$(id -u)/com.openclaw.memory-plan-tick
```

---

## 4. Pause / resume the plan

**Pause** — write a `BLOCKED.md` file. The wrapper exits without invoking Claude.

```bash
cp memory-plan/BLOCK_TEMPLATE.md memory-plan/BLOCKED.md
# edit memory-plan/BLOCKED.md to describe the pause reason
```

**Resume** — delete `BLOCKED.md`. The next scheduled tick runs normally.

```bash
rm memory-plan/BLOCKED.md
```

**Hard-stop the cron** — unload the launchd job:

```bash
launchctl unload ~/Library/LaunchAgents/com.openclaw.memory-plan-tick.plist
```

---

## 5. Monitor

**What's the plan doing right now?**

```bash
cat memory-plan/VERSION
cat memory-plan/RESUME.md | head -20
ls -1 memory-plan/BLOCKED.md 2>/dev/null && echo "PLAN IS BLOCKED"
```

**What happened in the last tick?**

```bash
ls -1t memory-plan/tick-logs/ | head -1 | xargs -I{} cat memory-plan/tick-logs/{}
```

**How far has it gotten?**

```bash
grep -c '\[x\]' memory-plan/INVENTORY.md   # closed steps
grep -c '\[A\]' memory-plan/INVENTORY.md   # in-flight (should be 0 between ticks)
git log --oneline --grep='^v[0-9]' | head -10
```

**Streak tracking** — see the latest commit message; the streak counter is in the body.

```bash
git log -1
```

---

## 6. Make changes without breaking the plan

The framework treats most files as immutable inputs during a tick. If you need to:

- **Add a step** — edit `INVENTORY.md` and add a row. The numbering scheme is `v<block>.<step>`. Append to the relevant block's table.
- **Change a frozen decision** — edit `RESUME.md §0`. Best done while paused (BLOCKED.md present).
- **Re-scope a future block** — edit the relevant section of `REFERENCE_PLAN.md` AND add a carry-forward note to the prior block's exit doc.
- **Update the framework itself** — edit `FRAMEWORK.md`. Do not touch `FRAMEWORK_CANONICAL.md` (it's the generic-shape reference).
- **Update the tick prompt** — edit `TICK_PROMPT.md`. Be careful: the next tick reads it verbatim.

All these edits land in the next regularly-scheduled commit (whichever step is in flight at the time). They will appear in the Deep Review Gate's CHECK 4 union and need to be accounted for in the audit-pre §6 if they happen during a tick. **Strongly prefer editing while paused.**

---

## 7. Recovery cookbook

| Symptom | Likely cause | Recovery |
|---|---|---|
| `BLOCKED.md` present after a tick | Architectural decision needed, test failure, or Gate failure | Read `BLOCKED.md`, address cause, delete file |
| `VERSION` is `vX.Y-pre` between ticks | Tick exhausted budget mid-step | Next tick resumes from Phase 4 |
| `VERSION` is `vX.Y-mid` between ticks | Tick exhausted budget after V1 + verify | Next tick resumes from Phase 7 |
| Working tree dirty but `VERSION=vX.Y` (clean) | Human change snuck in | Either commit/stash by hand, or write BLOCKED.md and decide |
| `git log` last commit ≠ current `VERSION` | Phase 9 partial; either commit landed and ledger didn't update, or vice versa | Read `VERSION_LOG.md` and last audit-post to reconstruct; may need a hygiene step |
| Two consecutive `BLOCKED.md` for the same step | The step's frozen decisions are insufficient | Update `RESUME.md §0` (or the prior step's carry-forwards), then resume |

---

## 8. Stop conditions

The plan reaches "done" when:

- `INVENTORY.md` has no `[A]` or `[ ]` rows
- The last block-close ceremony doc (`audits/BLOCK_9_COMPLETE.md`) is present
- `RESUME.md` heading reads "All blocks closed"

At that point the wrapper logs `skip: plan is fully closed` and exits 0 forever, until you point the cron at a different plan or unload the launchd job.
