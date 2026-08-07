"use client";

import { useState } from "react";
import { useOrgMembership } from "@/hooks/use-org-membership";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Mail, MoreHorizontal, Clock, XCircle, Lock, Globe } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { EntityActions } from "@/components/ui/entity-actions";
import { CreateButton } from "@/components/ui/create-button";
import { useRole, type OrgRole } from "@/hooks/use-role";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "@/lib/toast-utils";
import { MemberScopeSheet } from "@/components/settings/member-scope-sheet";
import {
  ScopeEditor,
  scopeDraftFrom,
  scopePayload,
  type ScopeDraft,
} from "@/components/settings/scope-editor";

const ROLE_LABELS: Record<string, string> = {
  "org:admin": "Admin",
  "org:editor": "Editor",
  "org:viewer": "Viewer",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  "org:admin": "Full access to all settings and data",
  "org:editor": "Can create and edit dashboards and devices",
  "org:viewer": "Read-only access to dashboards and data",
};

function getRoleBadgeVariant(role: string) {
  if (role === "org:admin") return "default";
  return "secondary";
}

export function MembersSettings() {
  const { customRoles } = usePermissions();
  const {
    isLoading,
    orgName,
    members,
    invitations,
    invite,
    updateRole,
    updateScope,
    removeMember,
    revokeInvitation,
  } = useOrgMembership();
  const { userId: currentUserId } = usePlexusSession();
  const { isAdmin } = useRole();

  const [scopeMember, setScopeMember] = useState<{
    id: string;
    name: string;
    allowedSourceIds: string[] | null;
  } | null>(null);

  // Role labels: built-ins + the org's custom roles (value = role id).
  const roleOptions = [
    ...(Object.entries(ROLE_LABELS) as [string, string][]).map(
      ([value, label]) => ({ value, label, hint: ROLE_DESCRIPTIONS[value] }),
    ),
    ...Object.values(customRoles).map((r) => ({
      value: r.id,
      label: r.name,
      hint: `Custom role · based on ${r.base === "org:editor" ? "Editor" : "Viewer"}`,
    })),
  ];
  const roleLabel = (role: string) =>
    ROLE_LABELS[role] || customRoles[role]?.name || role;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("org:viewer");
  const [inviteScope, setInviteScope] = useState<ScopeDraft>(() =>
    scopeDraftFrom(null),
  );
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");

  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError("");
    const scope = scopePayload(inviteScope);
    const result = await invite(inviteEmail.trim(), inviteRole, {
      allowedSourceIds: scope.sourceIds,
    });
    setInviting(false);
    if (!result.ok) {
      setInviteError(result.error ?? "Failed to send invitation");
      return;
    }
    setInviteEmail("");
    setInviteRole("org:viewer");
    setInviteScope(scopeDraftFrom(null));
    setInviteOpen(false);
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    setUpdatingMemberId(memberId);
    const result = await updateRole(memberId, newRole);
    if (!result.ok) console.error("Failed to update role:", result.error);
    setUpdatingMemberId(null);
  };

  const handleRemoveMember = async (memberId: string) => {
    setRemovingId(memberId);
    const result = await removeMember(memberId);
    if (!result.ok) console.error("Failed to remove member:", result.error);
    setRemovingId(null);
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    setRevokingId(invitationId);
    const result = await revokeInvitation(invitationId);
    if (!result.ok) console.error("Failed to revoke invitation:", result.error);
    setRevokingId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const membersList = members;
  const pendingInvitations = invitations;
  const adminCount = membersList.filter(
    (m) => m.role === "org:admin",
  ).length;

  return (
    <>
      {/* Members (pending invites fold into the same list as muted rows) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader>
            Members{" "}
            <span className="text-muted-foreground font-normal">
              ({membersList.length}
              {pendingInvitations.length > 0 &&
                ` · ${pendingInvitations.length} pending`}
              )
            </span>
          </SectionHeader>
          {isAdmin && (
            <CreateButton
              label="Invite Member"
              onClick={() => setInviteOpen(true)}
            />
          )}
        </div>

        <Card className="divide-y divide-border">
          {membersList.map((member) => {
            const name = member.name || "Unknown";
            const email = member.email;
            const role = member.role;
            const isCurrentUser = member.userId === currentUserId;
            const isUpdating = updatingMemberId === member.id;
            const isRemoving = removingId === member.id;
            const isLastAdmin = role === "org:admin" && adminCount <= 1;

            return (
              <div
                key={member.id}
                className="flex items-center justify-between px-4 py-3 gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {member.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- dynamic remote member avatar URL, not allowlisted in next.config
                      <img
                        src={member.imageUrl}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {(name || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {name}
                      {isCurrentUser && (
                        <span className="text-muted-foreground font-normal ml-1.5">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {email}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && !isCurrentUser ? (
                    <>
                      <Select
                        value={role}
                        onValueChange={(val) => handleRoleChange(member.id, val)}
                        disabled={isUpdating}
                      >
                        <SelectTrigger
                          className="h-7 text-xs w-[110px]"
                          size="sm"
                        >
                          {isUpdating ? (
                            <Spinner variant="button" className="h-3 w-3" />
                          ) : (
                            <SelectValue />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Access scope — admins bypass scoping, so hide it for them. */}
                      {role !== "org:admin" &&
                        (() => {
                          const src = member.allowedSourceIds;
                          return (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                setScopeMember({
                                  id: member.id,
                                  name,
                                  allowedSourceIds: member.allowedSourceIds,
                                })
                              }
                              title="Access scope"
                            >
                              {src !== null ? (
                                <>
                                  <Lock className="h-3 w-3" />
                                  {`${src.length} source${src.length === 1 ? "" : "s"}`}
                                </>
                              ) : (
                                <>
                                  <Globe className="h-3 w-3" />
                                  All
                                </>
                              )}
                            </Button>
                          );
                        })()}

                      <EntityActions
                        entityType="member"
                        entity={{
                          id: member.id,
                          name,
                        }}
                        role="org:admin"
                        handlers={{
                          "action-remove-member": () => {
                            if (isLastAdmin) {
                              toast.error(
                                "Cannot remove the only admin. Promote another member first.",
                              );
                              return;
                            }
                            handleRemoveMember(member.id);
                          },
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={isRemoving}
                        >
                          {isRemoving ? (
                            <Spinner variant="button" className="h-3.5 w-3.5" />
                          ) : (
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </EntityActions>
                    </>
                  ) : (
                    <Badge
                      variant={getRoleBadgeVariant(role)}
                      className="text-xs"
                    >
                      {roleLabel(role)}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}

          {pendingInvitations.map((invitation) => {
            const isRevoking = revokingId === invitation.id;
            return (
              <div
                key={invitation.id}
                className="flex items-center justify-between px-4 py-3 gap-4"
              >
                <div className="flex items-center gap-3 min-w-0 opacity-70">
                  <div className="h-8 w-8 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm truncate">{invitation.email}</p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Invite pending</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className="text-xs">
                    {roleLabel(invitation.role)}
                  </Badge>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      disabled={isRevoking}
                      title="Revoke invitation"
                      onClick={() => handleRevokeInvitation(invitation.id)}
                    >
                      {isRevoking ? (
                        <Spinner variant="button" className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      </div>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join {orgName || "your organization"}. Role
              sets what they can do; scope sets what they can see.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Email Address
              </Label>
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setInviteError("");
                }}
                className="h-9 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && inviteEmail.trim()) handleInvite();
                }}
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                Role
              </Label>
              <Select
                value={inviteRole}
                onValueChange={(val) => setInviteRole(val)}
              >
                <SelectTrigger className="h-9 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <div>
                        <span>{o.label}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {o.hint}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {inviteRole !== "org:admin" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  Scope
                </Label>
                <div className="flex flex-col gap-3">
                  <ScopeEditor
                    draft={inviteScope}
                    onChange={setInviteScope}
                    fullLabel="Full access"
                    fullHint="All org sources"
                    emptySelectionNote="member sees nothing"
                    listClassName="max-h-48"
                  />
                </div>
              </div>
            )}

            {inviteError && (
              <p className="text-xs text-destructive">{inviteError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setInviteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs"
              onClick={handleInvite}
              disabled={!inviteEmail.trim()}
              loading={inviting}
            >
              Send Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-member source scoping */}
      <MemberScopeSheet
        member={scopeMember}
        open={scopeMember !== null}
        onOpenChange={(open) => {
          if (!open) setScopeMember(null);
        }}
        onSave={(allowedSourceIds) =>
          updateScope(scopeMember!.id, allowedSourceIds)
        }
      />
    </>
  );
}
