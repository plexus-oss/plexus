"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
  createContext,
  useContext,
  startTransition,
  Fragment,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { useMyOrgs } from "@/hooks/use-my-orgs";
import {
  X,
  Plus,
  Check,
  MoreVertical,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import Link from "next/link";
import { LucideIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { EntityActions } from "@/components/ui/entity-actions";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ShareDashboardModal } from "@/components/dashboard/share-modal";
import { useDashboards } from "@/hooks/use-dashboards";
import { useRole } from "@/hooks/use-role";
import {
  FEATURES,
  SECTIONS,
  type FeatureKey,
  type Feature,
} from "@/lib/features";
import { useFeatures } from "@/hooks/use-features";
import { useTier } from "@/hooks/use-tier";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import { Spinner } from "@/components/ui/spinner";
import { DashboardIcon } from "@/components/dashboard/icon-picker";
import type { DashboardListItem } from "@/lib/types/dashboard";

interface DashboardTreeContextValue {
  activeLink: string;
  setActiveLink: (link: string) => void;
  sidebarOpen: boolean;
  isSignedIn: boolean;
  editingDashboardId: string | null;
  editingDashboardName: string;
  setEditingDashboardId: (id: string | null) => void;
  setEditingDashboardName: (name: string) => void;
  handleRenameDashboard: () => void;
  isUpdating: boolean;
  contextMenuDashboardId: string | null;
  setContextMenuDashboardId: (id: string | null) => void;
  onDeleteDashboard: (id: string) => Promise<void>;
  expandedIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDuplicate: (id: string) => void;
  onShare: (dashboard: { id: string; name: string }) => void;
  formatDate: (date: Date | string | number) => string;
  canEdit: boolean;
}

const DashboardTreeContext = createContext<DashboardTreeContextValue | null>(
  null,
);

const SIDEBAR_OPEN_STORAGE_KEY = "nav-sidebar-open";

// Sidebar open/closed is persisted in localStorage. It's exposed as an external
// store so the value can be read hydration-safely (server snapshot = open),
// without a setState-in-effect on mount.
const sidebarListeners = new Set<() => void>();
const readSidebarOpen = (): boolean => {
  const stored = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
  if (stored !== null) return stored === "true";
  return window.innerWidth >= 768;
};
const subscribeSidebarOpen = (cb: () => void) => {
  sidebarListeners.add(cb);
  return () => {
    sidebarListeners.delete(cb);
  };
};
const getSidebarServerSnapshot = () => true;
const setSidebarOpenStored = (next: boolean) => {
  try {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(next));
  } catch {}
  sidebarListeners.forEach((l) => l());
};

const useDashboardTree = () => {
  const context = useContext(DashboardTreeContext);
  if (!context)
    throw new Error(
      "useDashboardTree must be used within DashboardTreeContext",
    );
  return context;
};

const HeaderText = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="text-[10px] uppercase font-geist-mono tracking-wider text-gray-400 dark:text-gray-500 mt-3 mb-1 pl-2 font-medium">
      {children}
    </div>
  );
};

