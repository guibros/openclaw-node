import fs from "fs";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MemorySection {
  heading: string;
  content: string;
}

export interface LongTermMemory {
  filePath: string;
  title: string;
  sections: MemorySection[];
  fullContent: string;
  modifiedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse MEMORY.md into a title, structured sections, and the raw content.
 *
 * Sections are split on `## ` headings.  The H1 heading becomes the title.
 *
 * Throws if the file does not exist.
 */
export function parseMemoryMd(filePath: string): LongTermMemory {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Memory file not found: ${filePath}`);
  }

  const fullContent = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);

  // Extract title from first H1 heading
  const titleMatch = fullContent.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "MEMORY.md";

  // Split into ## sections
  const sections: MemorySection[] = [];
  const lines = fullContent.split("\n");

  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (currentHeading !== null) {
      sections.push({
        heading: currentHeading,
        content: currentLines.join("\n").trim(),
      });
    }
  }

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flush();
      currentHeading = h2Match[1].trim();
      currentLines = [];
      continue;
    }
    if (currentHeading !== null) {
      currentLines.push(line);
    }
  }

  flush();

  return {
    filePath,
    title,
    sections,
    fullContent,
    modifiedAt: stat.mtime.toISOString(),
  };
}
