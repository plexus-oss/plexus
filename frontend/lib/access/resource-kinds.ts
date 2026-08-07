/**
 * Resource-kind registry — THE single source of truth for every grantable
 * resource type (devices, fleets, dashboards).
 *
 * Adding a new grantable kind is one entry here (plus a column on a
 * permissions table if it doesn't reuse an existing one): the grant queries
 * (`lib/db/queries/access.ts`), validation, and the Groups UI all derive from
 * this registry, so nothing else needs to change.
 *
 * Client + server safe: metadata only, no DB imports.
 */

import { Cpu, Boxes, LayoutDashboard, type LucideIcon } from "lucide-react";

/** The grantable kinds — single definition; the type and Zod enum derive from it. */
export const GRANT_KIND_VALUES = ["device", "fleet", "dashboard"] as const;
export type GrantKind = (typeof GRANT_KIND_VALUES)[number];

export interface ResourceKindMeta {
  kind: GrantKind;
  label: string;
  plural: string;
  icon: LucideIcon;
  /** Table holding the resource rows (existence checks + name lookup). */
  table: "sources" | "source_groups" | "dashboards";
  /** Permissions table carrying grants for this kind. */
  permissionsTable: "source_permissions" | "dashboard_permissions";
  /** Column on the permissions table that points at this resource. */
  grantColumn: "source_id" | "source_group_id" | "dashboard_id";
  /** Select used to resolve display names (name falls back to slug if present). */
  nameSelect: string;
}

export const RESOURCE_KINDS: Record<GrantKind, ResourceKindMeta> = {
  device: {
    kind: "device",
    label: "Device",
    plural: "Devices",
    icon: Cpu,
    table: "sources",
    permissionsTable: "source_permissions",
    grantColumn: "source_id",
    nameSelect: "id, name, slug",
  },
  fleet: {
    kind: "fleet",
    label: "Fleet",
    plural: "Fleets",
    icon: Boxes,
    table: "source_groups",
    permissionsTable: "source_permissions",
    grantColumn: "source_group_id",
    nameSelect: "id, name",
  },
  dashboard: {
    kind: "dashboard",
    label: "Dashboard",
    plural: "Dashboards",
    icon: LayoutDashboard,
    table: "dashboards",
    permissionsTable: "dashboard_permissions",
    grantColumn: "dashboard_id",
    nameSelect: "id, name",
  },
};

/** Display/order convention everywhere kinds are listed. */
export const KIND_ORDER: GrantKind[] = ["fleet", "device", "dashboard"];

export const ALL_GRANT_KINDS = Object.keys(RESOURCE_KINDS) as GrantKind[];
