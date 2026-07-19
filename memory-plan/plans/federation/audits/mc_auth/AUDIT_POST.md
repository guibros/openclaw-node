# AUDIT_POST — MC auth middleware LIVE (queue item 3)

**Closed:** 2026-07-18 evening. Operator-chosen design (cookie + origin gate) implemented by a
confined subagent, deployed by the orchestrator, verified live 8/8.

## Shipped
- `mission-control/src/middleware.ts` (Node runtime — manifest-verified: registered in
  functions-config-manifest with runtime "nodejs", edge manifest empty) + pure
  `src/lib/server-auth.ts` (`decide()`, token file `~/.openclaw/config/mc-session-token`
  auto-generated 0600 atomic, timingSafeEqual) + 16 vitest cases (98/98 total). Host allowlist on
  everything (rebinding kill), cookie bootstrap on page loads (loading the dashboard IS the
  login), mutations require SameSite=Strict `mc_session` cookie or `Authorization: Bearer`
  (scripts), Origin allowlist on mutations (CSRF kill). `dev` script gains `-H 127.0.0.1`.
  Next 16 note: `middleware` convention is deprecated toward `proxy.ts` — works fully today,
  rename ledgered.
- Gates: tsc 0, eslint 0 errors, build green, vitest 98/98.

## Live verification (deployed tree ~/.openclaw/workspace/projects/mission-control, :3000)
Deploy: rsync (env/data preserved) + npm@10 ci + build + kickstart. Two real defects caught by
the runtime matrix, both fixed and re-verified:
1. better-sqlite3 ABI mismatch — the service's PATH resolves an fnm Node 22 (ABI 127), not
   /usr/local/bin node 24 (ABI 137); rebuilt under the service's exact PATH.
2. (From the first matrix run only — resolved by the rebuild.)

Final matrix (all observed): bare POST **401** · forged-Origin POST (even with valid Bearer)
**403** · Bearer POST **200** · page load sets mc_session **✓** · cookie POST **200** · Host
evil **403** · wrong bearer **401** · GET /api/tasks **200** · SSE streams fine · health
endpoint reports honest app-level status (degraded, 537 tasks, 420MB DB).

Before this change, `fetch("http://127.0.0.1:3000/api/system/restart",{method:"POST"})` from any
webpage executed. Now: 401/403.

## Notes
- Any MC tab open from before the deploy needs one refresh to receive the cookie.
- Ledgered: proxy.ts rename (Next deprecation), GET routes remain open by chosen scope (path
  jails still guard file readers), deployed-tree drift risk (Jul 3 → now synced; the rsync +
  rebuild procedure is the de facto deploy runbook and belongs in a script eventually).
