# Workplan viewer access

Run `node workspace-bin/workplan-viewer.mjs` from the repository, then open
`http://localhost:7892`. The service listens on loopback only. Set
`WORKPLAN_ROOTS` to colon-separated plan directories and `WORKPLAN_VIEWER_PORT`
to change the port.

The first startup creates an owner-private random access key at
`~/.openclaw/config/workplan-viewer-token`. `WORKPLAN_VIEWER_TOKEN_FILE` overrides
that path. Paste the key into the sign-in form; do not put it in the address bar.
An existing key file must be a regular file owned by the service user with no
group or other permissions. Invalid files prevent startup.

The browser retains a separate session in tab session storage. Sessions expire
after four hours and are invalidated by sign-out, service restart or key
rotation. Restored browser tabs can retain session storage; closing a tab is
not a revocation mechanism. The master key is not saved in browser storage.

Private APIs and live streams require `Authorization: Bearer <key-or-session>`.
Requests with foreign Host, Origin or fetch metadata are rejected. No cookies,
URL tokens or HTTP Basic credentials grant access. Machine callers can read the
key from its private file; `node-watch` uses authenticated plan discovery to
check health. Notification testing uses `POST /api/notify-test`.

Replacing the private key file with a new 64-character lowercase hexadecimal
key invalidates all existing browser sessions and closes active streams within
one second. Preserve mode `0600` and ownership when rotating. Stopping the
service also invalidates browser sessions. A historical log stream stays on
the file selected when it opened; select the log again after replacement.

The viewer still operates each plan's existing automation configuration.
Signing in does not start a scheduler or a tick. Automation remains a local
operator capability, and enabling a plan still requires an explicit decision.