export const Navbar = () => {
  const sidebarOpen = useSyncExternalStore(
    subscribeSidebarOpen,
    readSidebarOpen,
    getSidebarServerSnapshot,
  );
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--nav-width",
      sidebarOpen ? "13rem" : "3.5rem",
    );
  }, [sidebarOpen]);
  const [activeLink, setActiveLink] = useState("/");
  const [syncedPathname, setSyncedPathname] = useState<string | null>(null);
  const { isSignedIn } = usePlexusSession();
  const { activeOrgId, orgs } = useMyOrgs();
  const activeOrg = orgs.find((o) => o.orgId === activeOrgId);
  const { canEdit } = useRole();
  const { flags } = useFeatures();
  const { tier, isPaid } = useTier();

  // Derive sections from the feature registry. Each section picks up the
  // features tagged with its `id` that the user can see. Empty sections
  // drop out so we don't render lonely headers.
  const visibleSections = useMemo(() => {
    type Link = {
      key: FeatureKey;
      label: string;
      href: string;
      icon: Feature["icon"];
    };
    return SECTIONS.map((section) => ({
      header: section.header,
      links: (Object.entries(FEATURES) as [FeatureKey, Feature][])
        .filter(
          ([key, f]) =>
            f.section === section.id &&
            f.href &&
            f.label &&
            f.icon &&
            flags[key],
        )
        .map<Link>(([key, f]) => ({
          key,
          label: f.label!,
          href: f.href!,
          icon: f.icon,
        })),
    })).filter((s) => s.links.length > 0);
  }, [flags]);

  const planLabel =
    tier === "tier_2"
      ? "Enterprise plan"
      : isPaid
        ? "Usage-based plan"
        : "Team plan";

  const pathname = usePathname();
  // Keep the highlighted link in sync with the route. Clicks set activeLink
  // optimistically (instant highlight); when the route actually changes we
  // adjust state during render — React's recommended alternative to a
  // pathname-syncing effect, applied before paint with no extra render pass.
  if (pathname !== syncedPathname) {
    setSyncedPathname(pathname);
    setActiveLink(pathname);
  }
  const getNavHref = useCallback(
    (path: string): string | undefined => {
      if (!isSignedIn) return undefined;
      return path;
    },
    [isSignedIn],
  );
  const {
    dashboards,
    createDashboard,
    updateDashboard,
    deleteDashboard,
    duplicateDashboard,
  } = useDashboards();
  const { formatDate } = useFormattedTime();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();

  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(
    null,
  );
  const [editingDashboardName, setEditingDashboardName] = useState("");
  const [sharingDashboard, setSharingDashboard] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [contextMenuDashboardId, setContextMenuDashboardId] = useState<
    string | null
  >(null);
  const [expandedDashboardIds, setExpandedDashboardIds] = useState<Set<string>>(
    new Set(),
  );
  interface TreeNode extends DashboardListItem {
    children: TreeNode[];
  }

  const dashboardTree = useMemo(() => {
    const nodeMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const d of dashboards) {
      nodeMap.set(d.id, { ...d, children: [] });
    }

    for (const d of dashboards) {
      const node = nodeMap.get(d.id)!;
      if (d.parent_id && nodeMap.has(d.parent_id)) {
        nodeMap.get(d.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      for (const node of nodes) {
        sortNodes(node.children);
      }
    };
    sortNodes(roots);

    return roots;
  }, [dashboards]);

  const toggleDashboardExpanded = useCallback((id: string) => {
    setExpandedDashboardIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCreateChildDashboard = useCallback(
    async (parentId: string) => {
      try {
        const dashboard = await createDashboard({
          name: "Untitled",
          parent_id: parentId,
        });
        setExpandedDashboardIds((prev) => new Set([...prev, parentId]));
        router.push(`/dashboards/${dashboard.id}`);
      } catch (error) {
        console.error("Failed to create child dashboard:", error);
      }
    },
    [createDashboard, router],
  );

  const handleDuplicateDashboard = useCallback(
    async (id: string) => {
      try {
        const dashboard = await duplicateDashboard(id);
        router.push(`/dashboards/${dashboard.id}`);
      } catch (error) {
        console.error("Failed to duplicate dashboard:", error);
      }
    },
    [duplicateDashboard, router],
  );

  const handleCreateDashboard = async () => {
    if (!newDashboardName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const dashboard = await createDashboard({
        name: newDashboardName.trim(),
      });
      router.push(`/dashboards/${dashboard.id}`);
      setNewDashboardName("");
      setShowCreateForm(false);
    } catch (error) {
      console.error("Failed to create dashboard:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRenameDashboard = useCallback(async () => {
    if (!editingDashboardId || !editingDashboardName.trim() || isUpdating)
      return;
    setIsUpdating(true);
    try {
      await updateDashboard(editingDashboardId, {
        name: editingDashboardName.trim(),
      });
      setEditingDashboardId(null);
      setEditingDashboardName("");
    } catch (error) {
      console.error("Failed to rename dashboard:", error);
    } finally {
      setIsUpdating(false);
    }
  }, [editingDashboardId, editingDashboardName, isUpdating, updateDashboard]);

  const toggleSidebar = () => setSidebarOpenStored(!sidebarOpen);

  const handleDeleteDashboard = useCallback(
    async (id: string) => {
      try {
        await deleteDashboard(id);
        if (pathname === `/dashboards/${id}`) {
          router.push("/");
        }
      } catch (error) {
        console.error("Failed to delete dashboard:", error);
      }
    },
    [deleteDashboard, pathname, router],
  );

  const dashboardTreeContextValue = useMemo(
    () => ({
      activeLink,
      setActiveLink,
      sidebarOpen,
      isSignedIn: isSignedIn || false,
      editingDashboardId,
      editingDashboardName,
      setEditingDashboardId,
      setEditingDashboardName,
      handleRenameDashboard,
      isUpdating,
      contextMenuDashboardId,
      setContextMenuDashboardId,
      onDeleteDashboard: handleDeleteDashboard,
      expandedIds: expandedDashboardIds,
      onToggleExpanded: toggleDashboardExpanded,
      onCreateChild: handleCreateChildDashboard,
      onDuplicate: handleDuplicateDashboard,
      onShare: setSharingDashboard,
      formatDate,
      canEdit,
    }),
    [
      activeLink,
      sidebarOpen,
      isSignedIn,
      editingDashboardId,
      editingDashboardName,
      handleRenameDashboard,
      isUpdating,
      contextMenuDashboardId,
      handleDeleteDashboard,
      expandedDashboardIds,
      toggleDashboardExpanded,
      handleCreateChildDashboard,
      handleDuplicateDashboard,
      formatDate,
      canEdit,
    ],
  );

  return (
    <div
      className={`${
        sidebarOpen ? "w-52" : "w-14"
      } transition-all duration-300 ease-in-out flex flex-col h-screen sticky top-0 left-0 bg-white dark:bg-black`}
    >
      <div
        className={`p-2 flex items-center h-9 ${
          sidebarOpen ? "justify-between" : "justify-center"
        }`}
      >
        <Link href="/" className="flex items-center">
          <Logo
            orgLogoUrl={sidebarOpen ? (activeOrg?.imageUrl ?? null) : null}
            orgName={activeOrg?.name}
          />
        </Link>
      </div>

      <div className="overflow-y-auto flex-1">
        <nav className="space-y-0.5 px-1">
          {visibleSections.map((section) => {
            // "Configure" section is admin-only (matches the previous
            // canEdit guard around API Keys / Settings).
            if (section.header === "Configure" && !canEdit) return null;
            // Dashboards tree slots in right after the Data section, but
            // only when the dashboards feature is enabled.
            const insertDashboardsAfter =
              section.header === "Data" && flags.dashboards;
            return (
              <Fragment key={section.header}>
                <SidebarSection
                  header={section.header}
                  links={section.links}
                  sidebarOpen={sidebarOpen}
                  activeLink={activeLink}
                  isSignedIn={isSignedIn}
                  getNavHref={getNavHref}
                  onLinkClick={(href) => setActiveLink(href)}
                />
                {insertDashboardsAfter && (
                  <>
                    {sidebarOpen && <HeaderText>Dashboards</HeaderText>}
                    <DashboardTreeContext.Provider
                      value={dashboardTreeContextValue}
                    >
                      {dashboardTree.map((node) => (
                        <DashboardTreeItem
                          key={node.id}
                          node={node}
                          level={0}
                        />
                      ))}
                    </DashboardTreeContext.Provider>
                    {canEdit &&
                      (showCreateForm && sidebarOpen ? (
                        <div className="flex items-center gap-1 px-2 py-1">
                          <Input
                            type="text"
                            value={newDashboardName}
                            onChange={(e) =>
                              setNewDashboardName(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCreateDashboard();
                              if (e.key === "Escape") {
                                setShowCreateForm(false);
                                setNewDashboardName("");
                              }
                            }}
                            placeholder="Dashboard name"
                            autoFocus
                            className="flex-1 h-6 text-xs"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleCreateDashboard}
                            disabled={isCreating || !newDashboardName.trim()}
                            className="h-6 w-6 text-muted-foreground hover:text-green-500"
                            title="Create (Enter)"
                          >
                            {isCreating ? <Spinner /> : <Check size={14} />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setShowCreateForm(false);
                              setNewDashboardName("");
                            }}
                            className="h-6 w-6 text-muted-foreground"
                            title="Cancel (Escape)"
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            sidebarOpen ? setShowCreateForm(true) : null
                          }
                          disabled={!isSignedIn}
                          className={`flex items-center w-full h-auto py-1.5 px-2 text-xs text-muted-foreground ${
                            sidebarOpen ? "justify-start" : "justify-center"
                          }`}
                          title={
                            sidebarOpen
                              ? "New Dashboard"
                              : "Expand sidebar to create"
                          }
                        >
                          <Plus size={12} />
                          {sidebarOpen && <span>New Dashboard</span>}
                        </Button>
                      ))}
                  </>
                )}
              </Fragment>
            );
          })}
        </nav>
      </div>
      <div
        className={`p-2 ${
          sidebarOpen ? "" : "flex flex-col items-center gap-1"
        }`}
      >
        {sidebarOpen &&
          isSignedIn &&
          process.env.NEXT_PUBLIC_BILLING_ENABLED !== "false" && (
            <Link
              href="/settings?tab=billing"
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-zinc-900 mb-1"
            >
              {planLabel}
            </Link>
          )}
        <button
          onClick={toggleSidebar}
          className={`border-t border-border  flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-gray-100 dark:hover:bg-zinc-900 ${
            sidebarOpen ? "w-full py-1.5 px-2" : "p-2"
          }`}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? (
            <>
              <PanelLeftClose size={14} />
              <span>Collapse</span>
            </>
          ) : (
            <PanelLeft size={14} />
          )}
        </button>
      </div>

      <ShareDashboardModal
        isOpen={!!sharingDashboard}
        onClose={() => setSharingDashboard(null)}
        dashboardId={sharingDashboard?.id || ""}
        dashboardName={sharingDashboard?.name || ""}
        onOpenSettings={() => {
          if (sharingDashboard) {
            router.push(`/dashboards/${sharingDashboard.id}/settings`);
            setSharingDashboard(null);
          }
        }}
      />
    </div>
  );
};

