"use client";

import { useState, useMemo } from "react";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import {
  Copy,
  Check,
  Link2,
  Trash2,
  Eye,
  Settings,
  Lock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useDashboardShare } from "@/hooks/use-dashboard-share";

interface ShareDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  dashboardId: string;
  dashboardName: string;
  onOpenSettings?: () => void;
}

export function ShareDashboardModal({
  isOpen,
  onClose,
  dashboardId,
  dashboardName,
  onOpenSettings,
}: ShareDashboardModalProps) {
  const [copied, setCopied] = useState(false);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [revokingLinkId, setRevokingLinkId] = useState<string | null>(null);

  const { formatDate } = useFormattedTime();
  const {
    shareLinks,
    isLoading,
    createShareLink,
    revokeShareLink,
  } = useDashboardShare(dashboardId);

  // Derive the share URL from the current links (kept in sync by SWR after
  // create/revoke, which both await mutate()).
  const shareUrl = useMemo(() => {
    if (shareLinks.length === 0) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/shared/${shareLinks[0].token}`;
  }, [shareLinks]);

  const handleCopyLink = async () => {
    try {
      // If no share link exists, create one first
      if (!shareUrl) {
        setIsCreatingLink(true);
        const link = await createShareLink();
        const url = link.url;
        await navigator.clipboard.writeText(url);
      } else {
        await navigator.clipboard.writeText(shareUrl);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleCreateLink = async () => {
    setIsCreatingLink(true);
    try {
      await createShareLink({
        password: enablePassword && password ? password : undefined,
      });
      // Reset password fields after creation
      setEnablePassword(false);
      setPassword("");
      setShowAdvanced(false);
    } catch (err) {
      console.error("Failed to create link:", err);
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleRevokeLink = async (linkId: string) => {
    setRevokingLinkId(linkId);
    try {
      await revokeShareLink(linkId);
    } catch (err) {
      console.error("Failed to revoke link:", err);
    } finally {
      setRevokingLinkId(null);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
       
            Share Dashboard
          </DialogTitle>
          <DialogDescription>
            Share &quot;{dashboardName}&quot; with your team or create a public
            link.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Share link section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Share Link
                </Label>
                {onOpenSettings && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={onOpenSettings}
                  >
                    <Settings className="h-3 w-3" />
                    Manage
                  </Button>
                )}
              </div>

              {shareLinks.length > 0 ? (
                <div className="space-y-2">
                  {shareLinks.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30"
                    >
                      {link.password_hash ? (
                        <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">
                          {typeof window !== "undefined"
                            ? `${window.location.origin}/shared/${link.token}`
                            : ""}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {link.view_count} views
                          </span>
                          {link.password_hash && (
                            <span className="flex items-center gap-1">
                              <Lock className="h-3 w-3" />
                              Password protected
                            </span>
                          )}
                          {link.expires_at && (
                            <span>
                              Expires{" "}
                              {formatDate(new Date(link.expires_at))}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={handleCopyLink}
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                        disabled={revokingLinkId === link.id}
                        onClick={() => handleRevokeLink(link.id)}
                      >
                        {revokingLinkId === link.id ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Advanced options toggle */}
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showAdvanced ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    Advanced options
                  </button>

                  {showAdvanced && (
                    <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-sm">Password protection</Label>
                          <p className="text-xs text-muted-foreground">
                            Require a password to view
                          </p>
                        </div>
                        <Switch
                          checked={enablePassword}
                          onCheckedChange={setEnablePassword}
                        />
                      </div>
                      {enablePassword && (
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="password"
                            placeholder="Enter password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="pl-9"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        readOnly
                        placeholder="No share link created yet"
                        className="pl-9 pr-3 text-sm bg-muted/50"
                      />
                    </div>
                    <Button
                      onClick={handleCreateLink}
                      disabled={isCreatingLink || (enablePassword && !password)}
                    >
                      {isCreatingLink ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        "Create Link"
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
