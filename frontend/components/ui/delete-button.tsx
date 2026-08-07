"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { cn } from "@/lib/utils";

interface DeleteButtonProps {
  /** Text label (e.g. "Delete Monitor"). Omit for icon-only mode. */
  label?: string;
  /** Called after confirmation (or immediately if skipConfirm). */
  onConfirm: () => void;
  /** Entity name shown in the confirmation dialog. */
  entityName: string;
  disabled?: boolean;
  loading?: boolean;
  /** Override confirmation dialog title. Default: "Delete {entityName}" */
  confirmTitle?: string;
  /** Override confirmation dialog description. */
  confirmDescription?: string;
  /** Override confirm button label. Default: "Delete" */
  confirmLabel?: string;
  /** Skip the confirmation dialog (for inline/low-stakes deletions). */
  skipConfirm?: boolean;
  className?: string;
}

/**
 * Standardized delete button with built-in confirmation dialog.
 *
 * - With `label`: outline button with destructive text styling
 * - Without `label`: ghost icon-only button
 * - Confirmation dialog shown by default (disable with `skipConfirm`)
 */
export function DeleteButton({
  label,
  onConfirm,
  entityName,
  disabled,
  loading,
  confirmTitle,
  confirmDescription,
  confirmLabel = "Delete",
  skipConfirm,
  className,
}: DeleteButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClick = () => {
    if (skipConfirm) {
      onConfirm();
    } else {
      setShowConfirm(true);
    }
  };

  const handleConfirm = () => {
    onConfirm();
    setShowConfirm(false);
  };

  const icon = loading ? (
    <Spinner variant="button" className="h-3.5 w-3.5" />
  ) : (
    <Trash2 className="h-3.5 w-3.5" />
  );

  const button = label ? (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "text-destructive hover:text-destructive hover:bg-destructive/10",
        className,
      )}
      onClick={handleClick}
      disabled={disabled || loading}
    >
      {icon}
      {label}
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10",
        className,
      )}
      onClick={handleClick}
      disabled={disabled || loading}
    >
      {icon}
    </Button>
  );

  return (
    <>
      {button}
      {!skipConfirm && (
        <ConfirmActionDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          title={confirmTitle ?? `Delete ${entityName}`}
          description={
            confirmDescription ??
            `Are you sure you want to delete "${entityName}"? This action cannot be undone.`
          }
          confirmLabel={confirmLabel}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
