"use client";

import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  /** Extra content (e.g. a consequence list) rendered below the description. */
  children?: ReactNode;
  /** Require the user to type this exact string before confirming. */
  confirmText?: string;
  /** Externally disable the confirm button (e.g. a blocking precondition). */
  confirmDisabled?: boolean;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  children,
  confirmText,
  confirmDisabled = false,
}: ConfirmActionDialogProps) {
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(open);

  // Reset the typed confirmation each time the dialog opens. Adjusting state
  // during render (guarded by `wasOpen`) is React's documented alternative to
  // a setState-in-effect.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }

  const confirmBlocked =
    confirmDisabled || (confirmText !== undefined && typed !== confirmText);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmText !== undefined && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Type{" "}
              <span className="font-mono font-medium text-foreground">
                {confirmText}
              </span>{" "}
              to confirm.
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmText}
              className="h-9 text-sm"
              autoComplete="off"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            disabled={confirmBlocked}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
