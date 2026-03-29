/**
 * mesh-collab.js — Collaborative session management for N-node coordination.
 *
 * Extends the mesh task system with multi-node collaboration.
 * Each collaborative task spawns a session where N nodes work in rounds,
 * exchange reflections, and converge.
 *
 * Backed by MESH_COLLAB JetStream KV bucket (same pattern as mesh-tasks.js).
 */

const { StringCodec } = require('nats');
const sc = StringCodec();

const COLLAB_KV_BUCKET = 'MESH_COLLAB';

// ── Session Statuses ────────────────────────────────

const COLLAB_STATUS = {
  RECRUITING: 'recruiting',   // waiting for nodes to join
  ACTIVE: 'active',           // rounds in progress
  CONVERGED: 'converged',     // convergence reached, collecting artifacts
  COMPLETED: 'completed',     // done, artifacts merged
  ABORTED: 'aborted',         // something broke
};

// ── Collaboration Modes ─────────────────────────────

const COLLAB_MODE = {
  PARALLEL: 'parallel',       // all nodes work simultaneously
  SEQUENTIAL: 'sequential',   // nodes take turns in order
  REVIEW: 'review',           // one leader + N reviewers
  CIRCLING_STRATEGY: 'circling_strategy', // 1 worker + 2 reviewers, asymmetric directed rounds
};

// ── Convergence Strategies ──────────────────────────

const CONVERGENCE = {
  UNANIMOUS: 'unanimous',     // all nodes vote converged
  MAJORITY: 'majority',       // >= threshold fraction
  COORDINATOR: 'coordinator', // daemon decides
  METRIC: 'metric',           // mechanical test passes
};

// ── Session Factory ─────────────────────────────────

/**
 * Create a new collaboration session from a task's collaboration spec.
 *
 * @param {string} taskId — parent task ID
 * @param {object} collabSpec — the task.collaboration object
 */
function createSession(taskId, collabSpec) {
  const sessionId = `collab-${taskId}-${Date.now()}`;
  return {
    session_id: sessionId,
    task_id: taskId,
    mode: collabSpec.mode || COLLAB_MODE.PARALLEL,
    status: COLLAB_STATUS.RECRUITING,

    // Node management
    // Circling requires at least 3 nodes (1 worker + 2 reviewers).
    // Default to 3 for circling, 2 for other modes.
    min_nodes: collabSpec.min_nodes || (collabSpec.mode === COLLAB_MODE.CIRCLING_STRATEGY ? 3 : 2),
    max_nodes: collabSpec.max_nodes || null,  // null = unlimited
    join_window_s: collabSpec.join_window_s || 30,
    nodes: [],

    // Round management
    current_round: 0,
    max_rounds: collabSpec.max_rounds || 5,
    rounds: [],

    // Convergence
    convergence: {
      type: collabSpec.convergence?.type || CONVERGENCE.UNANIMOUS,
      threshold: collabSpec.convergence?.threshold || 0.66,
      metric: collabSpec.convergence?.metric || null,
      // Min quorum: minimum number of valid votes required for convergence.
      // Prevents premature convergence when nodes die (e.g., 2/2 surviving = 100%
      // but only 2 of 5 recruited nodes). Defaults to min_nodes.
      min_quorum: collabSpec.convergence?.min_quorum || collabSpec.min_nodes || 2,
    },

    // Track how many nodes were recruited (immutable after recruiting closes)
    // Used to detect quorum loss when nodes die between rounds
    recruited_count: 0,

    // Scope strategy
    scope_strategy: collabSpec.scope_strategy || 'shared',

    // Heterogeneous collab: per-node role/soul assignments (Phase E)
    // Format: [{ soul: "blockchain-auditor", role: "solidity-dev" }, { soul: "identity-architect" }]
    // When set, recruiting assigns specific souls to joining nodes in order.
    // When null, all nodes run the same soul (homogeneous, backward compatible).
    node_roles: collabSpec.node_roles || null,

    // Sequential mode: turn tracking
    turn_order: [],           // node_ids in execution order
    current_turn: null,       // node_id of active node (sequential mode)

    // Circling Strategy mode: asymmetric directed rounds
    // Only populated when mode === 'circling_strategy'. null for other modes.
    circling: collabSpec.mode === COLLAB_MODE.CIRCLING_STRATEGY ? {
      worker_node_id: null,           // assigned at recruiting close (node_roles[0])
      reviewerA_node_id: null,        // assigned at recruiting close — first non-worker
      reviewerB_node_id: null,        // assigned at recruiting close — second non-worker
      max_subrounds: collabSpec.max_subrounds || 3,
      current_subround: 0,
      current_step: 0,                // 0 = init, 1 = review pass, 2 = integration
      automation_tier: collabSpec.automation_tier || 2,
      artifacts: {},                  // keyed: sr{N}_step{S}_{nodeRole}_{artifactType}
      phase: 'init',                  // init | circling | finalization | complete
      artifact_failures: {},          // { nodeId_step: count } — retry tracking per node per step
      step_started_at: null,          // ISO timestamp — set by daemon at step start, used for timeout rehydration after restart
    } : null,

    // Result (filled at completion)
    result: null,

    // Structured audit log — append-only event trail for post-mortem debugging.
    // Each entry: { ts, event, detail }
    audit_log: [],

    // Timestamps
    created_at: new Date().toISOString(),
    recruiting_deadline: null,  // set when first node joins
    completed_at: null,
  };
}

