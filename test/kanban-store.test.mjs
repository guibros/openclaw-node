import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { createKanbanStore } from '../lib/kanban-store.mjs';

/**
 * Tests for the kanban-store module (Step 4.5).
 *
 * Validates the tasks_observed table creation, full/summary projection,
 * provenance columns, querying, and stats.
 */

function tmpDbPath() {
  return path.join(os.tmpdir(), `kanban-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('createKanbanStore', () => {
  let store;
  let dbPath;

  before(() => {
    dbPath = tmpDbPath();
    store = createKanbanStore({ dbPath });
  });

  after(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('creates tasks_observed table with provenance columns', () => {
    // Verify table exists and has provenance columns from the start
    const db = new Database(dbPath, { readonly: true });
    const cols = db.pragma('table_info(tasks_observed)');
    const colNames = cols.map(c => c.name);
    db.close();

    assert.ok(colNames.includes('task_id'), 'has task_id column');
    assert.ok(colNames.includes('event_type'), 'has event_type column');
    assert.ok(colNames.includes('owner'), 'has owner column');
    assert.ok(colNames.includes('title'), 'has title column');
    assert.ok(colNames.includes('status'), 'has status column');
    assert.ok(colNames.includes('priority'), 'has priority column');
    assert.ok(colNames.includes('data_json'), 'has data_json column');
    assert.ok(colNames.includes('is_owned'), 'has is_owned column');
    assert.ok(colNames.includes('received_at'), 'has received_at column');
    assert.ok(colNames.includes('source_type'), 'has source_type column');
    assert.ok(colNames.includes('source_node'), 'has source_node column');
    assert.ok(colNames.includes('source_event_id'), 'has source_event_id column');
  });

  it('full projection for owned task stores all fields', () => {
    const event = {
      event_id: 'evt-001',
      event_type: 'kanban.task_created',
      entity_id: 'task-abc',
      data: {
        task_id: 'task-abc',
        owner: 'my-node',
        title: 'Fix memory leak',
        status: 'todo',
        priority: 'high',
        description: 'There is a memory leak in the daemon',
      },
    };

    store.projectKanbanEvent(event, 'my-node', {
      source_type: 'shared',
      source_node: 'other-node',
      source_event_id: 'evt-001',
    });

    const row = store.getTaskById('task-abc');
    assert.ok(row, 'task found');
    assert.equal(row.task_id, 'task-abc');
    assert.equal(row.event_type, 'kanban.task_created');
    assert.equal(row.owner, 'my-node');
    assert.equal(row.title, 'Fix memory leak');
    assert.equal(row.status, 'todo');
    assert.equal(row.priority, 'high');
    assert.equal(row.is_owned, 1);
    assert.ok(row.data_json, 'data_json stored for owned task');
    const parsed = JSON.parse(row.data_json);
    assert.equal(parsed.description, 'There is a memory leak in the daemon');
    assert.equal(row.source_type, 'shared');
    assert.equal(row.source_node, 'other-node');
    assert.equal(row.source_event_id, 'evt-001');
  });

  it('summary projection for non-owned task stores only id/owner/status', () => {
    const event = {
      event_id: 'evt-002',
      event_type: 'kanban.task_updated',
      entity_id: 'task-xyz',
      data: {
        task_id: 'task-xyz',
        owner: 'remote-node',
        title: 'Deploy new version',
        status: 'in_progress',
        priority: 'medium',
        description: 'Deploy v2.0 to production',
      },
    };

    store.projectKanbanEvent(event, 'my-node', {
      source_type: 'shared',
      source_node: 'remote-node',
      source_event_id: 'evt-002',
    });

    const row = store.getTaskById('task-xyz');
    assert.ok(row, 'task found');
    assert.equal(row.task_id, 'task-xyz');
    assert.equal(row.owner, 'remote-node');
    assert.equal(row.status, 'in_progress');
    assert.equal(row.is_owned, 0);
    assert.equal(row.title, null, 'title null in summary projection');
    assert.equal(row.priority, null, 'priority null in summary projection');
    assert.equal(row.data_json, null, 'data_json null in summary projection');
  });

  it('getObservedTasks filters by ownedOnly', () => {
    const owned = store.getObservedTasks({ ownedOnly: true });
    assert.ok(owned.length > 0, 'has owned tasks');
    for (const row of owned) {
      assert.equal(row.is_owned, 1, 'all results are owned');
    }
  });

  it('getObservedTasks filters by sourceType', () => {
    const shared = store.getObservedTasks({ sourceType: 'shared' });
    assert.ok(shared.length >= 2, 'has shared-source tasks');
    for (const row of shared) {
      assert.equal(row.source_type, 'shared');
    }
  });

  it('getTaskById returns latest event for a task with multiple events', () => {
    // Insert a second event for task-abc (status change)
    const event = {
      event_id: 'evt-003',
      event_type: 'kanban.task_updated',
      entity_id: 'task-abc',
      data: {
        task_id: 'task-abc',
        owner: 'my-node',
        title: 'Fix memory leak',
        status: 'in_progress',
        priority: 'high',
      },
    };

    store.projectKanbanEvent(event, 'my-node', {
      source_type: 'shared',
      source_node: 'other-node',
      source_event_id: 'evt-003',
    });

    const latest = store.getTaskById('task-abc');
    assert.equal(latest.status, 'in_progress', 'returns latest event');
    assert.equal(latest.event_type, 'kanban.task_updated');
  });

  it('getStats returns correct counts', () => {
    const stats = store.getStats();
    assert.equal(stats.total, 3, '3 total events projected');
    assert.equal(stats.owned, 2, '2 owned events (task-abc x2)');
    assert.equal(stats.summary, 1, '1 summary event (task-xyz)');
    assert.equal(stats.sharedCount, 3, 'all 3 from shared source');
    assert.equal(stats.localCount, 0, '0 local-source events');
  });

  it('handles event without owner field gracefully', () => {
    const event = {
      event_id: 'evt-004',
      event_type: 'kanban.task_deleted',
      entity_id: 'task-orphan',
      data: {
        task_id: 'task-orphan',
        status: 'deleted',
        // no owner field
      },
    };

    store.projectKanbanEvent(event, 'my-node');

    const row = store.getTaskById('task-orphan');
    assert.ok(row, 'task found');
    assert.equal(row.owner, null, 'owner is null');
    assert.equal(row.is_owned, 0, 'not owned when owner is null');
    assert.equal(row.source_type, 'local', 'default provenance is local');
  });
});
