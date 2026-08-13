"use client";

/**
 * Plexus Terminal — the shared conversation. Modern-UI ⟷ TUI in the middle:
 * follows the app theme (white in light, black in dark — consistent with the
 * rest of the app), monospace with a terminal `❯` prompt + blinking cursor, but
 * clean modern spacing and a bordered input. ONE violet accent.
 *
 * Used by BOTH the ⌘K side panel and the full /terminal page. Renders the
 * agent's prose, tool-call status, and REAL dynamic UI (live incidents-style
 * panels via InlinePanel).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Plus, History, Trash2, X } from "lucide-react";
import { useSources } from "@/hooks/use-sources";
import { InlinePanel } from "@/components/assistant/inline-panel";
import {
  ProposalCard,
  type Proposal,
} from "@/components/assistant/proposal-card";
import { ACCENT } from "@/components/assistant/terminal-theme";
import { TerminalMarkdown } from "@/components/assistant/terminal-markdown";
import type { Panel } from "@/lib/types/dashboard";

interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  template: string;
}

const COMMANDS: SlashCommand[] = [
  { id: "alert", label: "/alert", hint: "set a threshold alert", template: "Alert me when " },
  { id: "dashboard", label: "/dashboard", hint: "build a dashboard for a source", template: "Build a dashboard for " },
  { id: "offline", label: "/offline", hint: "alert when a stream stops", template: "Alert me when " },
  { id: "source", label: "/source", hint: "create a new device source", template: "Create a new HTTP source called " },
  { id: "connect", label: "/connect", hint: "connect a database source", template: "Connect a PostgreSQL database called " },
  { id: "email", label: "/email", hint: "email me on alerts", template: "Email me at " },
  { id: "rename", label: "/rename", hint: "rename a source or connection", template: "Rename " },
  { id: "delete", label: "/delete", hint: "delete a source or connection", template: "Delete " },
  { id: "show", label: "/show", hint: "show a live metric", template: "Show me " },
  { id: "query", label: "/query", hint: "quick spot check on a metric", template: "What's " },
  { id: "fleet", label: "/fleet", hint: "fleet status & alerts", template: "How's my fleet?" },
  { id: "alerts", label: "/alerts", hint: "list open alerts", template: "What alerts are open?" },
];

type SlashItem =
  | { type: "cmd"; id: string; label: string; hint: string; template: string }
  | { type: "source"; slug: string; name: string };

export { ACCENT };

interface Msg {
  role: "user" | "assistant";
  text: string;
  tools: string[];
  panels: Panel[];
  proposals: Proposal[];
}

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

const TOOL_LABELS: Record<string, string> = {
  list_sources: "scanning sources",
  get_source_metrics: "reading metrics",
  query_metric: "querying data",
  get_source_context: "reading context",
  get_fleet_status: "checking fleet",
  list_alerts: "reading alerts",
  show_metric: "rendering chart",
  propose_monitor: "drafting alert",
  propose_offline_alert: "drafting offline alert",
  propose_dashboard: "building dashboard",
  propose_email_integration: "setting up email",
  propose_create_source: "drafting source",
  propose_update_source: "drafting update",
  propose_delete_source: "drafting deletion",
  propose_create_connection: "drafting connection",
  propose_update_connection: "drafting update",
  propose_annotation: "drafting annotation",
  propose_remember: "drafting memory",
};

const PROMPTS = [
  "alert me if battery drops below 11V on drone-001",
  "build a dashboard for drone-001",
  "create a new HTTP source called weather-station",
  "email me when alerts fire",
];

export function TerminalConversation({
  variant = "panel",
  initialMessage,
}: {
  variant?: "panel" | "page";
  /** When set, the session opens by sending this message immediately — the
   *  programmatic open path (e.g. a chart's "Explain" button). */
  initialMessage?: string;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Persistence: each completed turn is saved to the user's history. `convId`
  // is the current thread (null until first save). The History list lets you
  // resume a past thread or start fresh.
  const convId = useRef<string | null>(null);
  const wasBusy = useRef(false);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant/conversations");
      if (res.ok) setHistory((await res.json()).conversations ?? []);
    } catch {
      /* history is best-effort */
    }
  }, []);

  const newChat = useCallback(() => {
    convId.current = null;
    setMessages([]);
    setInput("");
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/assistant/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      convId.current = id;
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setShowHistory(false);
    } catch {
      /* ignore */
    }
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      setHistory((h) => h.filter((c) => c.id !== id));
      if (convId.current === id) newChat();
      try {
        await fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
      } catch {
        /* ignore */
      }
    },
    [newChat],
  );

  // Save the thread once a turn finishes (busy true→false). Reads the settled
  // messages for this render, so panels/proposals are captured as rendered.
  useEffect(() => {
    if (wasBusy.current && !busy && messages.length > 0) {
      const title =
        messages.find((m) => m.role === "user")?.text?.slice(0, 200) ||
        "Conversation";
      void (async () => {
        try {
          const res = await fetch("/api/assistant/conversations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: convId.current, title, messages }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.id) convId.current = data.id;
          }
        } catch {
          /* save is best-effort */
        }
      })();
    }
    wasBusy.current = busy;
  }, [busy, messages]);

  // Slash menu: "/" opens a picker of actions + the org's sources.
  const { sources } = useSources();
  const [menuIndex, setMenuIndex] = useState(0);
  const slashQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : null;
  // Reset the highlighted item whenever the query changes (React's "adjust state
  // when a value changes" pattern — resets in the same render, no extra commit).
  const [prevSlashQuery, setPrevSlashQuery] = useState(slashQuery);
  if (slashQuery !== prevSlashQuery) {
    setPrevSlashQuery(slashQuery);
    setMenuIndex(0);
  }
  const slashItems = useMemo<SlashItem[]>(() => {
    if (slashQuery === null) return [];
    const cmds: SlashItem[] = COMMANDS.filter(
      (c) => c.id.includes(slashQuery) || c.hint.includes(slashQuery),
    ).map((c) => ({ type: "cmd", ...c }));
    const srcs: SlashItem[] = (
      (sources ?? []) as Array<{ slug: string; name?: string | null }>
    )
      .filter(
        (s) =>
          s.slug.toLowerCase().includes(slashQuery) ||
          (s.name ?? "").toLowerCase().includes(slashQuery),
      )
      .slice(0, 6)
      .map((s) => ({ type: "source", slug: s.slug, name: s.name ?? s.slug }));
    return [...cmds, ...srcs];
  }, [slashQuery, sources]);
  const menuOpen = slashQuery !== null && slashItems.length > 0;

  const selectSlash = (item: SlashItem) => {
    setInput(item.type === "cmd" ? item.template : `${item.slug} `);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((prev) =>
      prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)),
    );

  const send = useCallback(async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const history: Msg[] = [
      ...messages,
      { role: "user", text: q, tools: [], panels: [], proposals: [] },
    ];
    setMessages([
      ...history,
      {
        role: "assistant",
        text: "",
        tools: [],
        panels: [],
        proposals: [],
      },
    ]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      if (!res.ok || !res.body) {
        patchLast((m) => ({
          ...m,
          text:
            res.status === 503
              ? "terminal not configured."
              : "couldn't reach the terminal.",
        }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: {
            type: string;
            delta?: string;
            name?: string;
            status?: string;
            message?: string;
            panel?: Panel;
            proposal?: Proposal;
            question?: string;
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "text" && ev.delta) {
            patchLast((m) => ({ ...m, text: m.text + ev.delta }));
          } else if (ev.type === "tool" && ev.status === "running" && ev.name) {
            patchLast((m) => ({
              ...m,
              tools: [...m.tools, ev.name as string],
            }));
          } else if (ev.type === "panel" && ev.panel) {
            patchLast((m) => ({
              ...m,
              panels: [...m.panels, ev.panel as Panel],
            }));
          } else if (ev.type === "proposal" && ev.proposal) {
            patchLast((m) => ({
              ...m,
              proposals: [...m.proposals, ev.proposal as Proposal],
            }));
          } else if (ev.type === "error" && ev.message) {
            patchLast((m) => ({
              ...m,
              text: m.text ? `${m.text}\n${ev.message}` : ev.message!,
            }));
          }
        }
      }
    } catch {
      patchLast((m) => ({
        ...m,
        text: m.text || "the terminal hit an error.",
      }));
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages]);

  // Seeded open: send the initial message once, as if the user typed it. The
  // host remounts this component per open (keyed on the seed), so the guard
  // only has to survive re-renders within one session.
  const seededRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !seededRef.current) {
      seededRef.current = true;
      void send(initialMessage);
    }
  }, [initialMessage, send]);

  const row = variant === "page" ? "mx-auto w-full  px-6" : "px-4";

  const toggleHistory = () => {
    setShowHistory((v) => {
      if (!v) void loadHistory();
      return !v;
    });
  };

  return (
    <div className="flex h-full flex-col bg-background font-mono text-[13px] leading-[1.7] text-foreground">
      {/* thread controls — resume past threads or start fresh */}
      <div className={`${row} flex items-center justify-end gap-1 pt-3`}>
        <button
          onClick={newChat}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
        <button
          onClick={toggleHistory}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:text-foreground ${
            showHistory ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <History className="h-3.5 w-3.5" /> History
        </button>
      </div>

      {showHistory ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`${row} space-y-1 py-4`}>
            <div className="flex items-center justify-between pb-1">
              <span className="text-[12px] text-muted-foreground">
                Your conversations
              </span>
              <button
                onClick={() => setShowHistory(false)}
                aria-label="Close history"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {history.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-muted-foreground/70">
                No saved conversations yet.
              </p>
            ) : (
              history.map((c) => (
                <div
                  key={c.id}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/[0.06]"
                >
                  <button
                    onClick={() => openConversation(c.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[13px] text-foreground">
                      {c.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(c.updated_at), {
                        addSuffix: true,
                      })}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteConversation(c.id)}
                    aria-label="Delete conversation"
                    className="opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${row} space-y-5 py-6`}>
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                Operate your fleet in plain language.
              </p>
              <div className="space-y-1">
                {PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setInput(p)}
                    className="block w-full rounded-md py-1 text-left text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    <span style={{ color: ACCENT }}>❯</span> {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex gap-2.5">
                <span style={{ color: ACCENT }}>❯</span>
                <span className="font-medium text-foreground">{m.text}</span>
              </div>
            ) : (
              <div key={i} className="space-y-2.5 pl-[18px]">
                {m.tools.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                    {m.tools.map((t, j) => (
                      <span key={j}>
                        <span style={{ color: ACCENT }}>›</span>{" "}
                        {TOOL_LABELS[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                {m.text && (
                  <div className="text-foreground/90">
                    <TerminalMarkdown text={m.text} />
                    {busy && i === messages.length - 1 && (
                      <span
                        className="ml-1 inline-block h-[1.05em] w-[0.5em] translate-y-[0.18em] animate-pulse align-middle"
                        style={{ background: ACCENT }}
                      />
                    )}
                  </div>
                )}
                {m.panels.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {m.panels.map((p) => (
                      <InlinePanel key={p.id} panel={p} />
                    ))}
                  </div>
                )}
                {m.proposals.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {m.proposals.map((p, k) => (
                      <ProposalCard key={k} proposal={p} />
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </div>
      )}

      {/* input — a clean bordered prompt (modern) with the ❯ cue (TUI) */}
      {!showHistory && (
      <div className={`${row} pb-5 pt-3`}>
        <div className="relative">
          {/* slash-command menu */}
          {menuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                Type to filter · ↑↓ to move · ↵ to pick
              </div>
              {slashItems.map((item, i) => (
                <button
                  key={item.type === "cmd" ? item.id : `s-${item.slug}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSlash(item);
                  }}
                  onMouseEnter={() => setMenuIndex(i)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    i === menuIndex ? "bg-foreground/[0.06]" : ""
                  }`}
                >
                  {item.type === "cmd" ? (
                    <>
                      <span className="font-medium" style={{ color: ACCENT }}>
                        {item.label}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {item.hint}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-foreground">{item.slug}</span>
                      {item.name !== item.slug && (
                        <span className="truncate text-[12px] text-muted-foreground">
                          {item.name}
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground">source</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 focus-within:border-foreground/25">
            <span className="pt-[1px]" style={{ color: ACCENT }}>
              ❯
            </span>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (menuOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMenuIndex((idx) => (idx + 1) % slashItems.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMenuIndex((idx) => (idx - 1 + slashItems.length) % slashItems.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    selectSlash(slashItems[menuIndex]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setInput("");
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="what should I set up?  ( / for commands )"
              rows={1}
              disabled={busy}
              className="flex-1 resize-none bg-transparent font-mono text-[13px] leading-[1.7] text-foreground outline-none placeholder:text-muted-foreground/50"
              style={{ caretColor: ACCENT }}
            />
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
