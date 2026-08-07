"use client";

import { Button } from "@/components/ui/button";
import { KeyboardShortcut } from "@/components/ui/keyboard-shortcut";

interface CreateButtonProps {
  /** Text label (required). */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Keyboard shortcut string to display (e.g. "N", "Cmd+K") */
  shortcut?: string;
  className?: string;
}

/**
 * Standardized create/add button. Always primary variant, small size, with an
 * optional keyboard-shortcut hint. Loading state is delegated to `Button`.
 */
export function CreateButton({
  label,
  onClick,
  disabled,
  loading,
  shortcut,
  className,
}: CreateButtonProps) {
  return (
    <Button
      variant="default"
      size="sm"
      className={className}
      onClick={onClick}
      disabled={disabled}
      loading={loading}
    >
      {label}
      {shortcut && (
        <KeyboardShortcut shortcut={shortcut} className="opacity-60" />
      )}
    </Button>
  );
}
