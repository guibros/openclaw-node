import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { traceCall } from "@/lib/tracer";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VaultDocument {
  filePath: string;
  category: string;     // from directory name (preferences, decisions, etc.)
  title: string;        // from frontmatter or filename
  date: string | null;
  frontmatter: Record<string, unknown>;
  content: string;      // markdown body after frontmatter
  modifiedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse a single ClawVault document with YAML frontmatter.
 *
 * Throws if the file does not exist.
 */
export function parseVaultDocument(filePath: string): VaultDocument {
  const _start = Date.now();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Vault document not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);
  const { data: frontmatter, content } = matter(raw);

  // Category from the parent directory name
  const category = path.basename(path.dirname(filePath));

  // Title: prefer frontmatter.title, fall back to filename without extension
  const title =
    typeof frontmatter.title === "string" && frontmatter.title
      ? frontmatter.title
      : path.basename(filePath, ".md");

  // Date: prefer frontmatter.date as string
  let date: string | null = null;
  if (frontmatter.date) {
    if (frontmatter.date instanceof Date) {
      date = frontmatter.date.toISOString().slice(0, 10);
    } else if (typeof frontmatter.date === "string") {
      date = frontmatter.date;
    }
  }

  const result = {
    filePath,
    category,
    title,
    date,
    frontmatter,
    content,
    modifiedAt: stat.mtime.toISOString(),
  };
  traceCall("parsers/clawvault-doc", "parseVaultDocument", _start, title);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Listing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read `.clawvault-index.json` and return all document paths with their
 * categories.  Template files are skipped.
 */
export function listVaultDocuments(
  indexPath: string
): Array<{ path: string; category: string }> {
  const _start = Date.now();
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const raw = fs.readFileSync(indexPath, "utf-8");
  let index: { documents?: Array<{ path: string; category: string }> };

  try {
    index = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse ClawVault index: ${indexPath}`);
  }

  if (!Array.isArray(index.documents)) {
    return [];
  }

  const result = index.documents
    .filter((doc) => doc.category !== "templates")
    .map((doc) => ({ path: doc.path, category: doc.category }));
  traceCall("parsers/clawvault-doc", "listVaultDocuments", _start, `${result.length} docs`);
  return result;
}
