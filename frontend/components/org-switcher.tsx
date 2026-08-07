"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMyOrgs, setActiveOrg } from "@/hooks/use-my-orgs";
import { usePlexusSession } from "@/hooks/use-plexus-session";

interface OrgEntry {
  id: string;
  name: string;
  imageUrl: string | null;
}

function OrgSwitcherView({
  active,
  orgs,
  onSwitch,
}: {
  active: OrgEntry | null;
  orgs: OrgEntry[];
  onSwitch: (orgId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between h-9 text-sm font-medium shadow-none focus:shadow-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded-sm border border-border bg-muted/50 flex items-center justify-center overflow-hidden shrink-0">
              {active?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- dynamic remote org avatar URL, not allowlisted in next.config
                <img
                  src={active.imageUrl}
                  alt={active.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {active?.name?.charAt(0)?.toUpperCase() || "?"}
                </span>
              )}
            </div>
            <span className="truncate">
              {active?.name || "Select organization"}
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Organizations
        </DropdownMenuLabel>
        {orgs.map((org) => {
          const isActive = org.id === active?.id;
          return (
            <DropdownMenuItem
              key={org.id}
              onClick={() => !isActive && onSwitch(org.id)}
              className="text-xs"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="h-5 w-5 rounded-sm border border-border bg-muted/50 flex items-center justify-center overflow-hidden shrink-0">
                  {org.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- dynamic remote org avatar URL, not allowlisted in next.config
                    <img
                      src={org.imageUrl}
                      alt={org.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[9px] font-semibold text-muted-foreground">
                      {org.name?.charAt(0)?.toUpperCase() || "?"}
                    </span>
                  )}
                </div>
                <span className="truncate">{org.name}</span>
              </div>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OrgSwitcher() {
  const { activeOrgId, orgs } = useMyOrgs();
  const { impersonatingOrg } = usePlexusSession();

  const handleSwitch = async (orgId: string) => {
    const ok = await setActiveOrg(orgId);
    if (ok) window.location.href = "/";
  };

  // While impersonating, switching is disabled (the impersonation cookie
  // would win over any active-org change) — show the impersonated org
  // statically; exit lives in the global banner.
  if (impersonatingOrg) {
    return (
      <Button
        variant="outline"
        disabled
        className="w-full justify-start h-9 text-sm font-medium shadow-none border-yellow-500/50"
      >
        <span className="truncate">{impersonatingOrg.name}</span>
      </Button>
    );
  }

  const entries = orgs.map((o) => ({
    id: o.orgId,
    name: o.name,
    imageUrl: o.imageUrl,
  }));
  const active = entries.find((o) => o.id === activeOrgId) ?? null;

  return (
    <OrgSwitcherView active={active} orgs={entries} onSwitch={handleSwitch} />
  );
}
