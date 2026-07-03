/**
 * readonly-sql.mjs — hardened read-only SQL access to a SQLite database.
 *
 * Pattern adopted from ctxrs/ctx's MCP `sql` tool (SCOPE addendum 2026-07-03d),
 * layered defense:
 *   1. connection opened readonly + fileMustExist
 *   2. PRAGMA query_only = ON
 *   3. single statement only (better-sqlite3 prepare() rejects multi-statement)
 *   4. first keyword must be SELECT / WITH / VALUES / EXPLAIN — blocks ATTACH
 *      and PRAGMA, which sqlite3_stmt_readonly() reports as read-only even
 *      though they widen the read surface or mutate connection state
 *   5. stmt.readonly + stmt.reader checks
 *   6. row count / value byte / sql byte caps, blobs never returned raw
 *
 * Known limitation: better-sqlite3 exposes no progress handler, so there is
 * NO query timeout — a pathological join runs to completion. The MCP server
 * process is disposable; that is the mitigation.
 *
 * @module lib/readonly-sql
 */

import Database from 'better-sqlite3';

export const DEFAULT_MAX_ROWS = 200;
export const DEFAULT_MAX_VALUE_BYTES = 2048;
export const DEFAULT_MAX_SQL_BYTES = 8192;

const ALLOWED_FIRST_KEYWORDS = new Set(['SELECT', 'WITH', 'VALUES', 'EXPLAIN']);

/** Strip leading SQL comments/whitespace and return the first keyword, uppercased. */
export function firstKeyword(sql) {
  let s = sql;
  for (;;) {
    s = s.replace(/^\s+/, '');
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      if (nl === -1) return '';
      s = s.slice(nl + 1);
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      if (end === -1) return '';
      s = s.slice(end + 2);
    } else {
      break;
    }
  }
  const m = s.match(/^[A-Za-z_]+/);
  return m ? m[0].toUpperCase() : '';
}

function clampValue(v, maxValueBytes) {
  if (Buffer.isBuffer(v)) return `<blob ${v.length} bytes>`;
  if (typeof v === 'string' && Buffer.byteLength(v, 'utf8') > maxValueBytes) {
    let cut = v.slice(0, maxValueBytes);
    while (Buffer.byteLength(cut, 'utf8') > maxValueBytes) cut = cut.slice(0, -1);
    return `${cut}…[truncated]`;
  }
  return v;
}

/**
 * Open a database for read-only querying.
 *
 * @param {{ dbPath: string, maxRows?: number, maxValueBytes?: number, maxSqlBytes?: number }} opts
 * @returns {{ query: (sql: string, params?: any[]|object) => {columns: string[], rows: object[], rowCount: number, truncated: boolean}, schema: () => Array<{type: string, name: string, sql: string}>, close: () => void }}
 */
export function createReadonlyQuery(opts) {
  const unknown = Object.keys(opts).filter(
    (k) => !['dbPath', 'maxRows', 'maxValueBytes', 'maxSqlBytes'].includes(k)
  );
  if (unknown.length) {
    throw new Error(`createReadonlyQuery: unknown option(s) ${unknown.join(', ')}`);
  }
  if (!opts.dbPath) throw new Error('createReadonlyQuery: dbPath is required');
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const maxValueBytes = opts.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES;
  const maxSqlBytes = opts.maxSqlBytes ?? DEFAULT_MAX_SQL_BYTES;

  const db = new Database(opts.dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');

  function query(sql, params = []) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new Error('sql must be a non-empty string');
    }
    if (Buffer.byteLength(sql, 'utf8') > maxSqlBytes) {
      throw new Error(`sql exceeds ${maxSqlBytes} bytes`);
    }
    const kw = firstKeyword(sql);
    if (!ALLOWED_FIRST_KEYWORDS.has(kw)) {
      throw new Error(
        `statement must start with SELECT, WITH, VALUES or EXPLAIN (got ${kw || 'nothing'})`
      );
    }
    const stmt = db.prepare(sql);
    if (!stmt.readonly) throw new Error('write statements are not allowed');
    if (!stmt.reader) throw new Error('statement returns no rows');

    const columns = stmt.columns().map((c) => c.name);
    const rows = [];
    let truncated = false;
    for (const row of stmt.iterate(params)) {
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      const out = {};
      for (const col of columns) out[col] = clampValue(row[col], maxValueBytes);
      rows.push(out);
    }
    return { columns, rows, rowCount: rows.length, truncated };
  }

  function schema() {
    return db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
      )
      .all();
  }

  return { query, schema, close: () => db.close() };
}
