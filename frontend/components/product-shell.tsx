"use client";

/**
 * The standard product chrome: sidebar Navbar + scrollable main + Terminal.
 * A thin wrapper kept as its own client component so the layout (a server
 * component) can compose it around the page tree.
 */

import { Navbar } from "@/components/nav";
import { Terminal } from "@/components/assistant/terminal";
import { ImpersonationBanner } from "@/components/impersonation-banner";

export function ProductShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-black">
      <ImpersonationBanner />
      <div className="flex-1 flex min-h-0">
        <Navbar />
        <main className="flex-1 flex flex-col min-h-0 overflow-auto">
          {children}
        </main>
        <Terminal />
      </div>
    </div>
  );
}
