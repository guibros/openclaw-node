/**
 * Wikilink extraction and smart cross-reference detection.
 * Pure functions — no DB dependency.
 */

/** Extract all [[wikilink]] targets from markdown content, ignoring code blocks. */
export function extractWikilinks(content: string): string[] {
  const cleaned = stripCode(content);
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const targets: string[] = [];
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const target = match[1].trim();
    if (target.length > 0 && target.length < 200) {
      targets.push(target);
    }
  }
  return [...new Set(targets)];
}

/** Extract task IDs like ARCANE-M01, T-20260305-001 */
export function extractTaskIds(content: string): string[] {
  const cleaned = stripCode(content);
  const regex = /\b(ARCANE-[A-Z0-9]+(?:-\d+)?|T-\d{8}-\d+)\b/g;
  const ids: string[] = [];
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

/** Extract file references — paths ending in known extensions mentioned in text */
export function extractFileRefs(content: string): string[] {
  const cleaned = stripCode(content);
  // Match paths like: some/path/file.ext or just file.ext
  const regex = /(?:[\w./-]+\/)?[\w.-]+\.(?:md|sol|ts|tsx|js|json|yaml|yml|pdf|txt)\b/g;
  const refs: string[] = [];
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const ref = match[0];
    // Skip things that are clearly not file refs
    if (ref.includes("http") || ref.length < 4) continue;
    refs.push(ref);
  }
  return [...new Set(refs)];
}

/** Strip fenced code blocks and inline code */
function stripCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
}

export interface ResolutionMaps {
  byPath: Map<string, string>;
  byBasename: Map<string, string>;
  byTitle: Map<string, string>;
}

/** Build lookup maps for resolving targets to file paths. */
export function buildResolutionMaps(
  docs: Array<{ filePath: string; title: string | null }>
): ResolutionMaps {
  const byPath = new Map<string, string>();
  const byBasename = new Map<string, string>();
  const byTitle = new Map<string, string>();

  for (const doc of docs) {
    byPath.set(doc.filePath, doc.filePath);
    if (!doc.filePath.endsWith(".md")) {
      byPath.set(doc.filePath + ".md", doc.filePath);
    }

    const basename =
      doc.filePath.split("/").pop()?.replace(/\.md$/, "") || "";
    if (basename) {
      const lower = basename.toLowerCase();
      if (!byBasename.has(lower)) {
        byBasename.set(lower, doc.filePath);
      }
    }

    if (doc.title) {
      const lower = doc.title.toLowerCase();
      if (!byTitle.has(lower)) {
        byTitle.set(lower, doc.filePath);
      }
    }
  }

  return { byPath, byBasename, byTitle };
}

/** Resolve a reference to a file path. Priority: exact path → basename → title. */
export function resolveWikilink(
  target: string,
  maps: ResolutionMaps
): string | null {
  if (maps.byPath.has(target)) return maps.byPath.get(target)!;
  if (maps.byPath.has(target + ".md"))
    return maps.byPath.get(target + ".md")!;

  const lower = target.toLowerCase();
  if (maps.byBasename.has(lower)) return maps.byBasename.get(lower)!;
  if (maps.byTitle.has(lower)) return maps.byTitle.get(lower)!;

  return null;
}

/**
 * Extract ALL cross-references from a document.
 * Combines: [[wikilinks]], task IDs, file path mentions.
 * Returns deduplicated list of resolved file paths.
 */
export function extractAllReferences(
  content: string,
  maps: ResolutionMaps,
  selfPath: string
): string[] {
  const resolved = new Set<string>();

  // 1. Explicit [[wikilinks]]
  for (const target of extractWikilinks(content)) {
    const r = resolveWikilink(target, maps);
    if (r && r !== selfPath) resolved.add(r);
  }

  // 2. Task IDs → check if any doc has that as its basename or title
  for (const taskId of extractTaskIds(content)) {
    const r = resolveWikilink(taskId, maps);
    if (r && r !== selfPath) resolved.add(r);
  }

  // 3. File path mentions
  for (const fileRef of extractFileRefs(content)) {
    const r = resolveWikilink(fileRef, maps);
    if (r && r !== selfPath) resolved.add(r);
    // Also try just the basename
    const basename = fileRef.split("/").pop()?.replace(/\.\w+$/, "") || "";
    if (basename) {
      const r2 = resolveWikilink(basename, maps);
      if (r2 && r2 !== selfPath) resolved.add(r2);
    }
  }

  return [...resolved];
}
