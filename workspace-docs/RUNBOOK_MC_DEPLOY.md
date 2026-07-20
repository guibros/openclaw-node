# RUNBOOK — Mission Control deploy (repo → live tree)

Distilled from the 2026-07-18 deploy (audits/mc_auth). The live service does NOT run from the
repo: launchd (`ai.openclaw.mission-control`, `npm start`) execs from
`~/.openclaw/workspace/projects/mission-control/`. Repo changes reach :3000 only via this
procedure. Type-only changes need no deploy.

## The two landmines (both bit us)
1. **Lockfile npm-major skew** — CI and `npm ci` validate with npm 10 (Node 20/22); a lockfile
   touched by local npm 11 prunes entries npm 10 requires. ALWAYS install/regenerate with
   `npx -y npm@10`.
2. **Node ABI skew** — the service's plist PATH resolves an fnm-managed Node 22 (ABI 127), NOT
   /usr/local/bin node (24, ABI 137). better-sqlite3 built under the wrong node → every DB route
   500s while the app "runs". Rebuild native deps under the service's exact PATH.

## Procedure
```bash
D=~/.openclaw/workspace/projects/mission-control
# 1. Sync (env + data preserved; node_modules/.next rebuilt in place)
rsync -a --delete --exclude .env.local --exclude node_modules --exclude .next --exclude data \
  ~/openclaw-nodedev/mission-control/ $D/
# 2. Deps + build with npm 10
cd $D && npx -y npm@10 ci && npm run build
# 3. Native rebuild under the SERVICE's PATH (from the plist — fnm Node 22 first)
SVCPATH="$(plutil -p ~/Library/LaunchAgents/ai.openclaw.mission-control.plist | grep -o '"PATH" => ".*"' | cut -d'"' -f4)"
env PATH="$SVCPATH" npm rebuild better-sqlite3
# 4. Restart
launchctl kickstart -k gui/501/ai.openclaw.mission-control
```

## Verify (all must hold — matrix from audits/mc_auth)
```bash
TOK=$(cat ~/.openclaw/config/mc-session-token)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/                       # 200
curl -s http://127.0.0.1:3000/api/system/health | head -c 80                          # real JSON, not ABI error
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/resolve-path  # 401 (auth gate up)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/resolve-path \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"name":"x"}'  # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' http://127.0.0.1:3000/api/tasks  # 403
```
Browser tabs open from before the deploy need one refresh to pick up the session cookie.
