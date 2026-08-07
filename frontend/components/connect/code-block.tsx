"use client";

import { useState, useMemo } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";

interface CodeBlockProps {
  code: string;
  language?: string;
  onCopy?: () => void;
  /**
   * Highlight every occurrence of this substring with the .hlh accent (a
   * violet pill). Works inside strings and comments too — the tokenizer
   * splits the surrounding span so the highlight always sits on top.
   */
  highlight?: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  py: "Python",
  cpp: "C++",
  c: "C",
  bash: "Bash",
  shell: "Shell",
  sql: "SQL",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  json: "JSON",
  ini: "INI",
  text: "Text",
};

// Lightweight syntax highlighting — covers the 4 languages actually used
// (python, cpp, bash, text) without pulling in shiki (~300KB).

const KEYWORDS: Record<string, Set<string>> = {
  python: new Set([
    "import",
    "from",
    "def",
    "class",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "in",
    "not",
    "and",
    "or",
    "is",
    "None",
    "True",
    "False",
    "with",
    "as",
    "try",
    "except",
    "finally",
    "raise",
    "pass",
    "break",
    "continue",
    "yield",
    "async",
    "await",
    "lambda",
    "self",
  ]),
  cpp: new Set([
    "include",
    "define",
    "int",
    "void",
    "char",
    "float",
    "double",
    "bool",
    "return",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "class",
    "struct",
    "public",
    "private",
    "protected",
    "static",
    "const",
    "nullptr",
    "true",
    "false",
    "new",
    "delete",
    "sizeof",
    "typedef",
    "using",
    "namespace",
    "template",
    "auto",
    "unsigned",
    "long",
    "short",
  ]),
  bash: new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "do",
    "done",
    "while",
    "case",
    "esac",
    "function",
    "return",
    "exit",
    "echo",
    "export",
    "source",
    "local",
    "readonly",
    "shift",
    "set",
    "unset",
    "cd",
    "sudo",
    "apt",
    "pip",
    "npm",
    "curl",
    "wget",
    "chmod",
    "mkdir",
    "install",
    "pip3",
    "python3",
    "docker",
    "git",
  ]),
};

/**
 * Wrap `content` in a span with `spanClass`, splitting at every occurrence
 * of `highlight` so the highlight pill renders on top of the surrounding
 * token (string, comment, plain text). Empty `spanClass` skips the wrap.
 */
function wrapWithHighlight(
  content: string,
  spanClass: string,
  highlight: string | undefined,
): string {
  const wrap = (s: string) =>
    spanClass
      ? `<span class="${spanClass}">${escapeHtml(s)}</span>`
      : escapeHtml(s);

  if (!highlight || !content.includes(highlight)) return wrap(content);

  return content
    .split(highlight)
    .map(wrap)
    .join(`<span class="hlh">${escapeHtml(highlight)}</span>`);
}

function highlightLine(line: string, lang: string, highlight?: string): string {
  if (!lang || lang === "text") return wrapWithHighlight(line, "", highlight);

  // C shares C++'s tokenizer (preprocessor, // comments, keyword set). The
  // label stays "C" — only the syntax pass is aliased.
  if (lang === "c") lang = "cpp";

  const keywords = KEYWORDS[lang] || KEYWORDS.bash;
  let result = "";
  let i = 0;

  while (i < line.length) {
    // Comments
    if (
      (lang === "python" && line[i] === "#") ||
      (lang === "bash" && line[i] === "#") ||
      (lang === "cpp" && line[i] === "/" && line[i + 1] === "/")
    ) {
      result += wrapWithHighlight(line.slice(i), "hlc", highlight);
      break;
    }

    // Preprocessor directives (C/C++)
    if (lang === "cpp" && line[i] === "#") {
      result += wrapWithHighlight(line.slice(i), "hlp", highlight);
      break;
    }

    // Strings
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, line.length);
      result += wrapWithHighlight(line.slice(i, j), "hls", highlight);
      i = j;
      continue;
    }

    // Highlight token at this position (lets it pop on plain text too —
    // e.g. an env-var assignment outside any string).
    if (highlight && line.startsWith(highlight, i)) {
      result += `<span class="hlh">${escapeHtml(highlight)}</span>`;
      i += highlight.length;
      continue;
    }

    // Numbers
    if (/\d/.test(line[i]) && (i === 0 || /[\s=(:,\[]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[\d.xXa-fA-F]/.test(line[j])) j++;
      result += `<span class="hln">${escapeHtml(line.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Words (potential keywords)
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        result += `<span class="hlk">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
      i = j;
      continue;
    }

    result += escapeHtml(line[i]);
    i++;
  }

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightCode(
  code: string,
  language?: string,
  highlight?: string,
): string {
  const lang = language || "";
  return code
    .split("\n")
    .map((line) => highlightLine(line, lang, highlight))
    .join("\n");
}

export function CodeBlock({
  code,
  language,
  onCopy,
  highlight,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const lines = code.split("\n");
  const label = language ? LANGUAGE_LABELS[language] || language : null;

  const highlightedHtml = useMemo(
    () => highlightCode(code, language, highlight),
    [code, language, highlight],
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-shell rounded-lg overflow-hidden bg-[#1a1b26] ring-1 ring-white/[0.06]">
      {/* Header */}
      <div className="code-shell-header flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <span className="code-shell-dots fun-only flex gap-1.5" aria-hidden>
            <i className="block w-[9px] h-[9px] rounded-full bg-[var(--plx-hot)]" />
            <i className="block w-[9px] h-[9px] rounded-full bg-[var(--plx-lime)]" />
            <i className="block w-[9px] h-[9px] rounded-full bg-[var(--plx-sky)]" />
          </span>
          <span className="code-shell-label text-xs font-medium text-zinc-500">
            {label ?? "Code"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 h-auto p-0"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="copied"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-1.5 text-pink-400"
              >
                <Check className="h-3.5 w-3.5" />
                Copied!
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </div>

      {/* Code body */}
      <div className="flex overflow-x-auto">
        {/* Line numbers */}
        <div className="flex-none select-none py-3 pl-4 pr-0 text-right">
          {lines.map((_, i) => (
            <div key={i} className="text-xs leading-5 text-zinc-600 font-mono">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Glow separator */}
        <div className="flex-none w-px my-3 mx-3 bg-pink-400/30 shadow-[0_0_4px_theme(colors.pink.400/0.4),0_0_12px_theme(colors.pink.400/0.15)]" />

        {/* Highlighted code */}
        <div className="flex-1 py-3 pr-4 overflow-x-auto code-block-wrapper">
          <pre
            className="text-xs leading-5 font-mono text-zinc-300 whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </div>
      </div>
    </div>
  );
}
