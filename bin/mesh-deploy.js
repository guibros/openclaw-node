#!/usr/bin/env node

/**
 * mesh-deploy.js v2 — Full-stack OpenClaw deployment across all nodes.
 *
 * Covers EVERYTHING: mesh daemons, Mission Control, memory system,
 * soul system, skills, boot compiler, companion-bridge, OpenClaw
 * gateway, database migrations, config regeneration, service definitions.
 *
 * ARCHITECTURE:
 *   Each deployable component is defined in the MANIFEST with:
 *   - id:          unique name
 *   - source:      where the canonical files live (repo path or npm package)
 *   - targets:     where files get installed on each node
 *   - detect:      how to tell if something changed
 *   - install:     how to deploy the change
 *   - restart:     which services to bounce
 *   - validate:    how to confirm the deploy worked
 *   - risk:        "safe" (auto-deploy) | "careful" (warn) | "manual" (skip unless --force)
 *
 * USAGE:
 *   mesh deploy                         — deploy everything that changed
 *   mesh deploy --dry-run               — preview what would happen
 *   mesh deploy --component mc          — deploy only Mission Control
 *   mesh deploy --component mesh        — deploy only mesh daemons
 *   mesh deploy --component all         — deploy everything (even unchanged)
 *   mesh deploy --local                 — this node only
 *   mesh deploy --node ubuntu           — remote node only
 *   mesh deploy --include-services      — also update launchd/systemd units
 *   mesh deploy --rollback              — revert last deploy
 *   mesh deploy --status                — show what's deployed vs what's in git
 *
 * ENVIRONMENT:
 *   OPENCLAW_DEPLOY_BRANCH   — git branch (default: main)
 *   OPENCLAW_REPO_DIR        — repo location (default: ~/openclaw)
 *   OPENCLAW_NATS            — NATS server URL (from env or openclaw.env)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('mesh-deploy');

// ── Constants ────────────────────────────────────────────────────────────

const IS_MAC = os.platform() === 'darwin';
const HOME = os.homedir();
const DEPLOY_BRANCH = process.env.OPENCLAW_DEPLOY_BRANCH || 'main';
if (!/^[a-zA-Z0-9._\/-]+$/.test(DEPLOY_BRANCH)) {
  console.error(`Invalid DEPLOY_BRANCH: ${DEPLOY_BRANCH}`);
  process.exit(1);
}
const REPO_DIR = process.env.OPENCLAW_REPO_DIR || path.join(HOME, 'openclaw');

// KNOWN ISSUE: Two-directory problem
// ~/openclaw-node is the git repo (source of truth). mesh-deploy pulls into it,
// then copies files to ~/openclaw (the runtime location). These can drift if
// files are edited directly in ~/openclaw without back-porting to the repo.
// Resolution path: unify to a single directory. Either symlink ~/openclaw →
// ~/openclaw-node, or change REPO_DIR default + DIRS to point at the same tree.
// Until then, mesh-deploy.js is the only sanctioned way to propagate changes.

// Standard directory layout
const DIRS = {
  OPENCLAW_HOME:    path.join(HOME, '.openclaw'),
  WORKSPACE:        path.join(HOME, '.openclaw', 'workspace'),
  WORKSPACE_BIN:    path.join(HOME, '.openclaw', 'workspace', 'bin'),
  CLI_BIN:          path.join(HOME, 'openclaw', 'bin'),
  CLI_LIB:          path.join(HOME, 'openclaw', 'lib'),
  MC_PROJECT:       path.join(HOME, '.openclaw', 'workspace', 'projects', 'mission-control'),
  SKILLS:           path.join(HOME, '.openclaw', 'skills'),
  SOULS:            path.join(HOME, '.openclaw', 'souls'),
  CONFIG:           path.join(HOME, '.openclaw', 'config'),
  BOOT:             path.join(HOME, '.openclaw', 'workspace', '.boot'),
  BOOT_SRC:         path.join(HOME, '.openclaw', 'workspace', 'bin'),  // compile-boot lives here
  MEMORY:           path.join(HOME, '.openclaw', 'workspace', 'memory'),
  MEMORY_VAULT:     path.join(HOME, '.openclaw', 'workspace', 'memory-vault'),
  IDENTITY:         path.join(HOME, '.openclaw', 'identity'),
  SERVICES_MAC:     path.join(HOME, 'Library', 'LaunchAgents'),
  SERVICES_LINUX:   path.join(HOME, '.config', 'systemd', 'user'),
  COMPANION:        path.join(HOME, 'companion-adapter'),
  TMP:              path.join(HOME, '.openclaw', 'workspace', '.tmp'),
  DEPLOY_STATE:     path.join(HOME, '.openclaw', '.deploy-state.json'),
};

// Node role — determines which components deploy here.
// Reads from OPENCLAW_NODE_ROLE env, or openclaw.env, or defaults by platform.
function resolveNodeRole() {
  if (process.env.OPENCLAW_NODE_ROLE) return process.env.OPENCLAW_NODE_ROLE;
  try {
    const envFile = path.join(HOME, '.openclaw', 'openclaw.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      const match = content.match(/^\s*OPENCLAW_NODE_ROLE\s*=\s*(.+)/m);
      if (match && match[1].trim()) return match[1].trim();
    }
  } catch (err) { console.warn(`[mesh-deploy] resolve node role: ${err.message}`); }
  return IS_MAC ? 'lead' : 'worker';
}
const NODE_ROLE = resolveNodeRole();

// ── Console helpers ──────────────────────────────────────────────────────

const C = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

function ok(msg)     { console.log(`  ${C.green('[OK]')} ${msg}`); }
function warn(msg)   { console.log(`  ${C.yellow('[WARN]')} ${msg}`); }
function fail(msg)   { console.log(`  ${C.red('[FAIL]')} ${msg}`); }
function info(msg)   { console.log(`  ${C.cyan('-->>')} ${msg}`); }
function skip(msg)   { console.log(`  ${C.dim('[SKIP]')} ${msg}`); }
function header(msg) { console.log(`\n${C.bold(`═══ ${msg} ═══`)}\n`); }

// ── Shell helpers ────────────────────────────────────────────────────────

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      ...opts,
    }).trim();
  } catch (err) {
    if (opts.ignoreError) return err.stdout?.trim() || '';
    throw err;
  }
}

function fileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT MANIFEST — every deployable piece of OpenClaw
// ═══════════════════════════════════════════════════════════════════════════

const MANIFEST = [

  // ── MESH INFRASTRUCTURE ─────────────────────────────────────────────────

  {
    id: 'mesh-daemons',
    name: 'Mesh Daemons',
    description: 'Task daemon, bridge, agent, health publisher',
    risk: 'safe',
    repoPaths: ['bin/mesh-task-daemon.js', 'bin/mesh-bridge.js', 'bin/mesh-agent.js',
                'bin/mesh-health-publisher.js', 'bin/mesh-deploy-listener.js'],
    targets: [DIRS.CLI_BIN],
    // Lead runs all 4; worker runs only agent + health publisher.
    // Service names differ: macOS=launchd labels, Linux=systemd unit names.
    servicesMac: ['ai.openclaw.mesh-task-daemon', 'ai.openclaw.mesh-bridge',
                  'ai.openclaw.mesh-agent', 'ai.openclaw.mesh-health-publisher'],
    servicesLinux: ['openclaw-agent', 'openclaw-mesh-health-publisher'],
    nodeFilter: 'all',  // Every node gets daemon binaries; services are per-role
    validate: () => {
      const cmd = IS_MAC
        ? 'launchctl list ai.openclaw.mesh-task-daemon 2>/dev/null | grep PID'
        : 'systemctl is-active openclaw-agent 2>/dev/null';
      return exec(cmd, { ignoreError: true }).length > 0;
    },
  },

  {
    id: 'mesh-cli',
    name: 'Mesh CLI Tools',
    description: 'mesh command, health check, repair, deploy, fleet-deploy',
    risk: 'safe',
    repoPaths: ['bin/mesh.js', 'bin/mesh-deploy.js', 'bin/fleet-deploy.js',
                'bin/mesh-health.sh', 'bin/mesh-repair.sh'],
    targets: [DIRS.CLI_BIN],
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'all',
    postInstall: () => {
      const wrapperPath = path.join(DIRS.CLI_BIN, 'mesh');
      if (fs.existsSync(wrapperPath)) fs.chmodSync(wrapperPath, 0o755);
    },
  },

  {
    id: 'shared-lib',
    name: 'Shared Libraries',
    description: 'nats-resolve.js, agent-activity.js, kanban-io.js, mesh-registry.js, mesh-tasks.js',
    risk: 'safe',
    repoPaths: ['lib/'],
    targets: [DIRS.CLI_LIB],
    servicesMac: ['ai.openclaw.mesh-task-daemon', 'ai.openclaw.mesh-bridge',
                  'ai.openclaw.mesh-agent'],
    servicesLinux: ['openclaw-agent'],
    nodeFilter: 'all',
  },

  // ── MISSION CONTROL ─────────────────────────────────────────────────────

  {
    id: 'mc',
    name: 'Mission Control',
    description: 'Next.js dashboard — kanban, memory, souls, graph, calendar',
    risk: 'safe',
    repoPaths: ['mission-control/'],
    targets: [DIRS.MC_PROJECT],
    servicesMac: ['ai.openclaw.mission-control'],
    servicesLinux: [],  // MC only runs on lead
    nodeFilter: 'lead',
    postInstall: (changedFiles) => {
      const needsNpm = changedFiles.some(f =>
        f.includes('package.json') || f.includes('package-lock.json')
      );
      if (needsNpm) {
        info('Running npm install for Mission Control...');
        exec('npm install', { cwd: DIRS.MC_PROJECT, timeout: 180000 });
        ok('npm install complete');
      }
    },
    validate: () => {
      const dbPath = path.join(DIRS.MC_PROJECT, 'data', 'mission-control.db');
      return fs.existsSync(dbPath);
    },
    notes: 'DB migrations run automatically on MC startup via db/index.ts runMigrations(). ' +
           'New columns (ALTER TABLE) are idempotent. Schema-breaking changes need a ' +
           'migration plan before deploy.',
  },

  // ── MEMORY SYSTEM ───────────────────────────────────────────────────────

  {
    id: 'memory-daemon',
    name: 'Memory Daemon',
    description: 'Session recap, ClawVault maintenance, daily log generation, Obsidian sync',
    risk: 'safe',
    repoPaths: ['workspace-bin/memory-daemon.mjs', 'workspace-bin/memory-maintenance.mjs'],
    targets: [DIRS.WORKSPACE_BIN],
    servicesMac: ['ai.openclaw.memory-daemon'],
    servicesLinux: [],  // Lead only
    nodeFilter: 'lead',
  },

  {
    id: 'memory-harness',
    name: 'Memory Harness Templates',
    description: 'MEMORY.md template, extraction configs, consolidation rules',
    risk: 'careful',
    repoPaths: ['config/memory-config.json', 'config/extraction-rules.json'],
    targets: [DIRS.CONFIG],
    servicesMac: ['ai.openclaw.memory-daemon'],
    servicesLinux: [],
    nodeFilter: 'lead',
    notes: 'Does NOT overwrite MEMORY.md, memory-vault/, or daily logs — those are user data. ' +
           'Only deploys config templates that control extraction and consolidation behavior.',
  },

  // ── SOUL SYSTEM ─────────────────────────────────────────────────────────

  {
    id: 'souls',
    name: 'Soul Definitions',
    description: 'Daedalus and specialist soul files, trust registry, evolution config',
    risk: 'careful',
    repoPaths: ['souls/'],
    targets: [DIRS.SOULS],
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'all',
    preInstall: (changedFiles) => {
      for (const f of changedFiles) {
        if (f.includes('genes.json') || f.includes('events.jsonl')) {
          const targetPath = path.join(DIRS.SOULS, f.replace('souls/', ''));
          if (fs.existsSync(targetPath)) {
            const backupPath = targetPath + '.pre-deploy';
            fs.copyFileSync(targetPath, backupPath);
            info(`Backed up ${path.basename(targetPath)} → .pre-deploy`);
          }
        }
      }
    },
    notes: 'Evolution genes (genes.json) and event logs (events.jsonl) contain ' +
           'learned behavior. Pre-deploy backup is automatic.',
  },

  // ── SKILLS ──────────────────────────────────────────────────────────────

  {
    id: 'skills',
    name: 'Skill Library',
    description: 'Skill definitions for AI agent capabilities',
    risk: 'safe',
    repoPaths: ['skills/'],
    targets: [DIRS.SKILLS],
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'all',
  },

  // ── BOOT SYSTEM ─────────────────────────────────────────────────────────

  {
    id: 'boot',
    name: 'Boot Compiler',
    description: 'Profile-aware boot artifact generation (Python script)',
    risk: 'safe',
    repoPaths: ['workspace-bin/compile-boot'],
    targets: [DIRS.BOOT_SRC],  // = WORKSPACE_BIN (compile-boot lives there)
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'lead',
    postInstall: () => {
      const compilerPath = path.join(DIRS.BOOT_SRC, 'compile-boot');
      if (fs.existsSync(compilerPath)) {
        info('Recompiling boot profiles...');
        try {
          exec(`python3 "${compilerPath}"`, { cwd: DIRS.WORKSPACE });
          ok('Boot profiles recompiled');
        } catch (err) {
          warn(`Boot recompile failed: ${err.message}`);
        }
      }
    },
  },

  // ── WORKSPACE ROOT DOCUMENTS ────────────────────────────────────────────

  {
    id: 'workspace-docs',
    name: 'Workspace Root Documents',
    description: 'CLAUDE.md, SOUL.md, AGENTS.md, PRINCIPLES.md, HEARTBEAT.md',
    risk: 'careful',
    repoPaths: ['workspace-docs/CLAUDE.md', 'workspace-docs/SOUL.md',
                'workspace-docs/AGENTS.md', 'workspace-docs/PRINCIPLES.md'],
    targets: [DIRS.WORKSPACE],
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'all',
    preInstall: (changedFiles) => {
      for (const f of changedFiles) {
        const basename = path.basename(f);
        const targetPath = path.join(DIRS.WORKSPACE, basename);
        if (fs.existsSync(targetPath)) {
          const srcPath = path.join(REPO_DIR, f);
          const diff = exec(`diff "${targetPath}" "${srcPath}" | head -20`, { ignoreError: true });
          if (diff) {
            warn(`${basename} differs from repo version:`);
            console.log(C.dim(diff.split('\n').map(l => `      ${l}`).join('\n')));
            info(`Repo version saved to ${basename}.repo — merge manually if needed`);
            fs.copyFileSync(srcPath, targetPath + '.repo');
            return; // Don't overwrite
          }
        }
      }
    },
    notes: 'These files are your agent identity docs. They are NOT auto-overwritten. ' +
           'If the repo has updates, they are saved as .repo files for manual merge.',
  },

  // ── IDENTITY ────────────────────────────────────────────────────────────

  {
    id: 'identity',
    name: 'Node Identity',
    description: 'Node identity files, mesh enrollment config',
    risk: 'manual',
    repoPaths: ['identity/'],
    targets: [DIRS.IDENTITY],
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'all',
    preInstall: () => {
      if (fs.existsSync(path.join(DIRS.IDENTITY, 'device.json'))) {
        skip('Identity files already exist — skipping (use --force to overwrite)');
        return false;
      }
    },
  },

  // ── CONFIG TEMPLATES ────────────────────────────────────────────────────

  {
    id: 'config',
    name: 'Configuration',
    description: 'Daemon configs, transcript configs, sync settings',
    risk: 'careful',
    repoPaths: ['config/'],
    targets: [DIRS.CONFIG],
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'all',
    postInstall: () => {
      const templatePath = path.join(DIRS.CONFIG, 'openclaw.json.template');
      const envPath = path.join(DIRS.OPENCLAW_HOME, 'openclaw.env');
      if (fs.existsSync(templatePath) && fs.existsSync(envPath)) {
        info('Regenerating openclaw.json from template + env...');
        try {
          let template = fs.readFileSync(templatePath, 'utf8');
          const env = fs.readFileSync(envPath, 'utf8');
          for (const line of env.split('\n')) {
            const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)/);
            if (match) {
              template = template.replace(new RegExp(`\\$\\{${match[1]}\\}`, 'g'), match[2].trim());
            }
          }
          const outPath = path.join(DIRS.OPENCLAW_HOME, 'openclaw.json');
          fs.writeFileSync(outPath, template);
          ok('openclaw.json regenerated');
        } catch (err) {
          warn(`Config regen failed: ${err.message}`);
        }
      }
    },
    notes: 'openclaw.env is NEVER deployed — it contains API keys and is per-node.',
  },

  // ── SERVICE DEFINITIONS ─────────────────────────────────────────────────

  {
    id: 'services',
    name: 'Service Definitions',
    description: 'launchd plists (macOS) / systemd units (Ubuntu)',
    risk: 'manual',
    repoPaths: IS_MAC ? ['services/launchd/'] : ['services/systemd/'],
    targets: [IS_MAC ? DIRS.SERVICES_MAC : DIRS.SERVICES_LINUX],
    servicesMac: [],
    servicesLinux: [],
    nodeFilter: 'all',
    preInstall: () => {
      warn('Service definitions require --include-services flag');
      warn('A bad plist/unit can prevent services from starting');
      return false;
    },
    postInstall: () => {
      if (IS_MAC) {
        info('Plists updated — run this to reload:');
        console.log('    launchctl unload ~/Library/LaunchAgents/ai.openclaw.*.plist');
        console.log('    launchctl load ~/Library/LaunchAgents/ai.openclaw.*.plist');
      } else {
        info('Units updated — run: systemctl --user daemon-reload');
        exec('systemctl --user daemon-reload', { ignoreError: true });
      }
    },
  },

  // ── OPENCLAW GATEWAY (npm package) ──────────────────────────────────────

  {
    id: 'openclaw',
    name: 'OpenClaw Gateway',
    description: 'The TUI/gateway — installed globally via npm',
    risk: 'careful',
    repoPaths: [],
    targets: [],
    servicesMac: ['ai.openclaw.gateway'],
    servicesLinux: ['openclaw-gateway'],
    nodeFilter: 'all',
    detect: () => {
      try {
        const current = exec('openclaw --version 2>/dev/null', { ignoreError: true });
        const latest = exec('npm view openclaw version 2>/dev/null', { ignoreError: true });
        if (current && latest && current !== latest) {
          return { changed: true, current, latest };
        }
      } catch (err) { console.warn(`[mesh-deploy] detect openclaw version: ${err.message}`); }
      return { changed: false };
    },
    install: (dryRun) => {
      if (dryRun) {
        info('Would run: npm update -g openclaw');
        return;
      }
      info('Updating OpenClaw gateway...');
      exec('npm update -g openclaw', { timeout: 180000 });
      ok('OpenClaw updated');
    },
  },

  // ── COMPANION BRIDGE ────────────────────────────────────────────────────

  {
    id: 'companion',
    name: 'Companion Bridge',
    description: 'companion-bridge npm package + local adapter.ts patches',
    risk: 'careful',
    repoPaths: [],
    targets: [],
    servicesMac: ['ai.openclaw.gateway'],
    servicesLinux: ['openclaw-gateway'],
    nodeFilter: 'lead',
    detect: () => {
      try {
        if (fs.existsSync(DIRS.COMPANION)) {
          const status = exec('git status --porcelain', { cwd: DIRS.COMPANION, ignoreError: true });
          if (status) return { changed: true, reason: 'uncommitted local changes' };
        }
        const current = exec('npm ls companion-bridge --json 2>/dev/null', { ignoreError: true });
        const latest = exec('npm view companion-bridge version 2>/dev/null', { ignoreError: true });
        if (current && latest) {
          return { changed: !current.includes(latest), current, latest };
        }
      } catch (err) { console.warn(`[mesh-deploy] detect companion version: ${err.message}`); }
      return { changed: false };
    },
    install: (dryRun) => {
      if (dryRun) {
        info('Would update companion-bridge');
        return;
      }
      if (fs.existsSync(DIRS.COMPANION)) {
        info('Pulling companion-bridge source...');
        exec('git pull origin main', { cwd: DIRS.COMPANION, ignoreError: true });
        exec('npm install && npm run build', { cwd: DIRS.COMPANION, timeout: 120000 });
        ok('companion-bridge rebuilt');
      }
    },
  },

  // ── LANE WATCHDOG ───────────────────────────────────────────────────────

  {
    id: 'lane-watchdog',
    name: 'Lane Watchdog',
    description: 'Kanban lane health monitoring',
    risk: 'safe',
    repoPaths: ['bin/lane-watchdog.js'],
    targets: [DIRS.CLI_BIN],
    servicesMac: ['ai.openclaw.lane-watchdog'],
    servicesLinux: [],  // Lead only
    nodeFilter: 'lead',
  },

  // ── LOG ROTATION ────────────────────────────────────────────────────────

  {
    id: 'log-rotate',
    name: 'Log Rotation',
    description: 'Weekly log file rotation (copytruncate)',
    risk: 'safe',
    repoPaths: ['bin/log-rotate.sh'],
    targets: [DIRS.CLI_BIN],
    servicesMac: ['ai.openclaw.log-rotate'],
    servicesLinux: [],  // Ubuntu uses logrotate.d natively
    nodeFilter: 'lead',
  },

  // ── DISCORD TOOL ────────────────────────────────────────────────────────

  {
    id: 'mesh-tool-discord',
    name: 'Discord NATS Tool',
    description: 'Discord channel history reader over NATS',
    risk: 'safe',
    repoPaths: ['bin/mesh-tool-discord.js', 'bin/discord-read.js'],
    targets: [DIRS.CLI_BIN],
    servicesMac: ['ai.openclaw.mesh-tool-discord'],
    servicesLinux: [],  // Lead only
    nodeFilter: 'lead',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// DEPLOY ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load deploy state — tracks what was deployed when.
 */
