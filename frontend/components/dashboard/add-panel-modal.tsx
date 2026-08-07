"use client";

/**
 * Add Panel modal — split-pane redesign.
 *
 *   ┌────────────────────────┬──────────────────────────────────┐
 *   │ search                 │  [panel name]                    │
 *   │ ─ Recommended          │  description                     │
 *   │ ─ Charts               │  ───────────────────────────────  │
 *   │ ─ Stats                │  per-type configurator           │
 *   │ ─ Instruments          │  (upload, metric picker, …)      │
 *   │ ─ 3D                   │                                  │
 *   │ ─ Media                │                                  │
 *   │ ─ Other                │  Title ____________               │
 *   ├────────────────────────┴──────────────────────────────────┤
 *   │                            [Cancel]   [Add Panel]         │
 *   └───────────────────────────────────────────────────────────┘
 *
 * The right pane dispatches to one of the per-type configurators
 * (components/dashboard/add-panel-configurators/index.tsx). The modal is
 * intentionally dumb about config schemas — it owns layout placement,
 * id generation, and the title field; configurators own everything
 * panel-specific.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PANEL_SIZE_PRESETS,
  DEFAULT_PANEL_CONFIG,
  type Panel,
  type PanelType,
  type DataSource,
  type TimeRange,
} from "@/lib/types/dashboard";
import { getPanelsByCategory, getPanelDefinition } from "@/lib/panels/registry";
import { useDashboards } from "@/hooks/use-dashboards";
import { useSpacePack } from "@/hooks/use-space-pack";
import { PanelConfigurator, type PanelDraft } from "./add-panel-configurators";

interface AddPanelModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (panel: Panel) => void;
  existingPanelCount: number;
  currentDashboardId?: string;
  /** Dashboard time range — drives the connection live preview. */
  timeRange?: TimeRange;
}

// Types that the modal treats as recommended at the top of the list
// when the user opens the modal fresh.
const RECOMMENDED_TYPES: PanelType[] = [
  "line",
  "stat",
  "bar",
  "datagrid",
  "alerts",
];

const DEFAULT_TYPE: PanelType = "line";

