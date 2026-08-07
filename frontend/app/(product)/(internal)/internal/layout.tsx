"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePlexusStaff } from "@/hooks/use-plexus-staff";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

export default function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isStaff, isLoaded } = usePlexusStaff();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isStaff) {
      router.replace("/");
    }
  }, [isLoaded, isStaff, router]);

  if (!isLoaded) {
    return (
      <PageWrapper
        title={
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              Plexus Admin
            </span>
            <Badge className="bg-yellow-500 text-black text-[10px] uppercase tracking-wider">
              Internal
            </Badge>
          </div>
        }
      >
        <div className="flex items-center justify-center h-full">
          <Spinner className="h-5 w-5 text-muted-foreground" />
        </div>
      </PageWrapper>
    );
  }

  if (!isStaff) {
    return null;
  }

  return (
    <PageWrapper
      title={
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            Plexus Admin
          </span>
          <Badge className="bg-yellow-500 text-black text-[10px] uppercase tracking-wider">
            Internal
          </Badge>
        </div>
      }
    >
      <div className="flex-1 overflow-auto border-t-2 border-yellow-500/30">
        {children}
      </div>
    </PageWrapper>
  );
}