interface NavItemProps {
  children: React.ReactNode;
  className?: string;
  href?: string;
  icon?: LucideIcon;
  isSelected?: boolean;
  isExpanded?: boolean;
  description?: string;
  isHeader?: boolean;
  onClick?: () => void;
}

const NavItem = ({
  children,
  className,
  href,
  icon: Icon,
  isSelected,
  isExpanded = true,
  description,
  onClick,
  isHeader,
}: NavItemProps) => {
  const baseClasses = "flex items-center rounded transition-colors";
  const selectedClasses = isSelected ? "bg-gray-100 dark:bg-zinc-900" : "";
  const hoverClasses = "hover:bg-gray-100 dark:hover:bg-zinc-900";

  const handleClick = () => {
    if (onClick) {
      startTransition(() => {
        onClick();
      });
    }
  };

  const content = (
    <>
      {Icon && (
        <Icon
          size={12}
          className={`group-hover:text-gray-900 dark:group-hover:text-white ${
            isSelected
              ? "text-gray-900 dark:text-white"
              : "text-gray-500 dark:text-muted-foreground"
          }`}
        />
      )}

      {isExpanded && !isHeader && children && (
        <div className="flex items-center justify-between w-full ml-2">
          <div className="flex-1 flex items-center gap-1">
            <span>{children}</span>
            {description && (
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {description}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );

  if (!href) {
    return (
      <button
        onClick={handleClick}
        className={`${baseClasses} ${selectedClasses} ${hoverClasses} ${className} ${
          isExpanded ? "" : "justify-center"
        } group relative cursor-pointer`}
        title={typeof children === "string" ? children.toString() : ""}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={`${baseClasses} ${selectedClasses} ${hoverClasses} ${className} ${
        isExpanded ? "" : "justify-center"
      } group relative`}
      title={typeof children === "string" ? children.toString() : ""}
    >
      {content}
    </Link>
  );
};

// Render a header + a flat list of links for one section of the sidebar.
// Links come from the feature registry — see lib/features.ts.
interface SidebarLink {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon | undefined;
}

function SidebarSection({
  header,
  links,
  sidebarOpen,
  activeLink,
  isSignedIn,
  getNavHref,
  onLinkClick,
}: {
  header: string;
  links: SidebarLink[];
  sidebarOpen: boolean;
  activeLink: string;
  isSignedIn: boolean | undefined;
  getNavHref: (path: string) => string | undefined;
  onLinkClick: (href: string) => void;
}) {
  return (
    <>
      {sidebarOpen && <HeaderText>{header}</HeaderText>}
      {links.map((link) => {
        const isSelected =
          activeLink === link.href || activeLink.startsWith(`${link.href}/`);
        return (
          <NavItem
            key={link.href}
            onClick={() => onLinkClick(link.href)}
            icon={link.icon}
            href={getNavHref(link.href)}
            isExpanded={sidebarOpen}
            isSelected={isSelected}
            className={`w-full text-left py-1.5 px-2 rounded text-xs ${
              isSelected
                ? "bg-gray-100 dark:bg-zinc-900 text-gray-900 dark:text-white"
                : "hover:bg-gray-100 dark:hover:bg-zinc-900"
            } ${!isSignedIn ? "opacity-60" : ""}`}
          >
            {link.label}
          </NavItem>
        );
      })}
    </>
  );
}

// Dashboard tree item for nested navigation
interface DashboardTreeNode extends DashboardListItem {
  children: DashboardTreeNode[];
}

interface DashboardTreeItemProps {
  node: DashboardTreeNode;
  level: number;
}

const DashboardTreeItem = ({ node, level }: DashboardTreeItemProps) => {
  const {
    activeLink,
    setActiveLink,
    sidebarOpen,
    editingDashboardId,
    editingDashboardName,
    setEditingDashboardId,
    setEditingDashboardName,
    handleRenameDashboard,
    isUpdating,
    contextMenuDashboardId,
    setContextMenuDashboardId,
    onDeleteDashboard,
    expandedIds,
    onToggleExpanded,
    onCreateChild,
    onDuplicate,
    onShare,
    formatDate,
    canEdit,
  } = useDashboardTree();

  const href = `/dashboards/${node.id}`;
  const isSelected = activeLink === href || activeLink.startsWith(`${href}/`);
  const isEditing = editingDashboardId === node.id;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const [iconHovered, setIconHovered] = useState(false);

  if (isEditing && sidebarOpen) {
    return (
      <div
        className="flex items-center gap-1 px-2 py-1"
        style={{ paddingLeft: `${8 + level * 12}px` }}
      >
        <DashboardIcon icon={node.icon} iconUrl={node.icon_url} size="sm" />
        <Input
          type="text"
          value={editingDashboardName}
          onChange={(e) => setEditingDashboardName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameDashboard();
            if (e.key === "Escape") {
              setEditingDashboardId(null);
              setEditingDashboardName("");
            }
          }}
          autoFocus
          className="flex-1 h-5 text-xs px-1"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRenameDashboard}
          disabled={isUpdating || !editingDashboardName.trim()}
          className="h-5 w-5 text-muted-foreground hover:text-green-500"
          title="Save (Enter)"
        >
          {isUpdating ? <Spinner /> : <Check size={12} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setEditingDashboardId(null);
            setEditingDashboardName("");
          }}
          className="h-5 w-5 text-muted-foreground"
          title="Cancel (Escape)"
        >
          <X size={12} />
        </Button>
      </div>
    );
  }

  const dashboardEntity = { id: node.id, name: node.name };

  const entityHandlers = {
    "action-rename-dashboard": () => {
      setEditingDashboardId(node.id);
      setEditingDashboardName(node.name);
    },
    "action-duplicate-dashboard": () => onDuplicate(node.id),
    "action-share-dashboard": () => onShare({ id: node.id, name: node.name }),
    "action-open-new-tab-dashboard": () =>
      window.open(`/dashboards/${node.id}`, "_blank"),
    "action-delete-dashboard": () => onDeleteDashboard(node.id),
  };

  return (
    <>
      <EntityActions
        entityType="dashboard"
        entity={dashboardEntity}
        handlers={entityHandlers}
        role={canEdit ? "org:editor" : "org:viewer"}
        open={contextMenuDashboardId === node.id}
        onOpenChange={(open) => {
          if (open) {
            setContextMenuDashboardId(node.id);
          } else {
            setContextMenuDashboardId(null);
          }
        }}
        align="start"
        side="right"
        footer={
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
            Edited {formatDate(node.updated_at)}
          </div>
        }
      >
        <div
          className={`group flex items-center w-full py-1.5 px-2 rounded text-xs cursor-pointer ${
            sidebarOpen ? "justify-between" : "justify-center"
          } ${
            isSelected
              ? "bg-gray-100 dark:bg-zinc-900 text-gray-900 dark:text-white"
              : "hover:bg-gray-100 dark:hover:bg-zinc-900"
          }`}
          style={
            sidebarOpen ? { paddingLeft: `${8 + level * 12}px` } : undefined
          }
        >
          <div
            className={`flex items-center gap-1 ${
              sidebarOpen ? "flex-1 min-w-0" : ""
            }`}
          >
            {sidebarOpen ? (
              <div
                className="relative shrink-0 flex items-center"
                onMouseEnter={() => setIconHovered(true)}
                onMouseLeave={() => setIconHovered(false)}
              >
                {iconHovered ? (
                  <div className="flex items-center gap-0.5">
                    {hasChildren ? (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleExpanded(node.id);
                        }}
                        className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </button>
                    ) : null}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onCreateChild(node.id);
                      }}
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted"
                      title="Add sub-dashboard"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="h-4 w-4 flex items-center justify-center">
                    <DashboardIcon
                      icon={node.icon}
                      iconUrl={node.icon_url}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            ) : null}

            <Link
              href={href}
              onClick={(e) => {
                e.stopPropagation();
                startTransition(() => {
                  setActiveLink(href);
                });
              }}
              className={`flex items-center gap-1.5 ${
                sidebarOpen ? "flex-1 min-w-0" : ""
              }`}
              title={!sidebarOpen ? node.name : undefined}
            >
              {sidebarOpen ? (
                <span className="truncate">{node.name}</span>
              ) : (
                <DashboardIcon
                  icon={node.icon}
                  iconUrl={node.icon_url}
                  size="sm"
                />
              )}
            </Link>

            {sidebarOpen && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenuDashboardId(node.id);
                }}
                className="h-4 w-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted shrink-0"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </EntityActions>

      {hasChildren && isExpanded
        ? node.children.map((child) => (
            <DashboardTreeItem key={child.id} node={child} level={level + 1} />
          ))
        : null}
    </>
  );
};
