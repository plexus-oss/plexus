"use client";

import { useState } from "react";
import Link from "next/link";
import { useInternalOrgSearch } from "@/hooks/use-internal";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Search } from "lucide-react";

export default function InternalOrgPicker() {
  const [query, setQuery] = useState("");
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const { orgs, isLoading } = useInternalOrgSearch(query);

  const handleImpersonate = async (orgId: string) => {
    setImpersonatingId(orgId);
    try {
      const res = await fetch("/api/internal/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        // Full navigation so every SWR cache rebuilds under the new org.
        window.location.assign("/");
        return;
      }
    } catch {
      // fall through to reset
    }
    setImpersonatingId(null);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div className="space-y-4">
        <SectionHeader>Organizations</SectionHeader>
        <p className="text-xs text-muted-foreground">
          Search for a customer org to look up its ID, plan, and member count.
        </p>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by org name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 text-sm pl-9"
          />
        </div>
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground">Searching...</div>
      )}

      <div className="space-y-4">
        <Card className="p-4">
          <div className="space-y-1">
            {orgs.map((org) => {
              const plan = org.plan || "free";
              return (
                <Link
                  key={org.id}
                  href={`/internal/orgs/${encodeURIComponent(org.id)}`}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-accent"
                >
                  <div className="flex items-center gap-3">
                    {org.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- dynamic remote org avatar URL not in next.config images.domains
                      <img
                        src={org.imageUrl}
                        alt={org.name}
                        className="w-7 h-7 rounded-md object-cover"
                      />
                    )}
                    <div>
                      <p className="text-sm font-medium">{org.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {org.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {plan}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {org.membersCount} member
                      {org.membersCount !== 1 ? "s" : ""}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={impersonatingId !== null}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleImpersonate(org.id);
                      }}
                    >
                      {impersonatingId === org.id
                        ? "Starting..."
                        : "Impersonate"}
                    </Button>
                  </div>
                </Link>
              );
            })}

            {orgs.length === 0 && !isLoading && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No organizations found.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