function loadDeployState() {
  try {
    if (fs.existsSync(DIRS.DEPLOY_STATE)) {
      return JSON.parse(fs.readFileSync(DIRS.DEPLOY_STATE, 'utf8'));
    }
  } catch (err) { console.warn(`[mesh-deploy] load deploy state: ${err.message}`); }
  return { lastDeploy: null, lastSha: null, components: {} };
}

function saveDeployState(state) {
  const dir = path.dirname(DIRS.DEPLOY_STATE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DIRS.DEPLOY_STATE, JSON.stringify(state, null, 2));
}

/**
 * Git operations on the repo.
 */
function gitFetchAndDiff(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    fail(`Not a git repo: ${repoDir}`);
    return { currentSha: null, remoteSha: null, changedFiles: [], upToDate: true };
  }

  exec(`git fetch origin ${DEPLOY_BRANCH}`, { cwd: repoDir });
  const currentSha = exec('git rev-parse HEAD', { cwd: repoDir });
  const remoteSha = exec(`git rev-parse origin/${DEPLOY_BRANCH}`, { cwd: repoDir });
  const upToDate = currentSha === remoteSha;

  let changedFiles = [];
  if (!upToDate) {
    const diff = exec(`git diff --name-only ${currentSha}..${remoteSha}`, { cwd: repoDir });
    changedFiles = diff ? diff.split('\n').filter(Boolean) : [];
  }

  return { currentSha, remoteSha, changedFiles, upToDate };
}

