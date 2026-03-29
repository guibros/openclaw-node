/**
 * llm-providers.js — LLM-agnostic provider abstraction for mesh agents.
 *
 * Each provider defines how to spawn a CLI process with a prompt.
 * The mesh agent doesn't care what LLM runs — it only cares about:
 *   1. Send prompt → get text output
 *   2. Exit code 0 = success
 *
 * Built-in providers cover the major ecosystems. Any CLI tool that
 * accepts a prompt and returns text can be registered at runtime
 * or loaded from ~/.openclaw/mesh-providers.json.
 *
 * Resolution order for LLM_PROVIDER:
 *   1. Task-level: task.llm_provider field
 *   2. Environment: MESH_LLM_PROVIDER env var
 *   3. CLI: --provider flag
 *   4. Default: 'claude'
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Shell Command Security ─────────────────────────
const SHELL_CHAIN_PATTERNS = /[;`]|\$\(|\|\||&&|\|(?!\s*grep\b|\s*head\b|\s*tail\b|\s*wc\b|\s*sort\b|\s*tee\b)/;

const SHELL_PROVIDER_ALLOWED_PREFIXES = [
  'npm test', 'npm run', 'node ', 'python ', 'pytest', 'cargo test',
  'go test', 'make', 'jest', 'vitest', 'mocha',
  'bash openclaw/', 'bash ~/openclaw/', 'bash ./bin/',
  'sh openclaw/', 'sh ~/openclaw/', 'sh ./bin/',
  'cat ', 'echo ', 'ls ', 'grep ', 'find ', 'git '
];

function validateShellCommand(cmd) {
  const trimmed = (cmd || '').trim();
  if (!trimmed) return false;
  if (SHELL_CHAIN_PATTERNS.test(trimmed)) return false;
  return SHELL_PROVIDER_ALLOWED_PREFIXES.some(p => trimmed.startsWith(p));
}

// ── Generic Provider Factory ────────────────────────
// Most agentic coding CLIs follow a similar pattern:
//   binary [prompt-flag] "prompt" [model-flag] model [cwd-flag] dir
// This factory builds a provider from a simple config.

function makeGenericProvider({ name, binary, promptFlag = '-p', modelFlag = '--model', cwdFlag = '--cwd', defaultModel, extraArgs = [], envStrip = [] }) {
  return {
    name,
    binary,
    buildArgs(prompt, model, task, targetDir) {
      const args = [];
      if (promptFlag) args.push(promptFlag, prompt);
      else args.push(prompt); // bare positional prompt
      if (modelFlag && (model || defaultModel)) args.push(modelFlag, model || defaultModel);
      if (cwdFlag && targetDir) args.push(cwdFlag, targetDir);
      args.push(...extraArgs);
      return args;
    },
    cleanEnv(env) {
      if (envStrip.length === 0) return { ...env };
      const clean = { ...env };
      for (const prefix of envStrip) {
        for (const key of Object.keys(clean)) {
          if (key.startsWith(prefix) || key === prefix) delete clean[key];
        }
      }
      return clean;
    },
    defaultModel,
  };
}

// ── Built-in Provider Definitions ───────────────────

const PROVIDERS = {
  // ─── Anthropic ───
  claude: {
    name: 'claude',
    binary: process.env.CLAUDE_PATH || 'claude',
    buildArgs(prompt, model, task, targetDir, workspaceDir) {
      const args = [
        '-p', prompt,
        '--output-format', 'text',
        '--model', model || 'sonnet',
        '--permission-mode', 'bypassPermissions',
      ];

      if (targetDir) args.push('--add-dir', targetDir);
      if (workspaceDir && workspaceDir !== targetDir) args.push('--add-dir', workspaceDir);

      // Add scope directories
      if (task.scope && task.scope.length > 0) {
        const addedDirs = new Set([targetDir, workspaceDir].filter(Boolean));
        for (const s of task.scope) {
          for (const base of [targetDir, workspaceDir].filter(Boolean)) {
            const resolved = path.resolve(base, s);
            const resolvedDir = path.dirname(resolved);
            if (!resolved.startsWith(base) && !resolved.startsWith('/tmp/')) continue;
            if (addedDirs.has(resolvedDir)) continue;
            addedDirs.add(resolvedDir);
            args.push('--add-dir', resolvedDir);
          }
        }
      }

      return args;
    },
    cleanEnv(env) {
      const clean = { ...env };
      for (const key of Object.keys(clean)) {
        if (key.startsWith('CLAUDE_CODE') || key === 'CLAUDECODE') delete clean[key];
      }
      return clean;
    },
    defaultModel: 'sonnet',
  },

  // ─── OpenAI ───
  openai: makeGenericProvider({
    name: 'openai',
    binary: process.env.OPENAI_PATH || 'codex',
    defaultModel: 'gpt-4.1',
    cwdFlag: '--cwd',
  }),

  // ─── Google Gemini ───
  gemini: makeGenericProvider({
    name: 'gemini',
    binary: process.env.GEMINI_PATH || 'gemini',
    defaultModel: 'gemini-2.5-pro',
  }),

  // ─── DeepSeek ───
  deepseek: makeGenericProvider({
    name: 'deepseek',
    binary: process.env.DEEPSEEK_PATH || 'deepseek',
    defaultModel: 'deepseek-chat',
  }),

  // ─── Kimi (Moonshot AI) ───
  kimi: makeGenericProvider({
    name: 'kimi',
    binary: process.env.KIMI_PATH || 'kimi',
    defaultModel: 'kimi',
  }),

  // ─── MiniMax ───
  minimax: makeGenericProvider({
    name: 'minimax',
    binary: process.env.MINIMAX_PATH || 'minimax',
    defaultModel: 'minimax-01',
  }),

  // ─── Meta Llama (via Ollama) ───
  ollama: makeGenericProvider({
    name: 'ollama',
    binary: process.env.OLLAMA_PATH || 'ollama',
    promptFlag: null, // ollama run <model> "prompt"
    modelFlag: null,
    cwdFlag: null,
    defaultModel: 'llama3',
    buildArgs(prompt, model) {
      return ['run', model || 'llama3', prompt];
    },
  }),

  // ─── Aider (multi-provider CLI — works with OpenAI, Anthropic, Gemini, DeepSeek, etc.) ───
  aider: makeGenericProvider({
    name: 'aider',
    binary: process.env.AIDER_PATH || 'aider',
    promptFlag: '--message',
    modelFlag: '--model',
    cwdFlag: null,
    defaultModel: null,
  }),

  // ─── Shell (no LLM — raw command execution) ───
  // Shell provider ignores the formatted prompt and runs task.description
  // as a raw shell command. The prompt from buildInitialPrompt() is markdown
  // with headers, bullet points, and retry context — bash can't execute that.
  shell: {
    name: 'shell',
    binary: '/bin/bash',
    buildArgs(prompt, model, task) {
      // Use task.description (the raw command) if available, fall back to prompt
      const cmd = (task && task.description) ? task.description : prompt;
      if (!validateShellCommand(cmd)) {
        throw new Error(`Shell provider: command blocked by security filter: ${cmd.slice(0, 80)}`);
      }
      return ['-c', cmd];
    },
    cleanEnv(env) {
      return { ...env };
    },
    defaultModel: null,
  },
};

// Fix: ollama needs custom buildArgs that the factory can't do, override it
PROVIDERS.ollama.buildArgs = function(prompt, model) {
  return ['run', model || 'llama3', prompt];
};

// ── Provider Resolution ──────────────────────────────

/**
 * Resolve which LLM provider to use.
 * Priority: task.llm_provider > MESH_LLM_PROVIDER env > --provider CLI flag > default
 */
