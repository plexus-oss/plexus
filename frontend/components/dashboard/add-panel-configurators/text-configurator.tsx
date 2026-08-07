"use client";

import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import type { ConfiguratorProps } from "./types";

export function TextConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  const content = (draft.config.content as string | undefined) ?? "";

  return (
    <div className="space-y-2">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Content
      </Label>
      <textarea
        value={content}
        onChange={(e) =>
          onChange({
            ...draft,
            config: { ...draft.config, content: e.target.value },
          })
        }
        rows={10}
        placeholder="Markdown supported — # heading, **bold**, `code`…"
        className="w-full text-[12px] font-mono leading-snug rounded-md border border-input bg-background/40 p-3 outline-none focus:ring-2 focus:ring-foreground/10 resize-none"
      />
      <p className="text-[10px] text-muted-foreground">
        Notes, headings, run-books, links. Renders as Markdown.
      </p>
    </div>
  );
}