// ── CollabStore (KV-backed) ─────────────────────────

// Rate-limit audit error logs: max 3 per session, then go silent
const _auditErrorCounts = new Map();
const AUDIT_ERROR_LOG_LIMIT = 3;

class CollabStore {
  constructor(kv) {
    this.kv = kv;
  }

  async put(session) {
    await this.kv.put(session.session_id, sc.encode(JSON.stringify(session)));
    return session;
  }

  async get(sessionId) {
    const entry = await this.kv.get(sessionId);
    if (!entry || !entry.value) return null;
    return JSON.parse(sc.decode(entry.value));
  }

  async delete(sessionId) {
    await this.kv.delete(sessionId);
  }

  /**
   * Append an entry to the session's audit log. Fire-and-forget.
   */
  async appendAudit(sessionId, event, detail = {}) {
    try {
      const session = await this.get(sessionId);
      if (!session) return;
      if (!session.audit_log) session.audit_log = [];
      session.audit_log.push({
        ts: new Date().toISOString(),
        event,
        ...detail,
      });
      await this.put(session);
    } catch (err) {
      // Best-effort — never block on audit, but log first N failures per session
      const count = (_auditErrorCounts.get(sessionId) || 0) + 1;
      _auditErrorCounts.set(sessionId, count);
      if (count <= AUDIT_ERROR_LOG_LIMIT) {
        console.error(`[collab] audit append failed for ${sessionId}/${event}: ${err.message}${count === AUDIT_ERROR_LOG_LIMIT ? ' (suppressing further audit errors for this session)' : ''}`);
      }
    }
  }

  /**
   * List all sessions, optionally filtered.
   */
  async list(filter = {}) {
    const sessions = [];
    const allKeys = [];
    const keys = await this.kv.keys();
    for await (const key of keys) {
      allKeys.push(key);
    }

    for (const key of allKeys) {
      const entry = await this.kv.get(key);
      if (!entry || !entry.value) continue;
      const session = JSON.parse(sc.decode(entry.value));

      if (filter.status && session.status !== filter.status) continue;
      if (filter.task_id && session.task_id !== filter.task_id) continue;

      sessions.push(session);
    }

    sessions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return sessions;
  }

  /**
   * Find session by task ID.
   */
  async findByTaskId(taskId) {
    const sessions = await this.list({ task_id: taskId });
    return sessions[0] || null;
  }

