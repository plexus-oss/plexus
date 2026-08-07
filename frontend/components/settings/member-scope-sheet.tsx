"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  ScopeEditor,
  scopeDraftFrom,
  scopePayload,
  type ScopeDraft,
} from "./scope-editor";
import { toast } from "@/lib/toast-utils";

interface ScopeMember {
  id: string;
  name: string;
  allowedSourceIds: string[] | null;
}

interface Props {
  member: ScopeMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    allowedSourceIds: string[] | null,
  ) => Promise<{ ok: boolean; error?: string }>;
}

export function MemberScopeSheet({ member, open, onOpenChange, onSave }: Props) {
  const [draft, setDraft] = useState<ScopeDraft>(scopeDraftFrom(null));
  const [saving, setSaving] = useState(false);
  // Re-seed local state whenever a new member opens the sheet.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (member && seededFor !== member.id) {
    setSeededFor(member.id);
    setDraft(scopeDraftFrom(member.allowedSourceIds));
  }

  const handleSave = async () => {
    if (!member) return;
    setSaving(true);
    const { sourceIds } = scopePayload(draft);
    const result = await onSave(sourceIds);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to update access");
      return;
    }
    toast.success("Access updated");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Source access</SheetTitle>
          <SheetDescription>
            Control which sources {member?.name ?? "this member"} can see across
            dashboards, alerts, events, and telemetry. Picking an entity (e.g.
            a satellite) shows just its rows from the connection it lives in.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-4">
          <ScopeEditor
            draft={draft}
            onChange={setDraft}
            fullLabel="Full access"
            fullHint="All org sources"
            emptySelectionNote="member sees nothing"
          />
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-2 border-t border-border px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving}>
            Save access
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