function gitMerge(repoDir) {
  const prevSha = exec('git rev-parse HEAD', { cwd: repoDir });
  exec(`git merge origin/${DEPLOY_BRANCH} --ff-only`, { cwd: repoDir });
  const newSha = exec('git rev-parse --short HEAD', { cwd: repoDir });
  return { prevSha, newSha };
}

/**
 * Determine which manifest components are affected by the changed files.
 */
function getAffectedComponents(changedFiles, filterIds) {
  const affected = [];

  for (const comp of MANIFEST) {
    // Skip components not meant for this node's role
    if (comp.nodeFilter && comp.nodeFilter !== 'all' && comp.nodeFilter !== NODE_ROLE) {
      continue;
    }

    // Filter by component ID if specified
    if (filterIds && filterIds.length > 0 && !filterIds.includes(comp.id) && !filterIds.includes('all')) {
      continue;
    }

    // npm-based components have their own detect() logic
    if (comp.repoPaths.length === 0 && comp.detect) {
      const result = comp.detect();
      if (result.changed || (filterIds && filterIds.includes(comp.id))) {
        affected.push({ ...comp, changedFiles: [], detectResult: result });
      }
      continue;
    }

    // Check if any changed file matches this component's repo paths
    const matches = changedFiles.filter(f =>
      comp.repoPaths.some(rp => {
        if (rp.endsWith('/')) return f.startsWith(rp);
        return f === rp;
      })
    );

    if (matches.length > 0 || (filterIds && filterIds.includes('all'))) {
      affected.push({ ...comp, changedFiles: matches });
    }
  }

  return affected;
}