  /**
   * Find active sessions that contain a given node.
   * O(sessions) single pass — avoids the O(sessions × nodes) scan
   * that detectStalls() previously used with list() + inner find().
   */
  async findActiveSessionsByNode(nodeId) {
    const results = [];
    const allKeys = [];
    const keys = await this.kv.keys();
    for await (const key of keys) {
      allKeys.push(key);
    }
    for (const key of allKeys) {
      const entry = await this.kv.get(key);
      if (!entry || !entry.value) continue;
      const session = JSON.parse(sc.decode(entry.value));
      if (session.status !== COLLAB_STATUS.ACTIVE) continue;
      if (session.nodes.some(n => n.node_id === nodeId)) {
        results.push(session);
      }
    }
    return results;
  }

  // ── Node Management ────────────────────────────────

  /**
   * Add a node to the session.
   * Returns the updated session or null if session full/closed.
   */
  async addNode(sessionId, nodeId, role = 'worker', scope = '*') {
    const session = await this.get(sessionId);
    if (!session) return null;
    if (session.status !== COLLAB_STATUS.RECRUITING) return null;

    // Check max_nodes
    if (session.max_nodes && session.nodes.length >= session.max_nodes) return null;

    // Check duplicate — single-threaded event loop prevents concurrent joins
    // from interleaving between find() and push(). No mutex needed.
    if (session.nodes.find(n => n.node_id === nodeId)) return null;

    session.nodes.push({
      node_id: nodeId,
      role,
      scope: Array.isArray(scope) ? scope : [scope],
      joined_at: new Date().toISOString(),
      status: 'active',
    });

    // Set recruiting deadline on first join
    if (session.nodes.length === 1) {
      session.recruiting_deadline = new Date(
        Date.now() + session.join_window_s * 1000
      ).toISOString();
    }

    // For sequential mode, build turn order
    if (session.mode === COLLAB_MODE.SEQUENTIAL) {
      session.turn_order.push(nodeId);
    }

    await this.put(session);
    return session;
  }

  /**
   * Remove a node from the session (graceful leave or kick).
   */
  async removeNode(sessionId, nodeId) {
    const session = await this.get(sessionId);
    if (!session) return null;

    session.nodes = session.nodes.filter(n => n.node_id !== nodeId);
    session.turn_order = session.turn_order.filter(id => id !== nodeId);

    await this.put(session);
    return session;
  }

  /**
   * Update a node's status within the session.
   */
  async setNodeStatus(sessionId, nodeId, status) {
    const session = await this.get(sessionId);
    if (!session) return null;

    const node = session.nodes.find(n => n.node_id === nodeId);
    if (node) node.status = status;

    await this.put(session);
    return session;
  }

  /**
   * Check if recruiting window should close.
   * Returns true if deadline passed OR max_nodes reached.
   * The caller (daemon) decides whether to start or abort based on node count.
   */
  isRecruitingDone(session) {
    if (session.max_nodes && session.nodes.length >= session.max_nodes) return true;
    if (session.recruiting_deadline && new Date() >= new Date(session.recruiting_deadline)) return true;
    return false;
  }

  // ── Round Management ───────────────────────────────

  /**
   * Start a new round. Returns the round object with shared_intel.
   */
  async startRound(sessionId) {
    const session = await this.get(sessionId);
    if (!session) return null;

    session.current_round++;
    session.status = COLLAB_STATUS.ACTIVE;

    // Snapshot recruited count on first round (immutable baseline for quorum)
    if (session.current_round === 1) {
      session.recruited_count = session.nodes.length;
    }

    // Per-round node health: prune nodes marked 'dead' before starting.
    // This prevents hanging on reflections from nodes that will never respond.
    const deadNodes = session.nodes.filter(n => n.status === 'dead');
    if (deadNodes.length > 0) {
      session.nodes = session.nodes.filter(n => n.status !== 'dead');
      session.turn_order = session.turn_order.filter(
        id => !deadNodes.find(d => d.node_id === id)
      );
    }

    // Check if we still have enough nodes after pruning
    if (session.nodes.length < session.min_nodes) {
      // Not enough active nodes to continue — will be caught by caller
      session.status = COLLAB_STATUS.ABORTED;
      await this.put(session);
      return null;
    }

    // Compile shared intel from previous round
    const sharedIntel = this.compileSharedIntel(session);

    const round = {
      round_number: session.current_round,
      started_at: new Date().toISOString(),
      completed_at: null,
      shared_intel: sharedIntel,
      reflections: [],
    };

    session.rounds.push(round);

    // Sequential mode: set first turn
    if (session.mode === COLLAB_MODE.SEQUENTIAL && session.turn_order.length > 0) {
      session.current_turn = session.turn_order[0];
    }

    await this.put(session);
    return round;
  }

