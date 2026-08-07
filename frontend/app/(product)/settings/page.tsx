"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
  Suspense,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { TabNav } from "@/components/ui/tab-nav";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Monitor,
  Moon,
  Sun,
  Clock,
  Globe,
  Copy,
  Check,
  ArrowRight,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { ThemeCard } from "@/components/settings/theme-card";
import { useWorkspace } from "@/hooks/use-workspace";
import { toast } from "sonner";
import Link from "next/link";
import { useUserSettings } from "@/hooks/use-user-settings";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { TimeFormatToggle } from "@/components/settings/time-format-toggle";
import { Spinner } from "@/components/ui/spinner";
import { SaveBar } from "@/components/ui/save-bar";
import { useSaveBar } from "@/hooks/use-save-bar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogContent,
} from "@/components/ui/alert-dialog";
import { useRole } from "@/hooks/use-role";
import { usePlexusStaff } from "@/hooks/use-plexus-staff";
import { MembersSettings } from "@/components/settings/members-settings";
import { LicenseLine } from "@/components/settings/license-line";
import { cn } from "@/lib/utils";
import { OrgSwitcher } from "@/components/org-switcher";
import { SubscriptionTab } from "@/components/settings/subscription-tab";
import { DataManagementSettings } from "@/components/settings/data-management-settings";
import { GroupsSettings } from "@/components/settings/groups-settings";

type SettingsTab = "general" | "billing" | "members" | "data" | "access";

const VALID_TABS: SettingsTab[] = [
  "general",
  "members",
  "access",
  "billing",
  "data",
];

