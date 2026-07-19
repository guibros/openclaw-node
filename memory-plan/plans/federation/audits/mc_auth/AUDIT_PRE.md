# AUDIT_PRE — MC auth middleware (queue item 3, operator-chosen: cookie + origin gate)

**Written:** 2026-07-18 ~17:45 EDT, before code. Operator picked "Cookie + origin gate" via
AskUserQuestion after the ground-truth inventory (agent report summarized below).

## Ground truth (inventoried, file-verified)
- 39 non-GET handlers under mission-control/src/app/api/; 38 mutate (resolve-path is read-only).
- ZERO inbound auth anywhere: no middleware.ts exists, no route checks Authorization/remoteAddress.
  Existing guards are path-jails/input validation only (memory-file, workspace/read, screenshot…).
- Frontend: all relative `fetch`, zero header/token plumbing (a required header would break ~30
  call sites; a cookie rides along with zero client changes).
- Serving: `start` binds `-H 127.0.0.1`; `dev` has NO -H flag. next.config has no headers().
- Sharpest live threat is drive-by CSRF, not local port-scanning: any webpage can fire
  `fetch("http://127.0.0.1:3000/api/system/restart", {method:"POST"})` and MC executes it today
  (NextRequest.json() parses bodies regardless of content-type; no origin checks anywhere).
  DNS rebinding is the second remote-ish vector (attacker Host pointed at 127.0.0.1).

## Design (one middleware + one server lib, zero frontend changes)
`mission-control/middleware.ts` (Node runtime — needs fs+crypto), matcher `/((?!_next).*)`:
1. **Host allowlist** (all requests): Host must be 127.0.0.1[:port] or localhost[:port] → else
   403. Kills DNS rebinding; encodes the loopback contract at the app layer (the bind enforces it
   at the network layer).
2. **Cookie bootstrap** (non-/api page loads): valid Host + missing/stale `mc_session` cookie →
   set it (httpOnly, SameSite=Strict, path=/) to the session token. Loading the dashboard IS the
   login; the operator never sees an auth step.
3. **Mutation gate** (/api/*, method not GET/HEAD/OPTIONS):
   - If Origin header present: must be an allowed loopback origin → else 403 (CSRF kill — and
     SameSite=Strict already keeps the cookie off cross-site requests as a second layer).
   - Must present a valid credential: `mc_session` cookie OR `Authorization: Bearer <token>`
     (scripts/CLIs) — compared via timingSafeEqual (inject-server pattern, F-M13) → else 401.
   - GET/SSE routes stay open (read-only surface; per the chosen option scope).
4. **Token**: `~/.openclaw/config/mc-session-token`, auto-generated 32-byte hex, 0600, atomic
   write — same lifecycle as memory-injection-token. Loaded once per process, cached.
5. `dev` script gains `-H 127.0.0.1` (the missing bind).

## Verification contract
- Unit (vitest): pure `decide()` matrix — GET passes bare; POST bare → 401; POST bad-Origin →
  403; POST with cookie → allow; POST with Bearer → allow; wrong token → 401; Host evil → 403;
  bootstrap decision on page loads.
- Gates: tsc 0 errors, eslint 0 errors (CI lint gate is live), `next build` exit 0, full vitest.
- Runtime (orchestrator, against the live :3000 service after deploy): curl matrix — bare POST
  401; forged-Origin POST 403; Bearer POST 200; cookie-jar flow (GET / captures cookie → POST
  with jar 200); GET endpoints + one SSE stream unaffected; browser-equivalent flow works.

## Rules
Implementation delegated to a subagent confined to mission-control/* (+ these audit files via
orchestrator); no git from the agent; runtime deploy+verify+commit by the orchestrator.