/**
 * Install files from repo to target directory.
 */
function installComponentFiles(comp, repoDir, dryRun) {
  if (!comp.changedFiles || comp.changedFiles.length === 0) return 0;
  let copied = 0;

  for (const target of comp.targets) {
    for (const relFile of comp.changedFiles) {
      const srcPath = path.join(repoDir, relFile);
      if (!fs.existsSync(srcPath)) continue;

      // Strip matching repoPath prefix to determine destination subpath
      let subPath = relFile;
      for (const rp of comp.repoPaths) {
        if (rp.endsWith('/') && relFile.startsWith(rp)) {
          subPath = relFile.slice(rp.length);
          break;
        } else if (relFile === rp) {
          subPath = path.basename(relFile);
          break;
        }
      }
      const dstPath = path.join(target, subPath);

      if (dryRun) {
        info(`  ${relFile} → ${dstPath}`);
        copied++;
        continue;
      }

      const dstDir = path.dirname(dstPath);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(srcPath, dstPath);

      // Preserve executable bit
      if (relFile.endsWith('.js') || relFile.endsWith('.sh')) {
        fs.chmodSync(dstPath, 0o755);
      }
      copied++;
    }
  }
  return copied;
}

/**
 * Restart services for a component — rolling, one at a time.
 */
function restartComponentServices(comp, dryRun) {
  const services = IS_MAC ? comp.servicesMac : comp.servicesLinux;
  if (!services || services.length === 0) return;

  for (const svc of services) {
    if (dryRun) {
      info(`  Would restart: ${svc}`);
      continue;
    }

    try {
      if (IS_MAC) {
        const plistPath = path.join(DIRS.SERVICES_MAC, `${svc}.plist`);
        if (!fs.existsSync(plistPath)) { warn(`  Plist not found: ${svc}`); continue; }
        exec(`launchctl unload "${plistPath}"`, { ignoreError: true });
        exec(`launchctl load "${plistPath}"`);
      } else {
        exec(`systemctl --user restart ${svc}`, { ignoreError: true });
      }
      ok(`  Restarted ${svc}`);
    } catch (err) {
      warn(`  Failed to restart ${svc}: ${err.message}`);
    }

    // Brief pause between restarts
    exec('sleep 1', { ignoreError: true });
  }
}