function resolveProvider(task, cliProvider, envProvider) {
  const name = (task && task.llm_provider)
    || envProvider
    || cliProvider
    || 'claude';

  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown LLM provider: "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}. Register custom providers via registerProvider() or ~/.openclaw/mesh-providers.json`);
  }
  return provider;
}

/**
 * Resolve the model to use.
 * Priority: task.llm_model > --model CLI flag > provider default
 */
function resolveModel(task, cliModel, provider) {
  return (task && task.llm_model)
    || cliModel
    || provider.defaultModel;
}

/**
 * Register a custom provider at runtime.
 * Can be a full config object (with buildArgs function) or
 * a simple config (binary, defaultModel, etc.) for the generic factory.
 */
function registerProvider(name, config) {
  if (config.buildArgs && typeof config.buildArgs === 'function') {
    // Full provider object
    PROVIDERS[name] = { name, cleanEnv: (env) => ({ ...env }), defaultModel: null, ...config };
  } else if (config.binary) {
    // Simple config → use generic factory
    PROVIDERS[name] = makeGenericProvider({ name, ...config });
  } else {
    throw new Error('Provider must have binary (and optionally buildArgs)');
  }
}

/**
 * Load custom providers from ~/.openclaw/mesh-providers.json if it exists.
 * Format: { "provider-name": { "binary": "/path/to/cli", "defaultModel": "model-name", ... } }
 */
function loadCustomProviders() {
  const configPath = path.join(os.homedir(), '.openclaw', 'mesh-providers.json');
  try {
    if (!fs.existsSync(configPath)) return 0;
    const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let count = 0;
    for (const [name, config] of Object.entries(configs)) {
      if (PROVIDERS[name]) continue; // don't override built-ins
      registerProvider(name, config);
      count++;
    }
    return count;
  } catch (e) {
    // Silent fail — bad config shouldn't crash the agent
    return 0;
  }
}

// Auto-load custom providers on require()
const _customLoaded = loadCustomProviders();

module.exports = {
  PROVIDERS,
  resolveProvider,
  resolveModel,
  registerProvider,
  loadCustomProviders,
  makeGenericProvider,
};
