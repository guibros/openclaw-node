/**
 * pair-transport-teams.js — Transport adapter for pair-working over Claude Code Teams.
 *
 * Wraps Claude Code's native Team/SendMessage/Task tools into the
 * transport interface expected by pair-session.js.
 *
 * This is the "local" adapter. A future NATS adapter would implement
 * the same interface for distributed execution.
 */

const fs = require('fs');
const path = require('path');

// ── Transport Interface ──────────────────────────────

class TeamsTransport {
  /**
   * @param {string} teamName — unique team identifier
   * @param {string} artifactDir — shared directory for work products
   */
  constructor(teamName, artifactDir) {
    this.teamName = teamName;
    this.artifactDir = artifactDir;
    this.stateFile = path.join(artifactDir, '.pair-state.json');
    this.agents = {};

    // Ensure artifact dir exists
    fs.mkdirSync(artifactDir, { recursive: true });

    // Initialize state
    if (!fs.existsSync(this.stateFile)) {
      this._writeState({
        session: teamName,
        status: 'init',
        mode: null,
        turn: null,
        agents: {},
        messages: [],
        artifacts: [],
        created_at: new Date().toISOString(),
      });
    }
  }

  // ── State Management ────────────────────────────────

  getState() {
    if (!fs.existsSync(this.stateFile)) return null;
    return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
  }

  setState(updates) {
    const state = this.getState() || {};
    const merged = { ...state, ...updates, updated_at: new Date().toISOString() };
    this._writeState(merged);
    return merged;
  }

  _writeState(state) {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2) + '\n');
  }

  // ── Message Log ─────────────────────────────────────

  /**
   * Log a message to the session's message history.
   * Messages are append-only for auditability.
   */
  logMessage(from, to, type, content) {
    const state = this.getState();
    state.messages.push({
      from,
      to,
      type,
      content,
      timestamp: new Date().toISOString(),
    });
    this._writeState(state);
  }

  /**
   * Get messages for a specific agent (inbox).
   */
  getMessages(agentName, since = null) {
    const state = this.getState();
    return state.messages.filter(m => {
      if (m.to !== agentName && m.to !== 'all') return false;
      if (since && new Date(m.timestamp) <= new Date(since)) return false;
      return true;
    });
  }

  // ── Artifact Management ─────────────────────────────

  /**
   * Register an artifact (file written by an agent).
   */
  publishArtifact(agentName, filename, description) {
    const state = this.getState();
    const artifactPath = path.join(this.artifactDir, filename);
    state.artifacts.push({
      agent: agentName,
      path: artifactPath,
      filename,
      description,
      timestamp: new Date().toISOString(),
    });
    this._writeState(state);
    return artifactPath;
  }

  /**
   * List all artifacts in the session.
   */
  listArtifacts() {
    const state = this.getState();
    return state.artifacts || [];
  }

  // ── Turn Management ─────────────────────────────────

  /**
   * Set whose turn it is (ping-pong mode).
   */
  setTurn(agentName) {
    this.setState({ turn: agentName });
  }

  /**
   * Get whose turn it is.
   */
  getTurn() {
    const state = this.getState();
    return state.turn;
  }

  // ── Agent Registration ──────────────────────────────

  /**
   * Register an agent in the session.
   */
  registerAgent(name, role, scope) {
    const state = this.getState();
    state.agents[name] = {
      name,
      role,
      scope,
      status: 'ready',
      registered_at: new Date().toISOString(),
    };
    this._writeState(state);
  }

  /**
   * Update agent status.
   */
  setAgentStatus(name, status) {
    const state = this.getState();
    if (state.agents[name]) {
      state.agents[name].status = status;
      this._writeState(state);
    }
  }

  // ── Session Lifecycle ───────────────────────────────

  /**
   * Check if both agents have completed their work.
   */
  isComplete() {
    const state = this.getState();
    return state.status === 'done';
  }

  /**
   * Check if session was aborted.
   */
  isAborted() {
    const state = this.getState();
    return state.status === 'aborted';
  }

  /**
   * Mark session as done.
   */
  markDone(summary) {
    this.setState({
      status: 'done',
      summary,
      completed_at: new Date().toISOString(),
    });
  }

  /**
   * Mark session as aborted.
   */
  markAborted(reason) {
    this.setState({
      status: 'aborted',
      abort_reason: reason,
      aborted_at: new Date().toISOString(),
    });
  }

  /**
   * Get session summary for reporting.
   */
  getSummary() {
    const state = this.getState();
    return {
      session: state.session,
      status: state.status,
      mode: state.mode,
      agents: Object.keys(state.agents),
      messageCount: state.messages.length,
      artifactCount: state.artifacts.length,
      artifacts: state.artifacts.map(a => a.path),
      duration_ms: state.completed_at || state.aborted_at
        ? new Date(state.completed_at || state.aborted_at) - new Date(state.created_at)
        : Date.now() - new Date(state.created_at),
    };
  }
}

module.exports = { TeamsTransport };
