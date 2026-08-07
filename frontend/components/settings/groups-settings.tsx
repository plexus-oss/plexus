"use client";

/**
 * Access — one flat matrix. Columns are roles (Viewer · Editor · custom roles
 * · Admin); rows are actions (grouped by feature) followed by every dashboard.
 *
 *  - Built-in roles are READ-ONLY: their permission cells are fixed manifest
 *    defaults. All customization lives in custom roles (base + exceptions).
 *  - Custom-role permission cells toggle; dashboard cells cycle — / view /
 *    edit for every non-admin column (role-targeted grants).
 *  - Edits buffer locally and persist through the app-standard SaveBar
 *    (Cmd+S, floating bar) — the useSaveBar pattern.
 */

import { useMemo, useState } from "react";
import { Lock, MoreHorizontal, Plus, Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { SaveBar } from "@/components/ui/save-bar";
import { useSaveBar } from "@/hooks/use-save-bar";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/hooks/use-permissions";
import { useDashboardsSwr } from "@/hooks/use-dashboards-swr";
import { useRoleGrants, type GroupGrant } from "@/hooks/use-role-grants";
import {
  can,
  type AccessCatalog,
  type CustomRoleDef,
} from "@/lib/access/resolver";
import { toast } from "@/lib/toast-utils";
import type { OrgRole } from "@/lib/api/rbac";
import type { ActionId } from "@/lib/manifest/types";
import { cn } from "@/lib/utils";

const RANK: Record<OrgRole, number> = {
  "org:viewer": 0,
  "org:editor": 1,
  "org:admin": 2,
};

type DashLevel = "none" | "view" | "edit";
const DASH_CYCLE: DashLevel[] = ["none", "view", "edit"];

interface Column {
  /** Group id for grants: "viewer" | "editor" | "admin" | custom role id. */
  id: string;
  label: string;
  kind: "builtin" | "custom" | "admin";
  base: OrgRole;
  custom?: CustomRoleDef;
}

async function fetchOrThrow(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Failed to save");
  }
}

// ===========================================================================
// Page
// ===========================================================================

