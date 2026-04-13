#!/usr/bin/env node

/**
 * pair-session.js — Coordinator for pair-working sessions.
 *
 * Outer loop is deterministic Node.js (same pattern as mesh-agent.js).
 * The LLM agents handle the actual work via Claude Code Teams.
 *
 * Usage:
 *   node bin/pair-session.js --mode ping-pong --task "Count to 10"
 *   node bin/pair-session.js --mode split-merge --task "Build X" --scope-a "src/api/**" --scope-b "src/ui/**"
 *   node bin/pair-session.js --mode lead-reviewer --task "Build feature X"
 *   node bin/pair-session.js --dry-run --mode ping-pong --task "Test"
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TeamsTransport } = require('../lib/pair-transport-teams');

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name, defaultVal = null) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const MODE = getArg('mode', 'ping-pong');
const TASK = getArg('task', 'No task specified');
const SCOPE_A = getArg('scope-a', '*');
const SCOPE_B = getArg('scope-b', '*');
const TIMEOUT = parseInt(getArg('timeout', '300')); // 5 min default
const DRY_RUN = args.includes('--dry-run');
const MODEL = getArg('model', 'sonnet');

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace');
const SESSION_ID = `pair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ARTIFACT_DIR = getArg('artifact-dir', path.join(WORKSPACE, '.tmp', 'pair', SESSION_ID));

// ── Logging ───────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [pair-session:${SESSION_ID.slice(-8)}] ${msg}`);
}

function logJSON(obj) {
  console.log(JSON.stringify({ ...obj, session: SESSION_ID, timestamp: new Date().toISOString() }));
}

// ── Protocol Rules (per mode) ─────────────────────────

const PROTOCOL_RULES = {
  'ping-pong': `
## Ping-Pong Protocol
- You take turns. Only the agent holding the turn may write files.
- After your turn: send [PAIR:TURN_HANDOFF] to your partner with what you did and what's next.
- Wait for [PAIR:TURN_ACK] before assuming your partner is working.
- Agent A goes first. Agent B waits for the first handoff.
- When the task is complete, the last agent sends [PAIR:TURN_HANDOFF] with "TASK COMPLETE" in the message.
`.trim(),

  'split-merge': `
## Split-Merge Protocol
- You work on your partition independently. Do NOT touch your partner's files.
- When your partition is complete: send [PAIR:SPLIT_DONE] to your partner listing all artifacts.
- After both are done, one agent will receive a merge request.
- Only modify files within your assigned scope.
`.trim(),

  'lead-reviewer': `
## Lead-Reviewer Protocol
- Lead implements the task. Reviewer reads and reviews only.
- Lead: when ready for review, send [PAIR:REVIEW_REQUEST] with changed files and summary.
- Reviewer: respond with [PAIR:REVIEW_RESULT] — either APPROVE or REJECT with specific feedback.
- If rejected, Lead fixes and re-submits. Max 3 review rounds.
- Reviewer may NOT modify any files. Read-only.
`.trim(),
};

// ── Prompt Builder ────────────────────────────────────

function buildPrompt(agentName, role, scopeSelf, scopePartner, partnerName) {
  const templatePath = path.join(WORKSPACE, 'skills', 'pair-working', 'prompts',
    agentName === 'agent-a' ? 'agent-a.md' : 'agent-b.md');

  let template = fs.readFileSync(templatePath, 'utf-8');

  // Resolve absolute path for artifact dir
  const absArtifactDir = path.resolve(ARTIFACT_DIR);

  const replacements = {
    '{PARTNER}': partnerName,
    '{MODE}': MODE,
    '{ROLE}': role,
    '{TASK}': TASK,
    '{SCOPE_A}': scopeSelf,
    '{SCOPE_B}': scopePartner,
    '{ARTIFACT_DIR}': absArtifactDir,
    '{PROTOCOL_RULES}': PROTOCOL_RULES[MODE] || 'No protocol rules defined.',
  };

  for (const [key, value] of Object.entries(replacements)) {
    template = template.split(key).join(value);
  }

  // In subprocess mode (claude -p), agents don't have Teams tools.
  // Append explicit file-writing instructions.
  template += `\n\n## IMPORTANT: Subprocess Mode\n`;
  template += `You are running as a non-interactive subprocess via \`claude -p\`.\n`;
  template += `- You do NOT have access to SendMessage or Teams tools.\n`;
  template += `- Write all output files to the absolute path: ${absArtifactDir}/\n`;
  template += `- Use the Write tool or Bash (echo/printf) to create files.\n`;
  template += `- Coordination with your partner happens through shared files in this directory.\n`;
  template += `- Check for existing files your partner may have written before writing yours.\n`;
  template += `- When done, write a completion marker: ${absArtifactDir}/.done-${agentName}\n`;

  return template;
}

// ── Role Assignment ───────────────────────────────────

function assignRoles() {
  switch (MODE) {
    case 'ping-pong':
      return { a: 'driver (goes first)', b: 'navigator (responds)' };
    case 'split-merge':
      return { a: `worker (scope: ${SCOPE_A})`, b: `worker (scope: ${SCOPE_B})` };
    case 'lead-reviewer':
      return { a: 'lead (implements)', b: 'reviewer (reviews, read-only)' };
    default:
      return { a: 'agent-a', b: 'agent-b' };
  }
}

// ── Claude Spawner ────────────────────────────────────

function spawnClaude(prompt, agentName) {
  return new Promise((resolve, reject) => {
    const claudePath = process.env.CLAUDE_PATH || 'claude';

    // Write prompt to temp file to avoid shell arg length issues.
    // Use absolute paths everywhere.
    const absArtifactDir = path.resolve(ARTIFACT_DIR);
    const promptFile = path.join(absArtifactDir, `.prompt-${agentName}.md`);
    fs.mkdirSync(absArtifactDir, { recursive: true });
    fs.writeFileSync(promptFile, prompt);

    // Must strip all Claude Code env vars to allow nested sessions.
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith('CLAUDE_CODE') || key === 'CLAUDECODE') {
        delete cleanEnv[key];
      }
    }

    // Pipe prompt via stdin. Write + close pattern.
    const child = spawn('sh', ['-c', `cat "${promptFile}" | ${claudePath} -p --model ${MODEL}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: absArtifactDir,
      env: cleanEnv,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Log progress
      if (chunk.includes('count.txt') || chunk.includes('PAIR:')) {
        log(`[${agentName}] ${chunk.trim().slice(0, 100)}`);
      }
    });
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      log(`[${agentName}:stderr] ${chunk.trim().slice(0, 200)}`);
    });

    child.on('close', (code) => {
      // Save stdout for debugging
      const outFile = path.join(ARTIFACT_DIR, `.output-${agentName}.txt`);
      fs.writeFileSync(outFile, stdout);
      log(`[${agentName}] Exit code: ${code}, stdout saved to ${outFile} (${stdout.length} chars)`);
      resolve({ code, stdout, stderr, agent: agentName });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn claude for ${agentName}: ${err.message}`));
    });
  });
}

// ── Session Monitor ───────────────────────────────────

function waitForCompletion(transport, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const state = transport.getState();

      if (state.status === 'done') {
        clearInterval(interval);
        resolve(state);
      } else if (state.status === 'aborted') {
        clearInterval(interval);
        reject(new Error(`Session aborted: ${state.abort_reason}`));
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        transport.markAborted('timeout');
        reject(new Error(`Session timed out after ${timeoutMs}ms`));
      }
    }, 2000); // Poll every 2s
  });
}

// ── Main ──────────────────────────────────────────────

async function main() {
  log(`Starting pair session: mode=${MODE}, task="${TASK.slice(0, 60)}..."`);
  logJSON({ type: 'pair_start', mode: MODE, task: TASK, scopes: { a: SCOPE_A, b: SCOPE_B } });

  // 1. Initialize transport
  const transport = new TeamsTransport(SESSION_ID, ARTIFACT_DIR);
  transport.setState({ mode: MODE, status: 'init' });

  // 2. Assign roles
  const roles = assignRoles();
  transport.registerAgent('agent-a', roles.a, SCOPE_A);
  transport.registerAgent('agent-b', roles.b, SCOPE_B);
  log(`Roles assigned: A=${roles.a}, B=${roles.b}`);

  // 3. Build prompts
  const promptA = buildPrompt('agent-a', roles.a, SCOPE_A, SCOPE_B, 'agent-b');
  const promptB = buildPrompt('agent-b', roles.b, SCOPE_B, SCOPE_A, 'agent-a');

  if (DRY_RUN) {
    log('DRY RUN — printing prompts and exiting');
    console.log('\n=== AGENT A PROMPT ===\n');
    console.log(promptA);
    console.log('\n=== AGENT B PROMPT ===\n');
    console.log(promptB);
    process.exit(0);
  }

  // 4. Update state
  transport.setState({ status: 'paired' });
  logJSON({ type: 'paired', agents: ['agent-a', 'agent-b'] });

  // 5. Spawn agents
  //
  // Two execution modes:
  //
  // A) Teams mode (default): Uses Claude Code Teams (TeamCreate + Task tool).
  //    Agents inherit tool permissions from parent session. Supports SendMessage
  //    for inter-agent communication. This is the production path.
  //
  // B) Subprocess mode (--subprocess): Uses `claude -p` for environments
  //    without Claude Code Teams. Agents communicate via shared files only.
  //    Limited by sandbox restrictions on file writes.
  //
  // The coordinator outputs a JSON manifest that a Claude Code session can
  // execute using TeamCreate + Task tool. This avoids the nested session problem.

  const absArtifactDir = path.resolve(ARTIFACT_DIR);
  transport.setState({ status: 'working' });
  logJSON({ type: 'working' });

  if (args.includes('--subprocess')) {
    // Subprocess mode: spawn claude -p directly
    try {
      if (MODE === 'split-merge') {
        log('Spawning agents in parallel (split-merge, subprocess)');
        const [resultA, resultB] = await Promise.all([
          spawnClaude(promptA, 'agent-a'),
          spawnClaude(promptB, 'agent-b'),
        ]);
        logJSON({ type: 'agent_done', agent: 'agent-a', code: resultA.code });
        logJSON({ type: 'agent_done', agent: 'agent-b', code: resultB.code });
      } else {
        log('Spawning Agent A');
        transport.setTurn('agent-a');
        const resultA = await spawnClaude(promptA, 'agent-a');
        logJSON({ type: 'agent_done', agent: 'agent-a', code: resultA.code });

        log('Spawning Agent B');
        transport.setTurn('agent-b');
        const resultB = await spawnClaude(promptB, 'agent-b');
        logJSON({ type: 'agent_done', agent: 'agent-b', code: resultB.code });
      }

      transport.markDone('Pair session completed (subprocess mode)');
    } catch (err) {
      transport.markAborted(err.message);
    }
  } else {
    // Teams mode (default): Generate execution manifest for Claude Code Teams.
    // The manifest is a JSON file that instructs the parent Claude Code session
    // to use TeamCreate, Task, and SendMessage to orchestrate the pair.

    const manifest = {
      type: 'pair-session-manifest',
      session: SESSION_ID,
      mode: MODE,
      task: TASK,
      artifact_dir: absArtifactDir,
      timeout_s: TIMEOUT,
      agents: {
        'agent-a': {
          role: roles.a,
          scope: SCOPE_A,
          prompt: promptA,
        },
        'agent-b': {
          role: roles.b,
          scope: SCOPE_B,
          prompt: promptB,
        },
      },
      instructions: `
To execute this pair session in Claude Code:

1. Create a team:
   TeamCreate({ team_name: "${SESSION_ID}" })

2. Spawn Agent A:
   Task({
     subagent_type: "general-purpose",
     name: "agent-a",
     team_name: "${SESSION_ID}",
     prompt: <agent-a prompt from manifest>
   })

3. Spawn Agent B:
   Task({
     subagent_type: "general-purpose",
     name: "agent-b",
     team_name: "${SESSION_ID}",
     prompt: <agent-b prompt from manifest>
   })

4. Agents communicate via SendMessage.
5. Monitor via task list and agent messages.
6. Shutdown when done: SendMessage({ type: "shutdown_request", recipient: "agent-a" })
`.trim(),
    };

    const manifestPath = path.join(absArtifactDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    log(`Teams manifest written to: ${manifestPath}`);
    log('Execute this pair session from a Claude Code session using the manifest.');
    logJSON({ type: 'manifest_ready', path: manifestPath });

    // Also save individual prompt files for easy access
    fs.writeFileSync(path.join(absArtifactDir, 'prompt-agent-a.md'), promptA);
    fs.writeFileSync(path.join(absArtifactDir, 'prompt-agent-b.md'), promptB);

    transport.markDone('Manifest generated — ready for Teams execution');
  }

  const summary = transport.getSummary();
  logJSON({ type: 'pair_done', ...summary });

  // List artifacts
  const artifacts = fs.readdirSync(absArtifactDir).filter(f => !f.startsWith('.'));
  if (artifacts.length > 0) {
    log(`Artifacts: ${artifacts.join(', ')}`);
  }

  log('Session complete');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
