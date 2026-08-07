"use client";

/**
 * Renders the terminal agent's prose as markdown — matched to the terminal's
 * monospace / single-violet-accent aesthetic. The model emits markdown
 * (**bold**, lists, `code`, headings); without this it shows raw asterisks.
 *
 * Compact spacing so it still reads like a terminal, not a doc page. Mirrors
 * the inline-override approach already used in alert-story-panel.tsx (no
 * remark/rehype plugins in the app).
 */

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { ACCENT } from "@/components/assistant/terminal-theme";

const components: Components = {
  // Tight paragraph rhythm — first child has no top margin.
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
      style={{ color: ACCENT }}
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-2 ml-1 list-none space-y-1 first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="relative pl-4 marker:text-muted-foreground">
      <span
        className="absolute left-0 top-0 select-none"
        style={{ color: ACCENT }}
      >
        ›
      </span>
      {children}
    </li>
  ),
  code: ({ children, className }) => {
    // Fenced block (has a language- class or multiline) vs inline.
    const isBlock = /\n/.test(String(children)) || className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block whitespace-pre overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-[12.5px]">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 text-[12.5px] text-foreground">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2 first:mt-0 last:mb-0">{children}</pre>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-[14px] font-semibold text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-[13.5px] font-semibold text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-[13px] font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  blockquote: ({ children }) => (
    <blockquote
      className="my-2 border-l-2 pl-3 text-muted-foreground first:mt-0 last:mb-0"
      style={{ borderColor: ACCENT }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

export function TerminalMarkdown({ text }: { text: string }) {
  return (
    <div className="text-foreground/90 [word-break:break-word]">
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  );
}
