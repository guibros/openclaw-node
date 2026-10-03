# Read-only legacy NATS configuration census — 2026-10-03 09:47 EDT

The live diagnostic now reopens the four installed GUI NATS plists and their
declared `--config` files. It requires the exact installed plist path and
argument shape, and compares a loaded GUI job's earlier plist observation
with the reopened installed file. The binary argument must be an absolute
`nats-server` path; its executable identity is not approved by this check.
Each current config must be a single-link,
owner-owned 0600 regular file under 1 MiB. The report carries a fresh-key
HMAC, filesystem identity and size, without publishing config bytes or a
reusable secret hash. A config containing any `include` token or `$` refuses
because include and environment-substitution dependencies have not been declared.
Only the em dash already present in this node's template comments is allowed
as non-ASCII. Other non-ASCII bytes refuse regardless of line position: NATS
lowercases the Unicode dotted-I spelling of `include`, and a line-based
comment exemption can miss it after a semicolon.

The config files and installed plists are read twice around the listener and
store scan. Their same-key HMACs and filesystem identities must agree within
that bracket. The fresh key means HMAC values from separate runs cannot be
compared. On this node, the read-only census accepted all four installed
plists and configs. The focused live/holder suites passed 35 tests. No
service, config, store or root state changed.

This observes current disk inputs only. A running NATS process may have loaded
earlier config bytes; the scan is not an atomic observation or a full-node
static dependency closure. Loaded environment and other plist settings are
not compared with the installed file. System-domain jobs need their own protected
configuration identity after migration. The report continues to set
`physical_absence_certified: false`. Step 1.2 remains active: the full-node
hold and process watch, protected root observer, three healthy cold masters,
isolated restores and resumption evidence are still required.
