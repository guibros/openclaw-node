/**
 * Memory Content API — the ACTUAL remembered content from the live state.db.
 *
 * GET /api/memory-content                  — entities + decisions + themes (top by salience/recency)
 * GET /api/memory-content?session=<id>     — only content tied to one session (watcher drill-down)
 * GET /api/memory-content?q=<text>         — filter entities/decisions/themes by text
 * GET /api/memory-content?entity=<name>    — one entity's vault concept-note prose (the human description)
 *
 * Read-only: state.db is owned by the live daemon. We open it readonly and never migrate it.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { STATE_DB_PATH, OBSIDIAN_DIR } from "@/lib/config";

export const dynamic = "force-dynamic";

let _db: Database.Database | null = null;
function db(): Database.Database | null {
  if (_db) return _db;
  if (!fs.existsSync(STATE_DB_PATH)) return null;
  _db = new Database(STATE_DB_PATH, { readonly: true, fileMustExist: true });
  return _db;
}

// entity name → vault concept-note slug. MUST stay byte-equivalent to
// lib/obsidian-summarizer.mjs slugifyName (the writer that names the files);
// test/slugify-parity.test.mjs locks the two together (R7, repair 2.2).
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Read the prose body (everything after frontmatter) of a concept note, if present.
function conceptProse(name: string): string | null {
  try {
    const file = path.join(OBSIDIAN_DIR, "concepts", `${slugify(name)}.md`);
    const raw = fs.readFileSync(file, "utf-8");
    const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
    return body || null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const d = db();
  if (!d) {
    return NextResponse.json({ error: "state.db not found", path: STATE_DB_PATH }, { status: 503 });
  }

  const p = request.nextUrl.searchParams;
  const session = p.get("session");
  const q = p.get("q");
  const entity = p.get("entity");
  const limit = Math.min(Math.max(parseInt(p.get("limit") || "50", 10) || 50, 1), 300);

  try {
    // Single-entity prose lookup (the human-readable description from the vault).
    if (entity) {
      const row = d
        .prepare("SELECT name, type, mention_count, salience, last_seen FROM entities WHERE name = ?")
        .get(entity) as Record<string, unknown> | undefined;
      return NextResponse.json({ entity: row ?? null, prose: conceptProse(entity) });
    }

    const like = q ? `%${q}%` : null;

    // ENTITIES — what the AI currently knows, ranked by salience then recency.
    const entities = session
      ? (d
          .prepare(
            `SELECT DISTINCT e.name, e.type, e.mention_count, e.salience, e.last_seen
             FROM entities e JOIN mentions m ON m.entity_id = e.id
             WHERE m.session_id = ? ORDER BY e.salience DESC, e.mention_count DESC LIMIT ?`,
          )
          .all(session, limit) as Record<string, unknown>[])
      : (d
          .prepare(
            `SELECT name, type, mention_count, salience, last_seen FROM entities
             ${like ? "WHERE name LIKE ?" : ""}
             ORDER BY salience DESC, mention_count DESC LIMIT ?`,
          )
          .all(...(like ? [like, limit] : [limit])) as Record<string, unknown>[]);

    // DECISIONS — the richest content: decision text + rationale + confidence.
    const decisions = (d
      .prepare(
        `SELECT decision, rationale, confidence, session_id, created_at FROM decisions
         ${session ? "WHERE session_id = ?" : like ? "WHERE decision LIKE ? OR rationale LIKE ?" : ""}
         ORDER BY created_at DESC, confidence DESC LIMIT ?`,
      )
      .all(...(session ? [session, limit] : like ? [like, like, limit] : [limit])) as Record<string, unknown>[]);

    // THEMES — labels + parsed hierarchy path.
    const themesRaw = session
      ? []
      : (d
          .prepare(
            `SELECT label, hierarchy_path, mention_count, last_seen FROM themes
             ${like ? "WHERE label LIKE ?" : ""}
             ORDER BY mention_count DESC, last_seen DESC LIMIT ?`,
          )
          .all(...(like ? [like, limit] : [limit])) as Record<string, unknown>[]);
    const themes = themesRaw.map((t) => {
      let hierarchy: string[] = [];
      try {
        hierarchy = JSON.parse(String(t.hierarchy_path || "[]"));
      } catch {
        hierarchy = [];
      }
      return { label: t.label, mention_count: t.mention_count, last_seen: t.last_seen, hierarchy };
    });

    const counts = {
      entities: (d.prepare("SELECT COUNT(*) c FROM entities").get() as { c: number }).c,
      decisions: (d.prepare("SELECT COUNT(*) c FROM decisions").get() as { c: number }).c,
      themes: (d.prepare("SELECT COUNT(*) c FROM themes").get() as { c: number }).c,
    };

    return NextResponse.json({ entities, decisions, themes, counts, session: session ?? null, source: STATE_DB_PATH });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