  /**
   * Submit a reflection from a node for the current round.
   */
  async submitReflection(sessionId, reflection) {
    const session = await this.get(sessionId);
    if (!session) return null;

    // Only accept reflections on active sessions
    if (session.status !== COLLAB_STATUS.ACTIVE) return null;

    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound) return null;

    // Prevent duplicate reflections from same node
    if (currentRound.reflections.find(r => r.node_id === reflection.node_id)) return null;

    currentRound.reflections.push({
      node_id: reflection.node_id,
      summary: reflection.summary || '',
      learnings: reflection.learnings || '',
      artifacts: reflection.artifacts || [],
      confidence: reflection.confidence || 0.5,
      vote: reflection.vote || 'continue',
      parse_failed: reflection.parse_failed || false,
      submitted_at: new Date().toISOString(),
      // Circling Strategy extensions (optional, backward compatible)
      circling_step: reflection.circling_step ?? null,
      circling_artifacts: reflection.circling_artifacts || [],  // [{ type, content }]
    });

    // Update node status
    const node = session.nodes.find(n => n.node_id === reflection.node_id);
    if (node) node.status = 'reflecting';

    await this.put(session);
    return session;
  }

  /**
   * Check if all reflections for the current round have been received.
   */
  isRoundComplete(session) {
    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound) return false;

    const activeNodes = session.nodes.filter(n => n.status !== 'dead');
    return currentRound.reflections.length >= activeNodes.length;
  }

  /**
   * Advance to next turn in sequential mode.
   * Returns the next node_id, or null if all turns done (round complete).
   */
  async advanceTurn(sessionId) {
    const session = await this.get(sessionId);
    if (!session || session.mode !== COLLAB_MODE.SEQUENTIAL) return null;

    const currentIdx = session.turn_order.indexOf(session.current_turn);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= session.turn_order.length) {
      // All nodes had their turn — round is complete
      session.current_turn = null;
      await this.put(session);
      return null;
    }

    session.current_turn = session.turn_order[nextIdx];
    await this.put(session);
    return session.current_turn;
  }

  // ── Convergence ────────────────────────────────────

  /**
   * Check if convergence criteria are met for the current round.
   */
  checkConvergence(session) {
    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound || currentRound.reflections.length === 0) return false;

    const reflections = currentRound.reflections;
    const parseFailures = reflections.filter(r => r.parse_failed);
    const validReflections = reflections.filter(r => !r.parse_failed);
    const convergedCount = validReflections.filter(r => r.vote === 'converged').length;
    const minQuorum = session.convergence.min_quorum || session.min_nodes || 2;

    // Quorum check: enough valid votes must exist to make a decision.
    // Prevents premature convergence when nodes die (e.g., 5 recruited, 2 die,
    // 2 remaining vote converged = 100% threshold but only 2 of 5 nodes voted).
    if (validReflections.length < minQuorum) return false;

    // Parse failures are never counted as convergence votes.
    // If ANY reflection failed to parse, unanimous is impossible.
    // For majority, only valid votes count in both numerator and denominator.

    switch (session.convergence.type) {
      case CONVERGENCE.UNANIMOUS:
        // All nodes must have valid, converged votes. Any parse failure blocks unanimity.
        if (parseFailures.length > 0) return false;
        return convergedCount === reflections.length && reflections.length > 0;

      case CONVERGENCE.MAJORITY: {
        // Only valid votes count. Parse failures are excluded from both sides.
        // Threshold computed against valid votes only.
        return (convergedCount / validReflections.length) >= session.convergence.threshold;
      }

      case CONVERGENCE.COORDINATOR:
        // Coordinator mode: daemon decides externally. Always return false here.
        // The daemon calls markConverged() directly when it decides.
        return false;

      case CONVERGENCE.METRIC:
        // Metric mode: checked externally by running the metric command.
        // The daemon calls markConverged() after metric passes.
        return false;

      default:
        return false;
    }
  }

  /**
   * Check if max rounds exceeded (safety cap).
   */
  isMaxRoundsReached(session) {
    return session.current_round >= session.max_rounds;
  }

  // ── Circling Strategy: Artifact Store ──────────────

  /**
   * Store a typed artifact from a circling step.
   * Key format: sr{N}_step{S}_{nodeRole}_{artifactType}
   */
  async storeArtifact(sessionId, key, content) {
    const session = await this.get(sessionId);
    if (!session || !session.circling) return null;
    session.circling.artifacts[key] = content;

    // Session blob size check — JetStream KV max is 1MB.
    // Warn early so operators can plan external artifact store before hitting the wall.
    const blobSize = Buffer.byteLength(JSON.stringify(session), 'utf8');
    if (blobSize > 950_000) {
      console.error(`[collab] CRITICAL: session ${sessionId} blob is ${(blobSize / 1024).toFixed(0)}KB — approaching JetStream KV 1MB limit`);
    } else if (blobSize > 800_000) {
      console.warn(`[collab] WARNING: session ${sessionId} blob is ${(blobSize / 1024).toFixed(0)}KB — consider external artifact store`);
    }

    try {
      await this.put(session);
    } catch (err) {
      // JetStream KV write failure — likely blob exceeded 1MB limit.
      // Remove the artifact that caused the overflow and re-persist without it.
      console.error(`[collab] storeArtifact FAILED for ${sessionId}/${key}: ${err.message}. Removing artifact and persisting without it.`);
      delete session.circling.artifacts[key];
      await this.put(session);
      return null;
    }

    return session;
  }

  /**
   * Retrieve an artifact by key.
   */
  getArtifactByKey(session, key) {
    if (!session || !session.circling) return null;
    return session.circling.artifacts[key] || null;
  }

  /**
   * Find the most recent version of an artifact type from a given role.
   * Scans backward from (current_subround - 1) step 2 → sr0_step0 (init).
   * Returns null if not found.
   */
  getLatestArtifact(session, nodeRole, artifactType) {
    if (!session || !session.circling) return null;
    const { current_subround, artifacts } = session.circling;

    // Scan backward through sub-rounds
    for (let sr = current_subround; sr >= 0; sr--) {
      // Step 2 artifacts (produced during integration/refinement)
      if (sr > 0) {
        const key2 = `sr${sr}_step2_${nodeRole}_${artifactType}`;
        if (artifacts[key2] !== undefined) return artifacts[key2];
      }
      // Step 1 artifacts (produced during review pass)
      if (sr > 0) {
        const key1 = `sr${sr}_step1_${nodeRole}_${artifactType}`;
        if (artifacts[key1] !== undefined) return artifacts[key1];
      }
      // Init artifacts (sr0_step0)
      if (sr === 0) {
        const key0 = `sr0_step0_${nodeRole}_${artifactType}`;
        if (artifacts[key0] !== undefined) return artifacts[key0];
      }
    }
    return null;
  }

  /**
   * Build node-specific directed input for a circling step.
   * Uses the information flow matrix from the Circling Strategy protocol spec (§5).
   *
   * Returns a string containing the directed artifacts for this node at this step.
   */
  compileDirectedInput(session, nodeId, taskDescription) {
    if (!session || !session.circling) return '';
    const { phase, current_subround, current_step } = session.circling;
    const node = session.nodes.find(n => n.node_id === nodeId);
    if (!node) return '';

    const isWorker = nodeId === session.circling.worker_node_id;
    const parts = [];

    // Use stored reviewer IDs (assigned at recruiting close) for stable identity.
    // Falls back to array-index computation if IDs aren't set (backward compat).
    const reviewerLabel = (nId) => {
      if (session.circling.reviewerA_node_id && session.circling.reviewerB_node_id) {
        return nId === session.circling.reviewerA_node_id ? 'reviewerA' : 'reviewerB';
      }
      // Legacy fallback: compute from array position
      const reviewerNodes = session.nodes.filter(n => n.node_id !== session.circling.worker_node_id);
      const idx = reviewerNodes.findIndex(n => n.node_id === nId);
      return idx === 0 ? 'reviewerA' : 'reviewerB';
    };
    const myReviewerRole = !isWorker ? reviewerLabel(nodeId) : null;

    // Helper: add artifact to parts, handling null (required vs optional)
    const addArtifact = (label, nodeRole, artifactType, required) => {
      const content = this.getLatestArtifact(session, nodeRole, artifactType);
      if (content !== null) {
        parts.push(`## ${label}\n\n${content}`);
      } else if (required) {
        parts.push(`## ${label}\n\n[UNAVAILABLE: ${nodeRole}'s ${artifactType} was not produced — proceed with available inputs only]`);
      }
      // If not required and null, skip silently
    };

    switch (phase) {
      case 'init':
        parts.push(`## Task Plan\n\n${taskDescription || '(no description)'}`);
        break;

      case 'circling':
        if (current_step === 1) {
          // Step 1 — Review Pass
          if (isWorker) {
            // Worker receives: both reviewStrategies
            addArtifact('Reviewer A Strategy', 'reviewerA', 'reviewStrategy', true);
            addArtifact('Reviewer B Strategy', 'reviewerB', 'reviewStrategy', true);
            // SR2+: also include reviewArtifacts so Worker can assess whether
            // strategies are producing useful reviews (evidence alongside methodology)
            if (current_subround > 1) {
              addArtifact('Reviewer A — Review Findings', 'reviewerA', 'reviewArtifact', false);
              addArtifact('Reviewer B — Review Findings', 'reviewerB', 'reviewArtifact', false);
            }
          } else {
            // Reviewer receives: workArtifact + reconciliationDoc (optional in SR1)
            addArtifact('Work Artifact', 'worker', 'workArtifact', true);
            addArtifact('Reconciliation Document', 'worker', 'reconciliationDoc', current_subround > 1);
          }
        } else if (current_step === 2) {
          // Step 2 — Integration + Refinement
          if (isWorker) {
            // Worker receives: both reviewArtifacts
            addArtifact('Reviewer A Review', 'reviewerA', 'reviewArtifact', true);
            addArtifact('Reviewer B Review', 'reviewerB', 'reviewArtifact', true);
          } else {
            // Reviewer receives: workerReviewsAnalysis + cross-review from the other reviewer.
            // Cross-review enables inter-reviewer learning: "B caught something my
            // methodology missed — I should incorporate that lens."
            addArtifact('Worker Reviews Analysis', 'worker', 'workerReviewsAnalysis', true);
            const otherReviewerRole = (myReviewerRole === 'reviewerA') ? 'reviewerB' : 'reviewerA';
            addArtifact(`Cross-Review — ${otherReviewerRole} Findings`, otherReviewerRole, 'reviewArtifact', false);
          }
        }
        break;

      case 'finalization':
        parts.push(`## Original Task Plan\n\n${taskDescription || '(no description)'}`);
        addArtifact('Final Work Artifact', 'worker', 'workArtifact', true);
        break;
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Check if all nodes have submitted for the current circling step.
   */
  isCirclingStepComplete(session) {
    if (!session || !session.circling) return false;
    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound) return false;

    const activeNodes = session.nodes.filter(n => n.status !== 'dead');
    // For circling, reflections per step are tagged. Count reflections matching current step.
    const stepReflections = currentRound.reflections.filter(
      r => r.circling_step === session.circling.current_step
    );
    return stepReflections.length >= activeNodes.length;
  }

  /**
   * Advance the circling state machine.
   * Returns { phase, subround, step, needsGate } describing the new state.
   *
   * State machine transitions:
   *   init/step0      → circling/SR1/step1
   *   circling/step1  → circling/step2 (same SR)
   *   circling/step2 (SR < max) → circling/SR+1/step1
   *   circling/step2 (SR == max) → finalization/step0
   */
  async advanceCirclingStep(sessionId) {
    const session = await this.get(sessionId);
    if (!session || !session.circling) return null;

    const c = session.circling;
    let needsGate = false;

    if (c.phase === 'init' && c.current_step === 0) {
      // Init complete → start circling SR1/Step1
      c.phase = 'circling';
      c.current_subround = 1;
      c.current_step = 1;
    } else if (c.phase === 'circling' && c.current_step === 1) {
      // Step 1 complete → Step 2 (same subround)
      c.current_step = 2;
    } else if (c.phase === 'circling' && c.current_step === 2) {
      // Adaptive convergence: if all active nodes voted 'converged' after step 2,
      // skip remaining sub-rounds and go directly to finalization.
      const currentRound = session.rounds[session.rounds.length - 1];
      const activeNodes = session.nodes.filter(n => n.status !== 'dead');
      const step2Reflections = currentRound
        ? currentRound.reflections.filter(r => r.circling_step === 2)
        : [];
      const allConverged = step2Reflections.length >= activeNodes.length &&
                           step2Reflections.every(r => r.vote === 'converged');

      if (allConverged && c.current_subround < c.max_subrounds) {
        // Early exit — all nodes agree the work is ready
        if (c.automation_tier >= 2) {
          needsGate = true;
        }
        c.phase = 'finalization';
        c.current_step = 0;
      } else if (c.current_subround < c.max_subrounds) {
        // Step 2 complete, more sub-rounds → next SR/Step1
        // Check tier gate for Tier 3 (gates after every sub-round)
        if (c.automation_tier === 3) {
          needsGate = true;
        }
        c.current_subround++;
        c.current_step = 1;
      } else {
        // Final sub-round complete → finalization
        // Tier 2 gates on finalization entry
        if (c.automation_tier >= 2) {
          needsGate = true;
        }
        c.phase = 'finalization';
        c.current_step = 0;
      }
    } else if (c.phase === 'finalization') {
      // Finalization complete → done
      c.phase = 'complete';
    }

    await this.put(session);
    return {
      phase: c.phase,
      subround: c.current_subround,
      step: c.current_step,
      needsGate,
    };
  }

  /**
   * Record an artifact parse failure for a node at the current step.
   * Returns the failure count.
   */
  async recordArtifactFailure(sessionId, nodeId) {
    const session = await this.get(sessionId);
    if (!session || !session.circling) return 0;
    const key = `${nodeId}_sr${session.circling.current_subround}_step${session.circling.current_step}`;
    session.circling.artifact_failures[key] = (session.circling.artifact_failures[key] || 0) + 1;
    await this.put(session);
    return session.circling.artifact_failures[key];
  }

  /**
   * Get the artifact failure count for a node at the current step.
   */
  getArtifactFailureCount(session, nodeId) {
    if (!session || !session.circling) return 0;
    const key = `${nodeId}_sr${session.circling.current_subround}_step${session.circling.current_step}`;
    return session.circling.artifact_failures[key] || 0;
  }

  // ── Intel Compilation ──────────────────────────────

  /**
   * Compile shared intelligence from the previous round's reflections.
   * This is the text sent to all nodes at the start of the next round.
   */
  compileSharedIntel(session) {
    if (session.rounds.length === 0) return '';

    const prevRound = session.rounds[session.rounds.length - 1];
    if (!prevRound || prevRound.reflections.length === 0) {
      return '(First round — no prior intelligence.)';
    }

    const lines = [`=== ROUND ${prevRound.round_number} SHARED INTELLIGENCE ===\n`];

    for (const r of prevRound.reflections) {
      lines.push(`## Node: ${r.node_id}${r.parse_failed ? ' [REFLECTION PARSE FAILED]' : ''}`);
      if (r.summary) lines.push(`Summary: ${r.summary}`);
      if (r.learnings) lines.push(`Learnings: ${r.learnings}`);
      if (r.artifacts.length > 0) lines.push(`Artifacts: ${r.artifacts.join(', ')}`);
      lines.push(`Confidence: ${r.confidence} | Vote: ${r.vote}`);
      lines.push('');
    }

    const convergedCount = prevRound.reflections.filter(r => r.vote === 'converged').length;
    const totalNodes = prevRound.reflections.length;
    lines.push(`=== CONVERGENCE: ${convergedCount}/${totalNodes} voted converged. ===`);

    return lines.join('\n');
  }

  // ── Session Lifecycle ──────────────────────────────

  /**
   * Mark session as converged.
   */
  async markConverged(sessionId) {
    const session = await this.get(sessionId);
    if (!session) return null;
    session.status = COLLAB_STATUS.CONVERGED;

    // Close current round
    const currentRound = session.rounds[session.rounds.length - 1];
    if (currentRound) currentRound.completed_at = new Date().toISOString();

    await this.put(session);
    return session;
  }

  /**
   * Mark session as completed with final result.
   */
  async markCompleted(sessionId, result) {
    const session = await this.get(sessionId);
    if (!session) return null;
    session.status = COLLAB_STATUS.COMPLETED;
    session.completed_at = new Date().toISOString();
    session.result = {
      artifacts: result.artifacts || [],
      summary: result.summary || '',
      rounds_taken: session.current_round,
      node_contributions: result.node_contributions || {},
    };
    await this.put(session);
    return session;
  }

  /**
   * Mark session as aborted. Returns null (no-op) if already completed or aborted.
   * Callers can use truthiness to detect whether the abort actually happened.
   */
  async markAborted(sessionId, reason) {
    const session = await this.get(sessionId);
    if (!session) return null;
    // Guard: don't corrupt completed/aborted sessions
    if (['completed', 'aborted'].includes(session.status)) return null;
    session.status = COLLAB_STATUS.ABORTED;
    session.completed_at = new Date().toISOString();
    session.result = { success: false, summary: reason, aborted: true };
    await this.put(session);
    return session;
  }

  /**
   * Clear the audit error rate-limit counter for a session.
   * Call when a session is finalized (completed/aborted) to prevent Map leak.
   */
  clearAuditErrorCount(sessionId) {
    _auditErrorCounts.delete(sessionId);
  }

  /**
   * Get a summary of the session for reporting.
   */
  getSummary(session) {
    return {
      session_id: session.session_id,
      task_id: session.task_id,
      mode: session.mode,
      status: session.status,
      nodes: session.nodes.map(n => ({ id: n.node_id, role: n.role, status: n.status })),
      current_round: session.current_round,
      max_rounds: session.max_rounds,
      total_reflections: session.rounds.reduce((sum, r) => sum + r.reflections.length, 0),
      artifacts: session.result?.artifacts || [],
      duration_ms: session.completed_at
        ? new Date(session.completed_at) - new Date(session.created_at)
        : Date.now() - new Date(session.created_at),
    };
  }
}

module.exports = {
  createSession,
  CollabStore,
  COLLAB_STATUS,
  COLLAB_MODE,
  CONVERGENCE,
  COLLAB_KV_BUCKET,
};
