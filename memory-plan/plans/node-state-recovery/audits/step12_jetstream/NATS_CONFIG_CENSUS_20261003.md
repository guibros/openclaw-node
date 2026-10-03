# Read-only legacy NATS configuration census — 2026-10-03 09:47 EDT

The live diagnostic now reopens the four installed GUI NATS plists and their
declared `--config` files. It requires the exact installed plist path and
argument shape, and compares a loaded GUI job's earlier plist observation
with the reopened installed file. Each current config must be a single-link,
owner-owned 0600 regular file under 1 MiB. The report carries a fresh-key
HMAC, filesystem identity and size, without publishing config bytes or a
reusable secret hash. A config containing any `include` token or `$` refuses
because include and environment-substitution dependencies have not been declared.

On this node, the read-only census accepted all four installed plists and
configs. The focused live/holder suites passed 35 tests. No service, config,
store or root state changed.

This pins current disk inputs only. A running NATS process may have loaded
earlier config bytes; the scan is not an atomic observation or a full-node
static dependency closure. System-domain jobs need their own protected
configuration identity after migration. The report continues to set
`physical_absence_certified: false`. Step 1.2 remains active: the full-node
hold and process watch, protected root observer, three healthy cold masters,
isolated restores and resumption evidence are still required.
