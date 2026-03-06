"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { FileText, BookOpen, Database, BookMarked, X } from "lucide-react";
import type { MemoryDoc, WikilinkNode } from "@/lib/hooks";

const SOURCE_LABELS: Record<
  string,
  { label: string; icon: typeof FileText }
> = {
  daily_log: { label: "Daily Log", icon: FileText },
  long_term_memory: { label: "Long-Term Memory", icon: BookOpen },
  clawvault: { label: "ClawVault", icon: Database },
  lore: { label: "Lore", icon: BookMarked },
  workspace: { label: "Workspace", icon: FileText },
};

interface ObsidianReaderProps {
  doc: MemoryDoc | null;
  filePath: string;
  isLoading: boolean;
  onWikilinkClick: (targetPath: string) => void;
  onClose: () => void;
  allDocs: WikilinkNode[];
}

export function ObsidianReader({
  doc,
  filePath,
  isLoading,
  onWikilinkClick,
  onClose,
  allDocs,
}: ObsidianReaderProps) {
  // Client-side resolution map for instant wikilink navigation
  const resolveMap = useMemo(() => {
    const byBasename = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const d of allDocs) {
      const basename =
        d.id.split("/").pop()?.replace(/\.md$/, "")?.toLowerCase() || "";
      if (basename && !byBasename.has(basename))
        byBasename.set(basename, d.id);
      if (d.title && !byTitle.has(d.title.toLowerCase()))
        byTitle.set(d.title.toLowerCase(), d.id);
    }
    return { byBasename, byTitle };
  }, [allDocs]);

  // Pre-process markdown: replace [[target]] with wikilink:// protocol links
  const processedContent = useMemo(() => {
    if (!doc) return "";
    return doc.content.replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, target, alias) => {
        const displayText = alias || target;
        const lower = target.trim().toLowerCase();
        const resolved =
          resolveMap.byBasename.get(lower) || resolveMap.byTitle.get(lower);
        if (resolved) {
          return `[${displayText}](wikilink://${encodeURIComponent(resolved)})`;
        }
        // Unresolved — render as dimmed
        return `*${displayText}*`;
      }
    );
  }, [doc, resolveMap]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-3 animate-pulse">
        <div className="h-6 w-1/2 bg-muted rounded" />
        <div className="h-4 w-1/4 bg-muted rounded" />
        <div className="mt-4 space-y-2">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="h-3 bg-muted rounded"
              style={{ width: `${60 + Math.random() * 40}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground/50">
        Document not found
      </div>
    );
  }

  const sourceInfo = SOURCE_LABELS[doc.source] ?? SOURCE_LABELS.daily_log;
  const Icon = sourceInfo.icon;

  let dateStr = "";
  if (doc.date) {
    try {
      dateStr = format(new Date(doc.date), "MMMM d, yyyy");
    } catch {
      dateStr = doc.date;
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {doc.title ?? filePath.split("/").pop()}
          </h2>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Icon className="h-3 w-3" />
              {sourceInfo.label}
            </span>
            {dateStr && <span>{dateStr}</span>}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-6 py-4">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-xl font-bold text-foreground mt-6 mb-3 first:mt-0">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-lg font-semibold text-foreground mt-5 mb-2">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-base font-semibold text-foreground mt-4 mb-1.5">
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p className="text-sm leading-relaxed text-foreground/90 mb-3">
                {children}
              </p>
            ),
            ul: ({ children }) => (
              <ul className="list-disc list-inside text-sm text-foreground/90 mb-3 space-y-1 pl-2">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal list-inside text-sm text-foreground/90 mb-3 space-y-1 pl-2">
                {children}
              </ol>
            ),
            li: ({ children }) => (
              <li className="leading-relaxed">{children}</li>
            ),
            code: ({ className, children }) => {
              const isBlock = className?.includes("language-");
              if (isBlock) {
                return (
                  <code className="block bg-background rounded-md p-3 text-xs font-mono text-foreground/90 overflow-x-auto my-3">
                    {children}
                  </code>
                );
              }
              return (
                <code className="bg-muted rounded px-1 py-0.5 text-xs font-mono text-foreground">
                  {children}
                </code>
              );
            },
            pre: ({ children }) => <pre className="my-3">{children}</pre>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-primary pl-3 my-3 text-sm text-muted-foreground italic">
                {children}
              </blockquote>
            ),
            a: ({ href, children }) => {
              // Intercept wikilink:// protocol
              if (href?.startsWith("wikilink://")) {
                const targetPath = decodeURIComponent(
                  href.replace("wikilink://", "")
                );
                return (
                  <button
                    onClick={() => onWikilinkClick(targetPath)}
                    className="text-purple-400 hover:text-purple-300 underline underline-offset-2 cursor-pointer"
                  >
                    {children}
                  </button>
                );
              }
              return (
                <a
                  href={href}
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              );
            },
            table: ({ children }) => (
              <div className="overflow-x-auto my-3">
                <table className="w-full text-sm border-collapse">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-border px-3 py-1.5 text-left font-semibold text-foreground bg-muted">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-3 py-1.5 text-foreground/90">
                {children}
              </td>
            ),
            hr: () => <hr className="border-border my-4" />,
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">
                {children}
              </strong>
            ),
          }}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
