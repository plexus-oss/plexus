"use client";

import { useState, useRef, useMemo } from "react";
import { useOrgMembers } from "@/hooks/use-org-members";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { WebhookEventPicker } from "@/components/webhooks/webhook-event-picker";
import { useEmailIntegrations } from "@/hooks/use-email-integrations";
import type { WebhookEventType } from "@/lib/db/types";
import { AlertTriangle, Mail, X, Users } from "lucide-react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Recipient {
  email: string;
  name: string;
  isOrgMember: boolean;
}

/**
 * Dialog for creating email integrations with multi-recipient support
 */
export function EmailSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { createMultiple, integrations } = useEmailIntegrations();
  const { members } = useOrgMembers();

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [customEmail, setCustomEmail] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>([
    "alert.triggered",
    "alert.resolved",
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const existingEmails = useMemo(
    () => new Set(integrations.map((i) => i.email_address.toLowerCase())),
    [integrations],
  );

  const selectedEmails = useMemo(
    () => new Set(recipients.map((r) => r.email.toLowerCase())),
    [recipients],
  );

  const orgMembers = useMemo(() => {
    return members
      .map((m) => ({ email: m.email ?? "", name: m.name }))
      .filter((m) => m.email);
  }, [members]);

  const isValidCustomEmail =
    customEmail.trim() !== "" && EMAIL_REGEX.test(customEmail.trim());
  const customEmailExists =
    existingEmails.has(customEmail.trim().toLowerCase()) ||
    selectedEmails.has(customEmail.trim().toLowerCase());

  const toggleMember = (email: string, name: string) => {
    const lower = email.toLowerCase();
    if (selectedEmails.has(lower)) {
      setRecipients((prev) =>
        prev.filter((r) => r.email.toLowerCase() !== lower),
      );
    } else {
      setRecipients((prev) => [
        ...prev,
        { email: lower, name, isOrgMember: true },
      ]);
    }
  };

  const addCustomEmail = () => {
    const trimmed = customEmail.trim().toLowerCase();
    if (!trimmed || !EMAIL_REGEX.test(trimmed)) return;
    if (existingEmails.has(trimmed) || selectedEmails.has(trimmed)) return;

    setRecipients((prev) => [
      ...prev,
      { email: trimmed, name: trimmed, isOrgMember: false },
    ]);
    setCustomEmail("");
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) =>
      prev.filter((r) => r.email.toLowerCase() !== email.toLowerCase()),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recipients.length === 0) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const inputs = recipients.map((r) => ({
        name: r.isOrgMember ? r.name : r.email,
        emailAddress: r.email,
        events,
      }));

      await createMultiple(inputs);
      onOpenChange(false);
      setRecipients([]);
      setCustomEmail("");
      setEvents(["alert.triggered", "alert.resolved"]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create integrations",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomEmail();
    }
    if (
      e.key === "Backspace" &&
      !customEmail &&
      recipients.length > 0
    ) {
      removeRecipient(recipients[recipients.length - 1].email);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Add Email Alerts
          </DialogTitle>
          <DialogDescription>
            Send alert notifications to team members or any email address
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Recipients *</Label>
            <div className="border rounded-lg overflow-hidden">
              {/* Selected recipients as chips */}
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 border-b bg-muted/30">
                  {recipients.map((r) => (
                    <Badge
                      key={r.email}
                      variant="secondary"
                      className="text-xs gap-1 pr-1"
                    >
                      {r.isOrgMember ? r.name : r.email}
                      <button
                        type="button"
                        onClick={() => removeRecipient(r.email)}
                        className="ml-0.5 hover:text-foreground text-muted-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Org members list */}
              {orgMembers.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Team Members
                    </span>
                  </div>
                  {orgMembers.map((member) => {
                    const lower = member.email.toLowerCase();
                    const alreadyIntegrated = existingEmails.has(lower);
                    const isSelected = selectedEmails.has(lower);

                    return (
                      <label
                        key={member.email}
                        className={`flex items-center gap-3 px-3 py-1.5 cursor-pointer hover:bg-muted/50 ${
                          alreadyIntegrated
                            ? "opacity-50 cursor-default"
                            : ""
                        }`}
                      >
                        <Checkbox
                          checked={isSelected || alreadyIntegrated}
                          disabled={alreadyIntegrated}
                          onCheckedChange={() =>
                            !alreadyIntegrated &&
                            toggleMember(member.email, member.name)
                          }
                        />
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              {(member.name || "?").charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-sm truncate block">
                              {member.name}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground truncate shrink-0">
                            {member.email}
                          </span>
                          {alreadyIntegrated && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              (added)
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Custom email input */}
              <div className="border-t">
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                  <Mail className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Custom Email
                  </span>
                </div>
                <div className="px-3 pb-2 flex gap-2">
                  <Input
                    ref={customInputRef}
                    type="email"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    onKeyDown={handleCustomKeyDown}
                    placeholder="alerts@yourcompany.com"
                    className={`h-8 text-sm flex-1 ${
                      customEmail && !isValidCustomEmail
                        ? "border-red-500"
                        : ""
                    }`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs shrink-0"
                    disabled={!isValidCustomEmail || customEmailExists}
                    onClick={addCustomEmail}
                  >
                    Add
                  </Button>
                </div>
                {customEmail && customEmailExists && isValidCustomEmail && (
                  <p className="text-xs text-muted-foreground px-3 pb-2">
                    This email is already added
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Events to Send</Label>
            <div className="border rounded-lg p-3 max-h-48 overflow-y-auto">
              <WebhookEventPicker value={events} onChange={setEvents} />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                recipients.length === 0 ||
                events.length === 0 ||
                isSubmitting
              }
            >
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Adding...
                </>
              ) : recipients.length === 0 ? (
                "Add Recipients"
              ) : (
                `Add ${recipients.length} Recipient${recipients.length > 1 ? "s" : ""}`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