function SettingsPageContent() {
  const organization = useWorkspace();
  const { isAdmin } = useRole();
  const { isStaff } = usePlexusStaff();
  const { settings, updateSettings } = useUserSettings();
  const { theme, setTheme } = useTheme();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Hydration-safe mounted flag: false on the server and during the first
  // client render, true afterwards (avoids reading client-only theme state
  // during SSR/hydration).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Tier-1 fun/serious mode. Persisted to localStorage via the same key
  // and pre-paint script (components/theme-script.tsx) used by the
  // marketing site, so a visitor's marketing-site choice carries over.
  // Read from the pre-paint data-theme attribute; only surfaced once
  // `mounted` is true, so there is no hydration mismatch.
  const [mode, setMode] = useState<"fun" | "serious">(() => {
    if (typeof document === "undefined") return "serious";
    return document.documentElement.getAttribute("data-theme") === "fun"
      ? "fun"
      : "serious";
  });
  const setModeAndPersist = (next: "fun" | "serious") => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("plexus-theme", next);
    } catch {}
    setMode(next);
  };

  const billingEnabled = process.env.NEXT_PUBLIC_BILLING_ENABLED !== "false";
  const tabFromUrl = searchParams.get("tab");
  const activeTab: SettingsTab =
    tabFromUrl &&
    VALID_TABS.includes(tabFromUrl as SettingsTab) &&
    (tabFromUrl !== "billing" || billingEnabled)
      ? (tabFromUrl as SettingsTab)
      : "general";

  const setActiveTab = (tab: SettingsTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`);
  };
  const [copiedOrgId, setCopiedOrgId] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [localTimezone, setLocalTimezone] = useState<string | null>(null);
  const [localTimeFormat, setLocalTimeFormat] = useState<boolean | null>(null);

  // Sync the editable org-name field whenever the loaded organization's name
  // changes (adjust-state-during-render pattern instead of an effect).
  const [syncedOrgName, setSyncedOrgName] = useState<string | undefined>(
    undefined,
  );
  if (organization?.name && organization.name !== syncedOrgName) {
    setSyncedOrgName(organization.name);
    setOrgName(organization.name);
  }

  // Refs for save bar — kept in sync after each commit so the save/discard
  // handlers (created once) always read the latest values.
  const orgRef = useRef(organization);
  const orgNameRef = useRef(orgName);
  const localTimezoneRef = useRef(localTimezone);
  const localTimeFormatRef = useRef(localTimeFormat);
  useEffect(() => {
    orgRef.current = organization;
    orgNameRef.current = orgName;
    localTimezoneRef.current = localTimezone;
    localTimeFormatRef.current = localTimeFormat;
  });

  const { saveBarProps, leaveConfirm, markDirty } = useSaveBar({
    onSave: async () => {
      const promises: Promise<unknown>[] = [];
      // Org name
      const org = orgRef.current;
      if (
        org &&
        orgNameRef.current.trim() &&
        orgNameRef.current.trim() !== org.name
      ) {
        promises.push(org.update({ name: orgNameRef.current.trim() }));
      }
      // User settings
      const settingsUpdates: Record<string, unknown> = {};
      if (localTimezoneRef.current !== null)
        settingsUpdates.timezone = localTimezoneRef.current;
      if (localTimeFormatRef.current !== null)
        settingsUpdates.use12HourFormat = localTimeFormatRef.current;
      if (Object.keys(settingsUpdates).length > 0) {
        promises.push(Promise.resolve(updateSettings(settingsUpdates)));
      }
      await Promise.all(promises);
      setLocalTimezone(null);
      setLocalTimeFormat(null);
    },
    onDiscard: () => {
      setOrgName(orgRef.current?.name || "");
      setLocalTimezone(null);
      setLocalTimeFormat(null);
    },
    currentPath: "/settings",
    enabled: isAdmin,
    successMessage: "Settings saved",
    errorMessage: "Failed to save settings",
  });

  const handleOrgNameChange = useCallback(
    (value: string) => {
      setOrgName(value);
      markDirty();
    },
    [markDirty],
  );

  const handleTimezoneChange = useCallback(
    (timezone: string) => {
      setLocalTimezone(timezone);
      markDirty();
    },
    [markDirty],
  );

  const handleTimeFormatChange = useCallback(
    (use12HourFormat: boolean) => {
      setLocalTimeFormat(use12HourFormat);
      markDirty();
    },
    [markDirty],
  );

  const copyOrgId = () => {
    if (organization?.id) {
      navigator.clipboard.writeText(organization.id);
      setCopiedOrgId(true);
      setTimeout(() => setCopiedOrgId(false), 2000);
    }
  };

  const tabs = [
    { id: "general", label: "General" },
    ...(isAdmin ? [{ id: "members", label: "Members" }] : []),
    ...(isAdmin ? [{ id: "access", label: "Access" }] : []),
    ...(billingEnabled ? [{ id: "billing", label: "Subscription" }] : []),
    ...(isAdmin ? [{ id: "data", label: "Data" }] : []),
  ];

  return (
    <PageWrapper title="Settings" description="Manage your settings">
      <div className="flex flex-col h-full">
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as SettingsTab)}
        />

        <div className="flex-1 overflow-auto">
          <div
            className={cn(
              "p-6 mx-auto space-y-8",
              activeTab === "members" || activeTab === "access"
                ? "max-w-3xl"
                : "max-w-2xl",
            )}
          >
            {activeTab === "general" && (
              <>
                <SectionHeader>Organization</SectionHeader>
                <Card className="p-4 space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Logo
                    </Label>
                    <div className="flex items-center gap-4">
                      <div className="relative h-16 w-16 rounded-lg border border-border bg-muted/50 flex items-center justify-center overflow-hidden shrink-0">
                        {organization?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote org logo URL (Tigris public bucket) not in next.config images domains
                          <img
                            src={organization.imageUrl}
                            alt={organization.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-lg font-semibold text-muted-foreground">
                            {organization?.name?.charAt(0)?.toUpperCase() ||
                              "?"}
                          </span>
                        )}
                      </div>
                      {organization?.supportsLogo && (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              disabled={logoUploading || !isAdmin}
                              onClick={() => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept =
                                  "image/png,image/jpeg,image/webp";
                                input.onchange = async (e) => {
                                  const file = (e.target as HTMLInputElement)
                                    .files?.[0];
                                  if (!file || !organization) return;
                                  if (file.size > 2 * 1024 * 1024) {
                                    toast.error(
                                      "File too large. Maximum size is 2MB.",
                                    );
                                    return;
                                  }
                                  setLogoUploading(true);
                                  try {
                                    await organization.setLogo({ file });
                                    toast.success("Logo updated");
                                  } catch (err) {
                                    console.error(
                                      "Failed to upload logo:",
                                      err,
                                    );
                                    toast.error(
                                      err instanceof Error && err.message
                                        ? err.message
                                        : "Failed to upload logo",
                                    );
                                  } finally {
                                    setLogoUploading(false);
                                  }
                                };
                                input.click();
                              }}
                            >
                              {logoUploading ? (
                                <Spinner
                                  variant="button"
                                  className="h-3.5 w-3.5 mr-1.5"
                                />
                              ) : (
                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              Upload
                            </Button>
                            {organization?.imageUrl && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs text-muted-foreground"
                                disabled={logoUploading || !isAdmin}
                                onClick={async () => {
                                  if (!organization) return;
                                  setLogoUploading(true);
                                  try {
                                    await organization.setLogo({ file: null });
                                    toast.success("Logo removed");
                                  } catch (err) {
                                    console.error(
                                      "Failed to remove logo:",
                                      err,
                                    );
                                    toast.error("Failed to remove logo");
                                  } finally {
                                    setLogoUploading(false);
                                  }
                                }}
                              >
                                <X className="h-3.5 w-3.5 mr-1.5" />
                                Remove
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            PNG, JPG, or WebP. Recommended 256x256px.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Org Name */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Organization Name
                    </Label>
                    <Input
                      type="text"
                      value={orgName}
                      onChange={(e) => handleOrgNameChange(e.target.value)}
                      disabled={!isAdmin}
                      maxLength={100}
                      className="h-9 text-sm"
                    />
                  </div>

                  {/* Switch Organization */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Switch Organization
                    </Label>
                    <OrgSwitcher />
                  </div>

                  {/* Org ID */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Organization ID
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={
                          organization
                            ? organization.id
                            : "No organization ID found"
                        }
                        disabled
                        className="h-9 text-sm bg-muted/50 font-mono flex-1"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 px-3"
                        onClick={copyOrgId}
                        disabled={!organization?.id}
                      >
                        {copiedOrgId ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Use this ID when configuring API integrations
                    </p>
                  </div>

                  {/* License (one line — the only license surface in the UI) */}
                  <LicenseLine />
                </Card>

                <SectionHeader>Appearance</SectionHeader>
                <Card className="p-4">
                  <Label className="text-xs text-muted-foreground mb-3 block">
                    Theme
                  </Label>
                  <div className="flex gap-3">
                    <ThemeCard
                      theme="light"
                      label="Light"
                      icon={<Sun className="h-3 w-3" />}
                      active={
                        mounted && mode === "serious" && theme === "light"
                      }
                      onClick={() => {
                        setModeAndPersist("serious");
                        setTheme("light");
                      }}
                    />
                    <ThemeCard
                      theme="dark"
                      label="Dark"
                      icon={<Moon className="h-3 w-3" />}
                      active={mounted && mode === "serious" && theme === "dark"}
                      onClick={() => {
                        setModeAndPersist("serious");
                        setTheme("dark");
                      }}
                    />
                    <ThemeCard
                      theme="system"
                      label="System"
                      icon={<Monitor className="h-3 w-3" />}
                      active={
                        mounted && mode === "serious" && theme === "system"
                      }
                      onClick={() => {
                        setModeAndPersist("serious");
                        setTheme("system");
                      }}
                    />
                    <ThemeCard
                      theme="fun"
                      label="Fun"
                      icon={null}
                      active={mounted && mode === "fun"}
                      onClick={() => {
                        setTheme("light");
                        setModeAndPersist("fun");
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Fun is rolling out — some surfaces still show the standard
                    chrome. Light only.
                  </p>
                </Card>

                <SectionHeader>Date & Time</SectionHeader>
                <Card className="p-4 space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                      <Globe className="h-3 w-3" />
                      Timezone
                    </Label>
                    <TimezonePicker
                      value={localTimezone ?? settings.timezone}
                      onChange={handleTimezoneChange}
                      size="sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1.5">
                      All times in dashboards and charts will be displayed in
                      this timezone.
                    </p>
                  </div>

                  <div className="border-t pt-4">
                    <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      Time Format
                    </Label>
                    <TimeFormatToggle
                      value={localTimeFormat ?? settings.use12HourFormat}
                      onChange={handleTimeFormatChange}
                    />
                  </div>
                </Card>

                {isStaff && (
                  <>
                    <SectionHeader>Internal</SectionHeader>
                    <Card className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-yellow-500/10">
                            <Shield className="h-5 w-5 text-yellow-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Plexus Admin</p>
                            <p className="text-xs text-muted-foreground">
                              Manage feature flags and overrides for any
                              organization.
                            </p>
                          </div>
                        </div>
                        <Link href="/internal">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                          >
                            Open Admin
                            <ArrowRight className="h-3 w-3 ml-1.5" />
                          </Button>
                        </Link>
                      </div>
                    </Card>
                  </>
                )}
              </>
            )}

            {activeTab === "members" && <MembersSettings />}

            {activeTab === "access" && <GroupsSettings />}

            {activeTab === "billing" && <SubscriptionTab />}

            {activeTab === "data" && <DataManagementSettings />}
          </div>
        </div>
      </div>
      <SaveBar {...saveBarProps} />

      <AlertDialog open={leaveConfirm.isOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes that will be lost. Are you sure you want
              to leave?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={leaveConfirm.onStay}>
              Stay
            </AlertDialogCancel>
            <AlertDialogAction onClick={leaveConfirm.onLeave}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageWrapper>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <PageWrapper title="Settings" description="Manage your settings">
          <div className="flex flex-col h-full">
            <div className="border-b border-border px-4 h-10" />
            <div className="flex-1 flex items-center justify-center">
              <Spinner />
            </div>
          </div>
        </PageWrapper>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}