export function AddPanelModal({
  open,
  onClose,
  onAdd,
  existingPanelCount,
  currentDashboardId,
  timeRange,
}: AddPanelModalProps) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<PanelDraft>({
    type: DEFAULT_TYPE,
    config: { ...DEFAULT_PANEL_CONFIG },
  });
  const [valid, setValid] = useState(false);
  const [title, setTitle] = useState("");
  const { createDashboard } = useDashboards();

  // Reset when the modal transitions to open, using the render-phase
  // "adjust state on prop change" pattern instead of an effect (avoids the
  // cascading-render that set-state-in-an-effect causes). `valid` is owned by
  // the active configurator and broadcast via onValidChange — resetting it here
  // races with (and loses to) the child effect, leaving the Add button
  // permanently disabled, so it is deliberately left untouched.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSearch("");
      setDraft({ type: DEFAULT_TYPE, config: { ...DEFAULT_PANEL_CONFIG } });
      setTitle("");
    }
  }

  const typeDefinition = useMemo(
    () => getPanelDefinition(draft.type),
    [draft.type],
  );

  // Space types only appear for orgs that have orbital sources.
  const spacePack = useSpacePack();
  const panelCategories = useMemo(
    () => getPanelsByCategory({ space: spacePack }),
    [spacePack],
  );

  // Default view: each category shows only its core types, with everything
  // else collapsed into one trailing "More" group. Search spans all types.
  const filteredCategories = useMemo(() => {
    if (!search.trim()) {
      const core = panelCategories
        .map((cat) => ({
          ...cat,
          types: cat.types.filter((t) => t.visibility === "core"),
        }))
        .filter((cat) => cat.types.length > 0);
      const more = panelCategories.flatMap((cat) =>
        cat.types.filter((t) => t.visibility !== "core"),
      );
      if (more.length > 0) {
        core.push({ name: "More", category: "other", types: more });
      }
      return core;
    }
    const q = search.toLowerCase();
    return panelCategories
      .map((cat) => ({
        ...cat,
        types: cat.types.filter(
          (t) =>
            t.label.toLowerCase().includes(q) ||
            t.value.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.types.length > 0);
  }, [search, panelCategories]);

  const recommendedItems = useMemo(
    () =>
      RECOMMENDED_TYPES.map((t) => {
        for (const cat of panelCategories) {
          const found = cat.types.find((x) => x.value === t);
          if (found) return found;
        }
        return null;
      }).filter((x): x is NonNullable<typeof x> => x !== null),
    [panelCategories],
  );

  const selectType = (type: PanelType) => {
    const def = getPanelDefinition(type);
    setDraft({
      type,
      config: { ...DEFAULT_PANEL_CONFIG, ...(def?.defaultConfig ?? {}) },
      // Inherit the dataSource and metrics from prior selection so
      // switching panel types doesn't lose the user's data binding.
      dataSource: draft.dataSource,
      metrics: draft.metrics,
    });
    // No setValid here: the new configurator broadcasts validity on mount,
    // and forcing false breaks switches within the metric-driven family
    // (line ↔ bar etc.) where the same configurator stays mounted.
  };

  const handleAdd = async () => {
    if (!valid) return;
    const size =
      PANEL_SIZE_PRESETS[typeDefinition?.defaultSize ?? "medium"];
    const col = existingPanelCount % 2;
    const row = Math.floor(existingPanelCount / 2);
    const baseLayout = {
      // Wide panels (w > 12) can't share a row on the 24-col grid.
      x: size.w > 12 ? 0 : col * 12,
      y: row * 6,
      w: size.w,
      h: size.h,
      minW: size.minW,
      minH: size.minH,
    };

    const finalTitle =
      title.trim() ||
      draft.title ||
      (draft.metrics && draft.metrics[0]) ||
      typeDefinition?.label ||
      draft.type;

    // Dashboard panels: create the underlying dashboard first.
    if (draft.type === "dashboard") {
      const dashboardName = title.trim() || "Untitled";
      try {
        const newDashboard = await createDashboard({
          name: dashboardName,
          parent_id: currentDashboardId,
        });
        onAdd({
          id: `panel-${Date.now()}`,
          type: "dashboard",
          title: finalTitle,
          metrics: draft.metrics ?? [],
          config: {
            ...DEFAULT_PANEL_CONFIG,
            ...draft.config,
            dashboardId: newDashboard.id,
            showDescription: true,
            showPanelCount: true,
            showLastUpdated: true,
            previewMetrics:
              (draft.config.previewMetrics as string[] | undefined) ??
              undefined,
          },
          layout: { ...baseLayout, w: 6, h: 4, minW: 3, minH: 2 },
        });
      } catch {
        return;
      }
      onClose();
      return;
    }

    onAdd({
      id: `panel-${Date.now()}`,
      type: draft.type,
      title: finalTitle,
      metrics: draft.metrics ?? [],
      dataSource: draft.dataSource ?? ({ type: "realtime" } as DataSource),
      config: draft.config,
      layout: baseLayout,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-medium">Add Panel</DialogTitle>
        </DialogHeader>

        <div className="flex h-[560px]">
          {/* Left: searchable categorized type list */}
          <aside className="w-60 border-r border-border flex flex-col">
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search panels…"
                  className="h-7 pl-7 text-[11px]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-3">
              {!search && recommendedItems.length > 0 && (
                <CategoryGroup
                  name="Recommended"
                  items={recommendedItems}
                  selected={draft.type}
                  onSelect={selectType}
                />
              )}
              {filteredCategories.map((cat) => (
                <CategoryGroup
                  key={cat.name}
                  name={cat.name}
                  items={cat.types}
                  selected={draft.type}
                  onSelect={selectType}
                />
              ))}
              {filteredCategories.length === 0 && (
                <div className="p-3 text-center text-[11px] text-muted-foreground">
                  No matches for &ldquo;{search}&rdquo;
                </div>
              )}
            </div>
          </aside>

          {/* Right: per-type configurator */}
          <main className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                {typeDefinition?.icon && (
                  <typeDefinition.icon className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">
                  {typeDefinition?.label ?? draft.type}
                </span>
              </div>
              {typeDefinition?.description && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {typeDefinition.description}
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
              <PanelConfigurator
                draft={draft}
                onChange={setDraft}
                onValidChange={setValid}
                timeRange={timeRange}
              />
            </div>
            <div className="px-4 py-3 border-t border-border space-y-2">
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Title (optional)
                </Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && valid) {
                      e.preventDefault();
                      void handleAdd();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      onClose();
                    }
                  }}
                  className="h-7 text-[11px] mt-1"
                  placeholder={
                    draft.title ??
                    (draft.metrics && draft.metrics[0]) ??
                    typeDefinition?.label ??
                    "Panel title"
                  }
                />
              </div>
            </div>
          </main>
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleAdd}>
            Add Panel
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function CategoryGroup({
  name,
  items,
  selected,
  onSelect,
}: {
  name: string;
  items: Array<{
    value: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
  selected: string;
  onSelect: (value: PanelType) => void;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium px-2 pb-1">
        {name}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isSelected = selected === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onSelect(item.value)}
              className={
                "w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left " +
                (isSelected
                  ? "bg-foreground/10 text-foreground"
                  : "hover:bg-muted/60 text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] truncate flex-1">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