export function GroupsSettings() {
  const {
    catalog,
    customRoles,
    isLoading: permsLoading,
    mutate: mutateRoles,
  } = usePermissions();
  const { dashboards } = useDashboardsSwr();

  const columns = useMemo<Column[]>(() => {
    const customs = Object.values(customRoles).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return [
      { id: "viewer", label: "Viewer", kind: "builtin", base: "org:viewer" },
      { id: "editor", label: "Editor", kind: "builtin", base: "org:editor" },
      ...customs.map(
        (c): Column => ({
          id: c.id,
          label: c.name,
          kind: "custom",
          base: c.base,
          custom: c,
        }),
      ),
      { id: "admin", label: "Admin", kind: "admin", base: "org:admin" },
    ];
  }, [customRoles]);

  // Grant groups = every non-admin column (admin bypasses grants).
  const grantGroupIds = useMemo(
    () => columns.filter((c) => c.kind !== "admin").map((c) => c.id),
    [columns],
  );
  const { grantsByGroup, mutate: mutateGrants } = useRoleGrants(grantGroupIds);

  // ---- staged edits --------------------------------------------------------
  // Custom-role permission exceptions: roleId → actionId → desired allowed.
  const [stagedPerms, setStagedPerms] = useState<
    Record<string, Record<string, boolean>>
  >({});
  // Dashboard grant levels: groupId → dashboardId → desired level.
  const [stagedDash, setStagedDash] = useState<
    Record<string, Record<string, DashLevel>>
  >({});

  const discard = () => {
    setStagedPerms({});
    setStagedDash({});
  };

  const save = async () => {
    // 1. Custom-role permission exceptions (one PATCH per touched role).
    for (const [roleId, actions] of Object.entries(stagedPerms)) {
      const def = customRoles[roleId];
      if (!def) continue;
      const overrides: Record<string, boolean | null> = {};
      for (const [actionId, allowed] of Object.entries(actions)) {
        const baseDefault = can(def.base, actionId as ActionId);
        // Matching the base default = no exception needed → clear it.
        overrides[actionId] = allowed === baseDefault ? null : allowed;
      }
      await fetchOrThrow(`/api/access/custom-roles/${roleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
    }

    // 2. Dashboard grant diffs per group.
    for (const [groupId, byDash] of Object.entries(stagedDash)) {
      const server = grantsByGroup[groupId] ?? [];
      const serverByDash = new Map(
        server
          .filter((g) => g.kind === "dashboard")
          .map((g) => [g.resourceId, g]),
      );
      const base = `/api/access/groups/${groupId}/grants`;
      for (const [dashboardId, level] of Object.entries(byDash)) {
        const existing = serverByDash.get(dashboardId);
        if (level === "none") {
          if (existing) {
            await fetchOrThrow(`${base}/${existing.id}?kind=dashboard`, {
              method: "DELETE",
            });
          }
        } else if (!existing) {
          await fetchOrThrow(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "dashboard",
              resourceId: dashboardId,
              accessLevel: level,
            }),
          });
        } else if (existing.accessLevel !== level) {
          await fetchOrThrow(`${base}/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "dashboard", accessLevel: level }),
          });
        }
      }
    }

    await Promise.all([mutateRoles(), mutateGrants()]);
    setStagedPerms({});
    setStagedDash({});
  };

  const { saveBarProps, markDirty, reset, leaveConfirm } = useSaveBar({
    onSave: save,
    onDiscard: discard,
    currentPath: "/settings",
    successMessage: "Access saved",
    errorMessage: "Failed to save access",
  });

  // ---- cell state helpers --------------------------------------------------

  function permAllowed(col: Column, action: AccessCatalog[number]["actions"][number]): boolean {
    if (col.kind === "admin") return true;
    if (col.kind === "builtin") {
      return can(col.base, action.id);
    }
    const staged = stagedPerms[col.id]?.[action.id];
    if (staged !== undefined) return staged;
    return col.custom!.overrides[action.id] ?? can(col.base, action.id);
  }

  function togglePerm(col: Column, action: AccessCatalog[number]["actions"][number]) {
    if (col.kind !== "custom") return;
    const next = !permAllowed(col, action);
    setStagedPerms((prev) => ({
      ...prev,
      [col.id]: { ...prev[col.id], [action.id]: next },
    }));
    markDirty();
  }

  function dashLevel(col: Column, dashboardId: string): DashLevel {
    if (col.kind === "admin") return "edit";
    const staged = stagedDash[col.id]?.[dashboardId];
    if (staged !== undefined) return staged;
    const grant = (grantsByGroup[col.id] ?? []).find(
      (g) => g.kind === "dashboard" && g.resourceId === dashboardId,
    );
    return grant ? (grant.accessLevel as DashLevel) : "none";
  }

  function cycleDash(col: Column, dashboardId: string) {
    if (col.kind === "admin") return;
    const current = dashLevel(col, dashboardId);
    const next =
      DASH_CYCLE[(DASH_CYCLE.indexOf(current) + 1) % DASH_CYCLE.length];
    setStagedDash((prev) => ({
      ...prev,
      [col.id]: { ...prev[col.id], [dashboardId]: next },
    }));
    markDirty();
  }

  const gridStyle = {
    gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, 84px)`,
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Access</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            What each role can do, and which dashboards it can open. Built-in
            roles are fixed; create a custom role to change permissions. What
            members can <em>see</em> (devices, satellites) is set per member
            in the Members tab.
          </p>
        </div>
        <NewRoleButton onCreated={() => mutateRoles()} />
      </div>

      {permsLoading || !catalog ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div className="min-w-fit">
            {/* Column headers */}
            <div className="grid items-center border-b border-border px-4 py-2" style={gridStyle}>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                Permission
              </span>
              {columns.map((c) => (
                <ColumnHeader
                  key={c.id}
                  column={c}
                  onChanged={() => {
                    reset();
                    void mutateRoles();
                    void mutateGrants();
                  }}
                />
              ))}
            </div>

            {catalog.map((feature) => (
              <div key={feature.domain}>
                <div className="border-b border-border/60 bg-muted/30 px-4 py-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {feature.label}
                  </span>
                </div>
                {feature.actions.map((action) => (
                  <div
                    key={action.id}
                    className="grid items-center border-b border-border/60 px-4 py-1.5 last:border-b-0 hover:bg-muted/20"
                    style={gridStyle}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm">{action.label}</span>
                      {action.isDestructive && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-[10px] text-destructive"
                        >
                          Destructive
                        </Badge>
                      )}
                    </div>
                    {columns.map((col) => (
                      <PermCell
                        key={col.id}
                        column={col}
                        locked={action.locked}
                        allowed={permAllowed(col, action)}
                        modified={
                          col.kind === "custom" &&
                          stagedPerms[col.id]?.[action.id] !== undefined
                        }
                        onToggle={() => togglePerm(col, action)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}

            {/* Dashboards */}
            <div className="border-b border-border/60 bg-muted/30 px-4 py-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Dashboards
              </span>
              <span className="ml-2 text-[11px] text-muted-foreground/60">
                — · view · edit per role; dashboards with no rules are visible
                to the whole org
              </span>
            </div>
            {dashboards.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                No dashboards yet.
              </p>
            ) : (
              dashboards.map((d) => (
                <div
                  key={d.id}
                  className="grid items-center border-b border-border/60 px-4 py-1.5 last:border-b-0 hover:bg-muted/20"
                  style={gridStyle}
                >
                  <span className="truncate text-sm">{d.name}</span>
                  {columns.map((col) => (
                    <DashCell
                      key={col.id}
                      column={col}
                      level={dashLevel(col, d.id)}
                      modified={stagedDash[col.id]?.[d.id] !== undefined}
                      onCycle={() => cycleDash(col, d.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      <SaveBar {...saveBarProps} />
      <ConfirmActionDialog
        open={leaveConfirm.isOpen}
        onOpenChange={(open) => {
          if (!open) leaveConfirm.onStay();
        }}
        title="Discard unsaved changes?"
        description="You have unsaved access changes. Leaving will discard them."
        confirmLabel="Discard and leave"
        onConfirm={async () => leaveConfirm.onLeave()}
      />
    </div>
  );
}

// ===========================================================================
// Cells
// ===========================================================================

function Dot({ allowed }: { allowed: boolean }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        allowed ? "bg-foreground/70" : "border border-border",
      )}
    />
  );
}

function PermCell({
  column,
  locked,
  allowed,
  modified,
  onToggle,
}: {
  column: Column;
  locked: boolean;
  allowed: boolean;
  modified: boolean;
  onToggle: () => void;
}) {
  if (column.kind === "admin") {
    return (
      <span className="flex justify-center">
        {locked ? (
          <Lock className="h-3 w-3 text-muted-foreground/60" />
        ) : (
          <Dot allowed />
        )}
      </span>
    );
  }
  if (column.kind === "builtin" || locked) {
    return (
      <span
        className="flex h-7 items-center justify-center"
        title={
          locked
            ? "Admins only"
            : "Built-in roles are fixed — create a custom role to change permissions"
        }
      >
        <Dot allowed={locked ? false : allowed} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "relative flex h-7 items-center justify-center rounded transition-colors hover:bg-muted/60",
      )}
      title={allowed ? `${column.label} can do this` : `Allow ${column.label}`}
    >
      <Dot allowed={allowed} />
      {modified && (
        <span className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-primary" />
      )}
    </button>
  );
}

function DashCell({
  column,
  level,
  modified,
  onCycle,
}: {
  column: Column;
  level: DashLevel;
  modified: boolean;
  onCycle: () => void;
}) {
  if (column.kind === "admin") {
    return (
      <span
        className="flex justify-center text-[11px] text-muted-foreground/60"
        title="Admins can open and edit every dashboard"
      >
        <Lock className="h-3 w-3" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onCycle}
      className="relative flex h-7 items-center justify-center rounded text-[11px] transition-colors hover:bg-muted/60"
      title={`${column.label}: ${level === "none" ? "no rule" : level} — click to change`}
    >
      {level === "none" ? (
        <span className="text-muted-foreground/50">—</span>
      ) : (
        <span
          className={cn(
            "font-medium",
            level === "edit" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {level}
        </span>
      )}
      {modified && (
        <span className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-primary" />
      )}
    </button>
  );
}

// ===========================================================================
// Column header (custom-role management)
// ===========================================================================

function ColumnHeader({
  column,
  onChanged,
}: {
  column: Column;
  onChanged: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (column.kind !== "custom") {
    return (
      <span className="flex items-center justify-center gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {column.kind === "admin" && <Shield className="h-3 w-3" />}
        {column.label}
      </span>
    );
  }

  return (
    <span className="group flex items-center justify-center gap-0.5">
      <span
        className="truncate text-center text-[11px] font-medium uppercase tracking-wide text-foreground/90"
        title={`${column.label} — custom role, base ${column.base === "org:editor" ? "Editor" : "Viewer"}`}
      >
        {column.label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            aria-label={`Manage role ${column.label}`}
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Delete role
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen && (
        <RenameRolePopover
          role={column.custom!}
          onClose={() => setRenameOpen(false)}
          onChanged={onChanged}
        />
      )}
      {deleteOpen && (
        <DeleteRoleDialog
          role={column.custom!}
          onClose={() => setDeleteOpen(false)}
          onChanged={onChanged}
        />
      )}
    </span>
  );
}

function RenameRolePopover({
  role,
  onClose,
  onChanged,
}: {
  role: CustomRoleDef;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || name.trim() === role.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await fetchOrThrow(`/api/access/custom-roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverTrigger asChild>
        <span />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-60 space-y-2 p-3">
        <Label className="text-xs text-muted-foreground">Role name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={saving}>
            Rename
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DeleteRoleDialog({
  role,
  onClose,
  onChanged,
}: {
  role: CustomRoleDef;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { customRoles } = usePermissions();
  const [reassignTo, setReassignTo] = useState("org:viewer");

  const targets = [
    { value: "org:viewer", label: "Viewer" },
    { value: "org:editor", label: "Editor" },
    ...Object.values(customRoles)
      .filter((r) => r.id !== role.id)
      .map((r) => ({ value: r.id, label: r.name })),
  ];

  return (
    <ConfirmActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete role "${role.name}"?`}
      description="Members holding this role will be moved to the role selected below. This cannot be undone."
      confirmLabel="Delete role"
      onConfirm={async () => {
        await fetchOrThrow(
          `/api/access/custom-roles/${role.id}?reassignTo=${encodeURIComponent(reassignTo)}`,
          { method: "DELETE" },
        );
        onChanged();
        onClose();
      }}
    >
      <div className="space-y-1.5 pt-1">
        <Label className="text-xs text-muted-foreground">
          Move members to
        </Label>
        <Select value={reassignTo} onValueChange={setReassignTo}>
          <SelectTrigger className="h-8 w-full text-sm" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targets.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ConfirmActionDialog>
  );
}

// ===========================================================================
// New role
// ===========================================================================

function NewRoleButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [base, setBase] = useState<"org:viewer" | "org:editor">("org:viewer");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetchOrThrow("/api/access/custom-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), base }),
      });
      setName("");
      setBase("org:viewer");
      setOpen(false);
      onCreated();
      toast.success("Role created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 shrink-0">
          <Plus className="mr-1.5 h-3 w-3" />
          New role
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Customer"
            autoFocus
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Starts from</Label>
          <Select
            value={base}
            onValueChange={(v) => setBase(v as "org:viewer" | "org:editor")}
          >
            <SelectTrigger className="h-8 w-full text-sm" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="org:viewer">
                Viewer — read-only baseline
              </SelectItem>
              <SelectItem value="org:editor">
                Editor — can create and edit
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            The role starts as a copy of this column; toggle its cells to
            differ.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={saving} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
