"use client";

import { clsx } from "clsx";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useSyncExternalStore } from "react";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export function Logo({
  className,
  orgLogoUrl,
  orgName,
}: {
  className?: string;
  /** Org logo URL — renders a "Plexus × org" lockup in place of the wordmark. */
  orgLogoUrl?: string | null;
  orgName?: string;
}) {
  if (orgLogoUrl) {
    return (
      <div className="flex items-center gap-1.5">
        <SimpleLogo className="w-4 h-4" />
        <span className="text-[11px] leading-none text-muted-foreground select-none">
          ×
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic remote org logo URL, not allowlisted in next.config */}
        <img
          src={orgLogoUrl}
          alt={orgName ?? "Organization"}
          className="h-4 w-auto max-w-24 rounded-[3px] object-contain"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <SimpleLogo className="w-4 h-4" />
      <span
        className={clsx(className, "font-medium text-[14px]", inter.className)}
      >
        Plexus
      </span>
    </div>
  );
}

// False during SSR and the initial hydration render, true thereafter — the
// hydration-safe replacement for a setState-in-effect mount flag.
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function SimpleLogo({ className }: { className?: string }) {
  const mounted = useMounted();
  const { resolvedTheme } = useTheme();

  const logo =
    mounted && resolvedTheme === "dark" ? "/white.png" : "/black.png";

  return (
    <Image
      src={logo}
      alt="Plexus"
      width={20}
      height={20}
      className={className}
    />
  );
}
