"use client";

/**
 * Profile page. Essentials only: avatar (mirrored image or initials),
 * name editing via PATCH /api/me, read-only email, sign out, and account
 * deletion (danger zone).
 */

import { useState } from "react";
import { toast } from "sonner";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { LogOut } from "lucide-react";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { cn } from "@/lib/utils";
import { DeleteAccountSection } from "@/components/profile/delete-account-section";

export function AuthjsProfilePage() {
  const { isLoaded, name, firstName, email, imageUrl, signOut } =
    usePlexusSession();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed the editable name fields once from the loaded session. Adjusting state
  // during render (guarded by `seeded`) is React's documented alternative to a
  // setState-in-effect and preserves the seed-once behavior.
  if (isLoaded && !seeded) {
    setSeeded(true);
    setFirst(firstName ?? "");
    setLast(
      name && firstName && name.startsWith(firstName)
        ? name.slice(firstName.length).trim()
        : "",
    );
  }

  if (!isLoaded) {
    return (
      <PageWrapper title="Profile" description="Plexus profile information">
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      </PageWrapper>
    );
  }

  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") ||
    email?.[0]?.toUpperCase() ||
    "?";

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: first, lastName: last }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success("Profile updated");
      window.location.reload();
    } catch {
      toast.error("Could not update profile");
      setSaving(false);
    }
  };

  return (
    <PageWrapper title="Profile" description="Plexus profile information">
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-auto">
          <div className={cn("p-6 mx-auto space-y-8", "max-w-2xl")}>
            <Card className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- dynamic remote OAuth avatar URL not in next.config images
                    <img
                      src={imageUrl}
                      alt={name || "Avatar"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-lg font-semibold text-muted-foreground">
                      {initials}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {name || email}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {email}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">
                    First name
                  </Label>
                  <Input
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">
                    Last name
                  </Label>
                  <Input
                    value={last}
                    onChange={(e) => setLast(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="text-xs"
                  onClick={save}
                  loading={saving}
                >
                  Save
                </Button>
              </div>
            </Card>

            <SectionHeader>Email</SectionHeader>
            <Card className="p-4 space-y-2">
              <Input
                value={email ?? ""}
                disabled
                className="h-9 text-sm bg-muted/50"
              />
              <p className="text-xs text-muted-foreground">
                Contact support to change your email address.
              </p>
            </Card>

            <SectionHeader>Session</SectionHeader>
            <Card className="p-4">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => signOut()}
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Sign out
              </Button>
            </Card>

            <DeleteAccountSection />
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
