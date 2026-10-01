# Step 3.11 — Actual five-timer commissioning evidence

2026-09-30 23:30–23:33 EDT, macOS owner session. No production secret or
environment value is copied into this record.

## Exact inputs

- Reviewed timer-entry manifest SHA-256:
  `96e829f379978d0b67e61d2464d3624e4a9d426e8671fac4dab1e9c5a47d4644`.
- Reviewed first-transition manifest SHA-256:
  `6e9b54f0a9e49c77901be7e97ac2cc48ea6a1c8fd2ea51824cd6c630e2df3e73`.
- Final owner-private, immutable controller manifest SHA-256:
  `bec1e5af6a9db7c6b2c0230d494471c4f211e74c6488bbf7ca356fb801a404e6`,
  root `~/.openclaw/backups/node-readiness/timer-hold-controller-20261001-3`.
  `/usr/bin/python3 -I -S .../timer-hold-control.py --verify <sha>` returned
  `{"outcome":"verified"}`. The staged installer file and reviewed worktree
  file have the same SHA-256.

## Safe refusal and correction

Before the first live call, all five jobs classified `old/old/old`, the
transition and installed receipts were absent, and the gate was open. The
first pinned controller stopped after four candidates had loaded because the
transcript-archive plist has no explicit `PATH`; `launchctl print` omits its
inherited value. It returned `refused: timer loaded delegated PATH differs`.
The active transition receipt remained, the gate was open, no scoped journal
or installed receipt existed, and the fifth job remained old. The four
candidate jobs classified `old/new/new` under the corrected read-only
classifier, while log-rotate remained `old/old/old`.

An owned launchd probe with the transcript-archive candidate environment
measured effective PATH hash
`6e53700166cb62101d9bcf4d31401a4b4b295fc410cfc38566d929087f94483b`,
equal to the pinned manifest. The corrected verifier probes inherited PATH
and continues to compare printed PATH for explicitly configured values. A
real owned Mac positive/negative probe test passed; no temporary probe job
remained loaded. Claude's delta review found no concrete blocker. The first
controller bundle was retired from use; the `-3` bundle above resumed from
the durable active receipt, without resetting the partially installed jobs.

## Live closed interval and reopen

`/usr/bin/python3 -I -S .../timer-hold-control.py --commission <final-sha>`
returned `{"gate":"open","outcome":"resolved","timers":5,
"window":"timer-88ee57ba9644fff17f253319c70f63f4"}`. The closed marker
was physically present during the interval. The terminal journal was read
with its hash-chain validator; its events include `hold-published`,
`verified`, `timer-inertness-proved`, `final-state-verified`,
`hold-reopen-ready`, `hold-opened`, `execution-hold-restored`,
`recovery-finished`, and `resolved`. The proof event records five forced
closed fires and two natural 60-second scheduled fires. For each, the
controller required a completed launchd run, exit 0, unchanged application
stdout/stderr sizes, and a still-present marker before recording proof.

The installed receipt exists, the active receipt is absent, the sole
preservation receipt is `restored` and names the same journal root, and the
terminal `resolved` hash equals its saved head. The physical gate marker is
absent. All five actual jobs classify `old` original source path, `new`
candidate plist, `new` loaded argv, idle. The loaded-state classifier checks
actual launchd argv/program, plist provenance, log paths, working directory,
configured environment, effective PATH, interval/calendar/RunAtLoad settings
and disabled override. Saved originals and candidate plists preserve every
schedule, environment, working-directory and log-path field; only the
reviewed gated ProgramArguments differ.

After reopen, the two 60-second jobs each advanced from launchd `runs=17`
to `runs=18`, were idle at observation, and had last exit code 0. Their
scheduled operation therefore continued with the gate open.

## Tests and limits

The focused owned Mac handoff/controller suite passed 16/16. The controlled
full Node 22 run with Python bytecode writes disabled, a deliberately
unavailable external mesh endpoint, and test concurrency four reported
2,529 tests: 2,523 pass, zero fail, six visible skips. The earlier default
run's Mac integration failures were not counted as a green pass; the
controlled rerun is the baseline evidence. No whole-node quiet-window,
Linux continuous-watch, global OS-spawn, or remote-inference cancellation
claim follows from this timer-only acceptance. Full-node recovery 1.2 and
other delegated writers remain separate work.