// ── Tracer Instrumentation ───────────────────────────────────────────────
gitFetchAndDiff = tracer.wrap('gitFetchAndDiff', gitFetchAndDiff, { tier: 2, category: 'lifecycle' });
gitMerge = tracer.wrap('gitMerge', gitMerge, { tier: 2, category: 'lifecycle' });
getAffectedComponents = tracer.wrap('getAffectedComponents', getAffectedComponents, { tier: 2, category: 'lifecycle' });
installComponentFiles = tracer.wrap('installComponentFiles', installComponentFiles, { tier: 2, category: 'lifecycle' });
restartComponentServices = tracer.wrap('restartComponentServices', restartComponentServices, { tier: 2, category: 'lifecycle' });

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const localOnly = args.includes('--local');
  const noRestart = args.includes('--no-restart');
  const doRollback = args.includes('--rollback');
  const includeServices = args.includes('--include-services');
  const forceAll = args.includes('--force');
  const showStatus = args.includes('--status');

  // Parse --component flag (can be repeated)
  const filterIds = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--component' && args[i + 1]) {
      filterIds.push(args[i + 1]);
      i++;
    }
  }

  // Parse --node flag
  let deployLocal = true, deployRemote = !localOnly;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--node' && args[i + 1]) {
      const target = args[i + 1].toLowerCase();
      if (['ubuntu', 'linux', 'calos'].includes(target)) {
        deployLocal = false;
        deployRemote = true;
      } else if (['mac', 'macos', 'moltymac', 'self'].includes(target)) {
        deployLocal = true;
        deployRemote = false;
      }
      i++;
    }
  }

  // ── Status mode ──
  if (showStatus) {
    header('Deployment Status');
    const state = loadDeployState();
    const git = gitFetchAndDiff(REPO_DIR);

    console.log(`  Repo:     ${REPO_DIR}`);
    console.log(`  Branch:   ${DEPLOY_BRANCH}`);
    console.log(`  Local:    ${git.currentSha?.slice(0, 8) || 'unknown'}`);
    console.log(`  Remote:   ${git.remoteSha?.slice(0, 8) || 'unknown'}`);
    console.log(`  Status:   ${git.upToDate ? C.green('up to date') : C.yellow(`${git.changedFiles.length} files behind`)}`);

    if (state.lastDeploy) {
      console.log(`  Last deploy: ${state.lastDeploy}`);
    }

    if (!git.upToDate) {
      console.log(`\n  Changed files:`);
      for (const f of git.changedFiles) {
        console.log(`    ${f}`);
      }

      const affected = getAffectedComponents(git.changedFiles, []);
      if (affected.length > 0) {
        console.log(`\n  Affected components:`);
        for (const comp of affected) {
          const risk = comp.risk === 'safe' ? C.green(comp.risk)
            : comp.risk === 'careful' ? C.yellow(comp.risk)
            : C.red(comp.risk);
          console.log(`    ${comp.name} [${risk}] — ${comp.changedFiles.length} files`);
        }
      }
    }

    // Check npm packages
    for (const comp of MANIFEST.filter(c => c.detect)) {
      const result = comp.detect();
      if (result.changed) {
        console.log(`\n  ${C.yellow('Update available:')} ${comp.name}`);
        if (result.current) console.log(`    Current: ${result.current}`);
        if (result.latest) console.log(`    Latest:  ${result.latest}`);
        if (result.reason) console.log(`    Reason:  ${result.reason}`);
      }
    }

    return;
  }

  // ── Rollback mode ──
  if (doRollback) {
    header('Rolling Back Last Deploy');
    const state = loadDeployState();
    if (!state.lastSha) {
      fail('No previous deploy state found — cannot rollback');
      return;
    }

    // Validate SHA format before shell interpolation (guards against corrupted state file)
    if (!/^[0-9a-f]{7,40}$/i.test(state.lastSha)) {
      fail(`Invalid SHA in deploy state: ${JSON.stringify(state.lastSha).slice(0, 50)}`);
      return;
    }
    info(`Reverting to ${state.lastSha.slice(0, 8)}`);
    const dirty = exec('git status --porcelain', { cwd: REPO_DIR, ignoreError: true });
    if (dirty) {
      warn('Working tree has uncommitted changes — stashing before rollback');
      exec('git stash push -m "pre-rollback-stash"', { cwd: REPO_DIR });
    }
    exec(`git reset --hard ${state.lastSha}`, { cwd: REPO_DIR });

    // Full reinstall from the reverted state
    const allFiles = exec('git ls-files', { cwd: REPO_DIR }).split('\n').filter(Boolean);
    const affected = getAffectedComponents(allFiles, ['all']);
    for (const comp of affected) {
      comp.changedFiles = allFiles.filter(f =>
        comp.repoPaths.some(rp => rp.endsWith('/') ? f.startsWith(rp) : f === rp)
      );
      installComponentFiles(comp, REPO_DIR, false);
      if (!noRestart) restartComponentServices(comp, false);
    }

    ok(`Rolled back to ${state.lastSha.slice(0, 8)}`);

    if (deployRemote) {
      header('Rolling back remote nodes');
      try {
        const { fleetDeploy } = require('./fleet-deploy');
        const { connect } = require('nats');
        const { natsConnectOpts: natsOpts } = require('../lib/nats-resolve');
        const nc = await connect(natsOpts({ name: 'deploy-rollback', timeout: 10000 }));
        try {
          // Trigger fleet deploy at the rollback SHA — nodes will git fetch + ff to it
          await fleetDeploy(nc, {
            components: null,
            targetNodes: null,
            dryRun: false,
            force: true,
            timeoutMs: 120000,
          });
        } finally {
          await nc.close();
        }
        ok('Remote rollback triggered via fleet deploy');
      } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          warn('Fleet deploy not available — remote rollback skipped');
        } else {
          fail(`Remote rollback failed: ${err.message}`);
        }
      }
    }
    return;
  }

  // ═══ Normal deploy flow ═══

  if (deployLocal) {
    header(`Deploying to ${IS_MAC ? 'macOS (lead)' : 'Ubuntu (worker)'}`);

    if (!fs.existsSync(REPO_DIR)) {
      fail(`Repo not found at ${REPO_DIR}`);
      console.log(`  Clone it: git clone https://github.com/moltyguibros-design/openclaw-node.git "${REPO_DIR}"`);
      process.exit(1);
    }

    // Step 1: Git fetch and diff
    const git = gitFetchAndDiff(REPO_DIR);
    const state = loadDeployState();

    if (git.upToDate && filterIds.length === 0 && !forceAll) {
      ok('Repo is up to date — nothing to deploy');
    } else {
      // Save pre-deploy SHA for rollback
      state.lastSha = git.currentSha;

      if (!git.upToDate && !dryRun) {
        const { newSha } = gitMerge(REPO_DIR);
        ok(`Git updated to ${newSha}`);
      }

      // Step 2: Determine affected components
      const affected = getAffectedComponents(
        git.upToDate ? [] : git.changedFiles,
        filterIds.length > 0 ? filterIds : undefined
      );

      if (affected.length === 0) {
        ok('No components affected by changes');
      } else {
        info(`${affected.length} component(s) to deploy:\n`);

        // Step 3: Deploy each component
        for (const comp of affected) {
          const risk = comp.risk === 'safe' ? C.green('●')
            : comp.risk === 'careful' ? C.yellow('●')
            : C.red('●');

          console.log(`  ${risk} ${C.bold(comp.name)} ${C.dim(`(${comp.id})`)}`);
          console.log(`    ${C.dim(comp.description)}`);

          // Skip manual-risk components unless explicitly included
          if (comp.risk === 'manual' && !forceAll) {
            if (comp.id === 'services' && !includeServices) {
              skip(`    Skipped (use --include-services)`);
              continue;
            }
            if (comp.id !== 'services') {
              skip(`    Skipped (use --force or --component ${comp.id})`);
              continue;
            }
          }

          // Pre-install hook (backup, merge protection, etc.)
          if (comp.preInstall) {
            const result = comp.preInstall(comp.changedFiles || []);
            if (result === false) continue; // Component vetoed installation
          }

          // npm-based components have their own install logic
          if (comp.install) {
            comp.install(dryRun);
          } else {
            // File-based components — copy changed files
            const count = installComponentFiles(comp, REPO_DIR, dryRun);
            if (count > 0 && !dryRun) ok(`    Installed ${count} file(s)`);
          }

          // Post-install hook (npm install, config regen, boot compile, etc.)
          if (comp.postInstall && !dryRun) {
            comp.postInstall(comp.changedFiles || []);
          }

          // Restart affected services
          if (!noRestart && !dryRun) {
            restartComponentServices(comp, dryRun);
          } else if (noRestart && !dryRun) {
            const services = IS_MAC ? comp.servicesMac : comp.servicesLinux;
            if (services && services.length > 0) {
              info(`    ${services.length} service(s) need manual restart`);
            }
          }

          // Validation
          if (comp.validate && !dryRun) {
            const valid = comp.validate();
            if (valid) {
              ok(`    Validated`);
            } else {
              warn(`    Validation failed — check manually`);
            }
          }

          // Notes
          if (comp.notes && dryRun) {
            console.log(`    ${C.dim('Note: ' + comp.notes)}`);
          }

          console.log('');

          // Track component deploy
          if (!dryRun) {
            state.components[comp.id] = {
              deployedAt: new Date().toISOString(),
              sha: git.remoteSha?.slice(0, 8),
              filesChanged: (comp.changedFiles || []).length,
            };
          }
        }
      }

      // Save deploy state
      if (!dryRun) {
        state.lastDeploy = new Date().toISOString();
        saveDeployState(state);
      }
    }
  }

  // ── Fleet deploy (replaces old SSH remote block) ──
  if (deployRemote) {
    try {
      const { fleetDeploy } = require('./fleet-deploy');
      const { connect } = require('nats');
      const { natsConnectOpts: natsOpts2 } = require('../lib/nats-resolve');

      const nc = await connect(natsOpts2({ name: 'deploy-cli', timeout: 10000 }));
      try {
        await fleetDeploy(nc, {
          components: filterIds.length > 0 ? filterIds : null,
          targetNodes: null,  // all remote nodes
          dryRun,
          force: forceAll,
          timeoutMs: 120000,
        });
      } finally {
        await nc.close();
      }
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        warn('Fleet deploy not available (fleet-deploy.js or nats not found)');
        info('Install: npm install nats && copy fleet-deploy.js to bin/');
      } else {
        fail(`Fleet deploy failed: ${err.message}`);
      }
    }
  }

  // ── Summary ──
  if (!dryRun && (deployLocal || deployRemote)) {
    header('Deploy Complete');
    const sha = exec('git rev-parse --short HEAD', { cwd: REPO_DIR, ignoreError: true });
    console.log(`  Commit:  ${sha}`);
    console.log(`  Branch:  ${DEPLOY_BRANCH}`);
    console.log(`  Local:   ${deployLocal ? C.green('deployed') : C.dim('skipped')}`);
    console.log(`  Remote:  ${deployRemote ? C.green('deployed') : C.dim('skipped')}`);
    console.log('');
  }
}

main().catch(err => {
  fail(`Deploy error: ${err.message}`);
  process.exit(1);
});
