"use client";

import { useMemo, Fragment, type ReactNode } from "react";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

interface TextPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface TextConfig {
  content?: string;
  fontSize?: "sm" | "base" | "lg" | "xl" | "2xl";
  align?: "left" | "center" | "right";
  verticalCenter?: boolean;
  color?: string;
}

/**
 * Parse inline markdown elements into React nodes (safe, no innerHTML)
 */
function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold **text**
    let match = remaining.match(/^([\s\S]*?)\*\*(.+?)\*\*([\s\S]*)/);
    if (match) {
      if (match[1]) nodes.push(<Fragment key={key++}>{parseInline(match[1])}</Fragment>);
      nodes.push(<strong key={key++} className="font-semibold">{parseInline(match[2])}</strong>);
      remaining = match[3];
      continue;
    }

    // Strikethrough ~~text~~
    match = remaining.match(/^([\s\S]*?)~~(.+?)~~([\s\S]*)/);
    if (match) {
      if (match[1]) nodes.push(<Fragment key={key++}>{parseInline(match[1])}</Fragment>);
      nodes.push(<del key={key++} className="line-through">{parseInline(match[2])}</del>);
      remaining = match[3];
      continue;
    }

    // Italic *text*
    match = remaining.match(/^([\s\S]*?)\*(.+?)\*([\s\S]*)/);
    if (match) {
      if (match[1]) nodes.push(<Fragment key={key++}>{parseInline(match[1])}</Fragment>);
      nodes.push(<em key={key++} className="italic">{parseInline(match[2])}</em>);
      remaining = match[3];
      continue;
    }

    // Inline code `text`
    match = remaining.match(/^([\s\S]*?)`(.+?)`([\s\S]*)/);
    if (match) {
      if (match[1]) nodes.push(<Fragment key={key++}>{match[1]}</Fragment>);
      nodes.push(
        <code key={key++} className="px-1.5 py-0.5 rounded bg-muted font-mono text-sm">
          {match[2]}
        </code>
      );
      remaining = match[3];
      continue;
    }

    // Links [text](url)
    match = remaining.match(/^([\s\S]*?)\[(.+?)\]\((.+?)\)([\s\S]*)/);
    if (match) {
      if (match[1]) nodes.push(<Fragment key={key++}>{match[1]}</Fragment>);
      nodes.push(
        <a
          key={key++}
          href={match[3]}
          className="text-primary underline underline-offset-2 hover:text-primary/80"
          target="_blank"
          rel="noopener noreferrer"
        >
          {match[2]}
        </a>
      );
      remaining = match[4];
      continue;
    }

    // No more matches - push remaining text
    nodes.push(<Fragment key={key++}>{remaining}</Fragment>);
    break;
  }

  return nodes;
}

/**
 * Parse markdown content into React elements (safe rendering, no dangerouslySetInnerHTML)
 */
function parseMarkdown(content: string): ReactNode[] {
  const lines = content.split("\n");
  const elements: ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<hr key={key++} className="my-4 border-border" />);
      i++;
      continue;
    }

    // Headers
    const h3Match = line.match(/^### (.+)$/);
    if (h3Match) {
      elements.push(<h3 key={key++} className="text-lg font-semibold mt-4 mb-2">{parseInline(h3Match[1])}</h3>);
      i++;
      continue;
    }

    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      elements.push(<h2 key={key++} className="text-xl font-semibold mt-4 mb-2">{parseInline(h2Match[1])}</h2>);
      i++;
      continue;
    }

    const h1Match = line.match(/^# (.+)$/);
    if (h1Match) {
      elements.push(<h1 key={key++} className="text-2xl font-semibold mt-4 mb-2">{parseInline(h1Match[1])}</h1>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={key++} className="border-l-2 border-border pl-4 my-3 text-muted-foreground italic">
          {quoteLines.map((ql, qi) => (
            <p key={qi} className={qi > 0 ? "mt-1" : ""}>{parseInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*+] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+] /, ""));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-2 ml-4 space-y-1 list-disc list-outside">
          {items.map((item, ii) => (
            <li key={ii} className="text-foreground">{parseInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-2 ml-4 space-y-1 list-decimal list-outside">
          {items.map((item, ii) => (
            <li key={ii} className="text-foreground">{parseInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph - collect consecutive non-empty, non-special lines
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("> ") &&
      !/^[-*+] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^\*\*\*+$/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }

    if (paragraphLines.length > 0) {
      elements.push(
        <p key={key++} className="my-2 leading-relaxed">
          {paragraphLines.map((pl, pi) => (
            <Fragment key={pi}>
              {pi > 0 && <br />}
              {parseInline(pl)}
            </Fragment>
          ))}
        </p>
      );
    }
  }

  return elements;
}

/**
 * Text Panel - Displays static text content with safe markdown rendering
 */
export function TextPanel({ panel }: TextPanelProps) {
  const config = panel.config as unknown as TextConfig;
  const content = config.content || panel.title || "No content";
  const fontSize = config.fontSize || "base";
  const align = config.align || "left";
  const verticalCenter = config.verticalCenter ?? false;

  const fontSizeClasses = {
    sm: "text-sm",
    base: "text-base",
    lg: "text-lg",
    xl: "text-xl",
    "2xl": "text-2xl",
  };

  const alignClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  const rendered = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div
      className={cn(
        "h-full w-full overflow-auto p-4",
        fontSizeClasses[fontSize],
        alignClasses[align],
        verticalCenter && "flex items-center"
      )}
    >
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground w-full">
        {rendered}
      </div>
    </div>
  );
}
