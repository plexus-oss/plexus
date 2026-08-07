"use client";

import { useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { getContextMenuActions } from "@/lib/manifest";
import { resolveIcon } from "@/lib/manifest/icons";
import type {
  EntityType,
  ManifestAction,
  ActionId,
} from "@/lib/manifest/types";
import type { OrgRole } from "@/lib/api/rbac";
import { KeyboardHint } from "@/components/ui/keyboard-hint";
import { ACTION_EDIT, ACTION_DELETE } from "@/lib/shortcuts";
import { usePermissions } from "@/hooks/use-permissions";

export interface EntityActionsEntity {
  id: string;
  name: string;
}

interface EntityActionsProps {
  entityType: EntityType;
  entity: EntityActionsEntity;
  handlers: Partial<Record<ActionId, (entity: EntityActionsEntity) => void>>;
  children?: ReactNode;
  /** Role of the current user */
  role?: OrgRole;
  /** Dropdown menu alignment */
  align?: "start" | "center" | "end";
  /** Dropdown menu side */
  side?: "top" | "right" | "bottom" | "left";
  /** Extra content to render at the bottom of the menu (e.g., metadata) */
  footer?: ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Controlled open change handler */
  onOpenChange?: (open: boolean) => void;
  /** Anchor position for the menu when used without children wrapper */
  anchorPosition?: { x: number; y: number };
}

/**
 * Reusable context menu + dropdown for any entity.
 *
 * Wraps children as a DropdownMenuTrigger. In controlled mode (`open`/`onOpenChange`),
 * clicking the trigger does NOT open the menu — only right-click and explicit state changes do.
 * This matches the dashboard sidebar pattern where rows are navigable.
 *
 * Destructive actions automatically show a confirmation dialog.
 */
export function EntityActions({
  entityType,
  entity,
  handlers,
  children,
  role,
  align = "start",
  side = "bottom",
  footer,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  anchorPosition,
}: EntityActionsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ManifestAction | null>(
    null,
  );
  // Cursor position for the virtual trigger. This is read during render to
  // position the menu, so it must be state (not a ref).
  const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const setIsOpen = (val: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(val);
    } else {
      setInternalOpen(val);
    }
  };

  const { customRoles, callerRoleId } = usePermissions();
  const actions = getContextMenuActions(entityType, {
    role,
    roleId: callerRoleId,
    customRoles,
  });

  // Split into regular and destructive actions
  const regularActions = actions.filter((a) => !a.isDestructive);
  const destructiveActions = actions.filter((a) => a.isDestructive);

  const handleAction = (action: ManifestAction) => {
    if (action.isDestructive) {
      setConfirmAction(action);
      setIsOpen(false);
      return;
    }

    const handler = handlers[action.id];
    if (handler) {
      handler(entity);
    }
    setIsOpen(false);
  };

  const handleConfirm = () => {
    if (confirmAction) {
      const handler = handlers[confirmAction.id];
      if (handler) {
        handler(entity);
      }
    }
    setConfirmAction(null);
  };

  const renderMenuItem = (action: ManifestAction) => {
    const Icon = resolveIcon(action.icon);

    // Map action IDs to keyboard shortcut hints
    const shortcutKey = action.id.includes("edit")
      ? ACTION_EDIT
      : action.id.includes("delete") || action.isDestructive
        ? ACTION_DELETE
        : null;

    return (
      <DropdownMenuItem
        key={action.id}
        onClick={() => handleAction(action)}
        className={`text-xs py-1 px-2 ${
          action.isDestructive ? "text-destructive focus:text-destructive" : ""
        }`}
      >
        {Icon && <Icon className="h-3 w-3 mr-1.5" />}
        {action.label}
        {shortcutKey && <KeyboardHint keys={shortcutKey} className="ml-auto" />}
      </DropdownMenuItem>
    );
  };

  return (
    <>
      <DropdownMenu
        open={isOpen}
        onOpenChange={(val) => {
          // In controlled mode, only handle close — open is managed by
          // the parent (right-click handler, button click, etc.)
          if (isControlled) {
            if (!val) setIsOpen(false);
          } else {
            setIsOpen(val);
          }
        }}
      >
        {/* Virtual trigger positioned at the cursor — fixes positioning
            for display:contents wrappers and table rows where a real
            trigger element has no bounding rect. */}
        <DropdownMenuTrigger asChild>
          <div
            style={{
              position: "fixed",
              left: anchorPosition?.x ?? anchor.x,
              top: anchorPosition?.y ?? anchor.y,
              width: 0,
              height: 0,
              padding: 0,
              margin: 0,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align={align}
          side={side}
          className="w-40 min-w-0 p-1"
        >
          {regularActions.map(renderMenuItem)}

          {destructiveActions.length > 0 && regularActions.length > 0 && (
            <DropdownMenuSeparator />
          )}
          {destructiveActions.map(renderMenuItem)}

          {footer && (
            <>
              <DropdownMenuSeparator />
              {footer}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {children && (
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            setAnchor({ x: e.clientX, y: e.clientY });
            setIsOpen(true);
          }}
          onMouseDown={(e) => {
            setAnchor({ x: e.clientX, y: e.clientY });
          }}
          className="contents"
        >
          {children}
        </div>
      )}

      <ConfirmActionDialog
        open={!!confirmAction}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={`${confirmAction?.label} ${entity.name}`}
        description={`Are you sure you want to ${confirmAction?.label.toLowerCase()} "${entity.name}"? This action cannot be undone.`}
        confirmLabel={confirmAction?.label ?? "Confirm"}
        onConfirm={handleConfirm}
      />
    </>
  );
}
