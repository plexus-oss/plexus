"use client";

/**
 * "Start run" — the stopwatch front door for runs.
 *
 * One popover: pre-filled name + source, Enter starts. The run opens ACTIVE
 * with t0 = now and navigates to its page (/runs/[id]) where the live banner
 * ticks and End run stamps the window. A run is something you do, not a
 * record you file afterward.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRuns } from "@/hooks/use-runs";
import { fetcher } from "@/lib/fetcher";

interface SourceRow {
  id: string;
  slug: string;
  name: string | null;
  source_type: string;
}

export function StartRunButton({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { runs, createRun } = useRuns();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [sourceSlug, setSourceSlug] = useState<string>("");
  const [starting, setStarting] = useState(false);

  const { data } = useSWR<{ sources: SourceRow[] }>(
    open ? "/api/sources" : null,
    fetcher,
  );
  const devices = useMemo(
    () => (data?.sources ?? []).filter((s) => s.source_type === "device"),
    [data],
  );

  const placeholder = `Run ${runs.length + 1}`;

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const run = await createRun({
        name: name.trim() || placeholder,
        source_id: sourceSlug || null,
        status: "active",
      });
      setOpen(false);
      setName("");
      router.push(`/runs/${run.id}`);
    } catch {
      // toast handled by the hook
    } finally {
      setStarting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <Play className="h-3.5 w-3.5" />
          Start run
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-[280px] p-3">
        <div className="space-y-2.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Start a run
          </div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") start();
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
            className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/50"
          />
          <Select value={sourceSlug} onValueChange={setSourceSlug}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Source (optional)" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((s) => (
                <SelectItem key={s.id} value={s.slug} className="text-xs">
                  {s.name || s.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-[10px] text-muted-foreground">
              t0 = now · End it from the run page
            </span>
            <Button
              size="sm"
              className="h-6 text-[10px] gap-1"
              onClick={start}
              loading={starting}
            >
              <Play className="h-2.5 w-2.5" />
              Start
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
