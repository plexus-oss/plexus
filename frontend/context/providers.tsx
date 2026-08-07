"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { SWRProvider } from "./swr-provider";
import { RealtimeInvalidationProvider } from "./realtime-invalidation-provider";
import { AuthenticatedRealtimeProvider } from "./gateway-connection-provider";
import { UserSettingsProvider } from "./user-settings-context";
import { GPUDeviceProvider } from "@/components/ui/charts/gpu-device-provider";
import { HotkeyProvider } from "@/components/hotkey-provider";
import { AlertNotifier } from "@/components/alerts/alert-notifier";
import { PageViewTracker } from "@/components/page-view-tracker";

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <SWRProvider>
      <RealtimeInvalidationProvider>
        <AuthenticatedRealtimeProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <UserSettingsProvider>
              <HotkeyProvider>
                <GPUDeviceProvider>{children}</GPUDeviceProvider>
                <Toaster theme="system" />
                <AlertNotifier />
                <PageViewTracker />
              </HotkeyProvider>
            </UserSettingsProvider>
          </ThemeProvider>
        </AuthenticatedRealtimeProvider>
      </RealtimeInvalidationProvider>
    </SWRProvider>
  );
};
