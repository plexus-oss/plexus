"use client";

import { createElement, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast-utils";
import { Upload, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useOrgIconsSwr } from "@/hooks/use-org-icons-swr";
import {
  LayoutDashboard,
  Activity,
  Heart,
  HeartPulse,
  Thermometer,
  Wind,
  Droplets,
  Battery,
  Wifi,
  Gauge,
  Timer,
  MapPin,
  Building2,
  Building,
  Home,
  Factory,
  Hospital,
  Stethoscope,
  Pill,
  Syringe,
  BedDouble,
  User,
  Users,
  UserCog,
  Settings,
  Cog,
  Wrench,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  XCircle,
  Info,
  Bell,
  BellRing,
  Zap,
  Flame,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  TrendingDown,
  BarChart3,
  LineChart,
  PieChart,
  Cpu,
  HardDrive,
  Server,
  Database,
  Network,
  Radio,
  Satellite,
  Plane,
  Car,
  Truck,
  Ship,
  Rocket,
  Atom,
  Microscope,
  FlaskConical,
  Beaker,
  type LucideIcon,
} from "lucide-react";

interface IconPickerProps {
  value: string | null;
  onChange: (icon: string | null) => void;
  size?: "sm" | "md" | "lg";
  // Custom-logo support. When onUploadChange is provided, an "Upload" tab
  // shows the org's image library; new uploads are saved to it for reuse.
  // The picker only reports the chosen URL — persisting it is the caller's job.
  iconUrl?: string | null;
  onUploadChange?: (iconUrl: string | null) => void;
}

// Map of Lucide icon names to components
const LUCIDE_ICONS: Record<string, LucideIcon> = {
  // Dashboard & Charts
  LayoutDashboard,
  Activity,
  BarChart3,
  LineChart,
  PieChart,
  TrendingUp,
  TrendingDown,
  Gauge,
  Target,
  // Medical
  Heart,
  HeartPulse,
  Thermometer,
  Stethoscope,
  Pill,
  Syringe,
  Hospital,
  BedDouble,
  // Sensors & Monitoring
  Wind,
  Droplets,
  Battery,
  Wifi,
  Timer,
  MapPin,
  Radio,
  Satellite,
  // Buildings & Locations
  Building2,
  Building,
  Home,
  Factory,
  // People
  User,
  Users,
  UserCog,
  // Tech & Equipment
  Settings,
  Cog,
  Wrench,
  Cpu,
  HardDrive,
  Server,
  Database,
  Network,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  XCircle,
  Info,
  Bell,
  BellRing,
  // Energy & Effects
  Zap,
  Flame,
  Sparkles,
  Star,
  // Vehicles
  Plane,
  Car,
  Truck,
  Ship,
  Rocket,
  // Science
  Atom,
  Microscope,
  FlaskConical,
  Beaker,
};

// Check if a string is a Lucide icon name
function isLucideIcon(icon: string): boolean {
  return icon in LUCIDE_ICONS;
}

// Get the Lucide icon component by name
function getLucideIcon(name: string): LucideIcon | null {
  return LUCIDE_ICONS[name] || null;
}

// Module-scope renderer for a Lucide icon resolved by name. Keeps the dynamic
// component lookup out of consumer render bodies (react-hooks/static-components).
function LucideGlyph({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = getLucideIcon(name);
  // createElement (not JSX) for the dynamic, name-resolved icon so the compiler
  // doesn't read it as a component declared during render.
  return Icon ? createElement(Icon, { className }) : null;
}

// Curated Lucide icon categories for picker
const LUCIDE_CATEGORIES = [
  {
    name: "Dashboard",
    icons: [
      "LayoutDashboard",
      "Activity",
      "BarChart3",
      "LineChart",
      "Gauge",
      "Target",
      "TrendingUp",
    ],
  },
  {
    name: "Medical",
    icons: [
      "HeartPulse",
      "Heart",
      "Thermometer",
      "Stethoscope",
      "Hospital",
      "BedDouble",
      "Pill",
    ],
  },
  {
    name: "Monitoring",
    icons: ["Wifi", "Radio", "Satellite", "Battery", "Timer", "MapPin", "Wind"],
  },
  {
    name: "Buildings",
    icons: ["Building2", "Building", "Home", "Factory", "Hospital"],
  },
  {
    name: "Status",
    icons: [
      "CheckCircle",
      "AlertTriangle",
      "AlertCircle",
      "XCircle",
      "Bell",
      "Info",
    ],
  },
  {
    name: "Tech",
    icons: ["Cpu", "Server", "Database", "Network", "Settings", "Cog"],
  },
];

// Curated emoji categories for dashboards
const EMOJI_CATEGORIES = [
  {
    name: "Common",
    icons: ["📊", "📈", "📉", "🎯", "⚡", "🔥", "✨", "💡", "🚀", "⭐"],
  },
  {
    name: "Devices",
    icons: ["🤖", "🛸", "🚁", "✈️", "🛰️", "📡", "🔬", "🔧", "⚙️", "🔩"],
  },
  {
    name: "Sensors",
    icons: ["🌡️", "💨", "💧", "🔋", "📶", "🧭", "⏱️", "📍", "🎚️", "🎛️"],
  },
  {
    name: "Status",
    icons: ["✅", "⚠️", "❌", "🔴", "🟢", "🟡", "🔵", "⏸️", "▶️", "🔄"],
  },
  {
    name: "Categories",
    icons: ["📁", "📂", "🏠", "🏭", "🏢", "🌐", "🗺️", "📋", "📝", "🗂️"],
  },
];

const SIZE_CLASSES = {
  sm: "h-6 w-6 text-sm",
  md: "h-8 w-8 text-base",
  lg: "h-10 w-10 text-lg",
};

export function IconPicker({
  value,
  onChange,
  size = "md",
  iconUrl,
  onUploadChange,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const uploadEnabled = !!onUploadChange;
  const [tab, setTab] = useState<"lucide" | "emoji" | "upload">("lucide");
  const [isUploading, setIsUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    icons: libraryIcons,
    isLoading: isLibraryLoading,
    uploadIcon,
    deleteIcon,
  } = useOrgIconsSwr(uploadEnabled && open);

  const handleSelect = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file || !onUploadChange) return;

    setIsUploading(true);
    try {
      const asset = await uploadIcon(file);
      onUploadChange(asset.url);
      toast.success("Logo uploaded");
    } catch {
      // uploadIcon already surfaced the error via toast
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectLibraryIcon = (url: string) => {
    onUploadChange?.(url);
    setOpen(false);
  };

  // Clears the logo from this dashboard only; the image stays in the library.
  const handleRemoveUpload = () => {
    onUploadChange?.(null);
  };

  // Two-step delete: first click arms the confirm, second click deletes the
  // image from the org library (and from every dashboard using it).
  const handleDeleteLibraryIcon = async (asset: { id: string; url: string }) => {
    if (confirmDeleteId !== asset.id) {
      setConfirmDeleteId(asset.id);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteIcon(asset.id);
      if (iconUrl === asset.url) {
        onUploadChange?.(null);
      }
    } catch {
      // deleteIcon already surfaced the error via toast
    }
  };

  // Render the current value: uploaded logo wins, else Lucide/emoji, else default.
  const renderCurrentValue = () => {
    if (iconUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          className="h-4 w-4 object-contain rounded-sm"
        />
      );
    }
    if (!value) {
      return <LayoutDashboard className="h-4 w-4 text-muted-foreground" />;
    }
    if (isLucideIcon(value)) {
      const IconComponent = getLucideIcon(value);
      if (IconComponent) {
        return <IconComponent className="h-4 w-4" />;
      }
    }
    return <span className="text-inherit">{value}</span>;
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmDeleteId(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={`${SIZE_CLASSES[size]} p-0 hover:bg-muted`}
        >
          {renderCurrentValue()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="space-y-3">
          {/* Tab switcher */}
          <div className="flex gap-1 p-1 bg-muted rounded-md">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTab("lucide")}
              className={`flex-1 px-2 py-1 text-xs h-auto ${
                tab === "lucide"
                  ? "bg-background shadow-sm"
                  : "hover:bg-background/50"
              }`}
            >
              Icons
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTab("emoji")}
              className={`flex-1 px-2 py-1 text-xs h-auto ${
                tab === "emoji"
                  ? "bg-background shadow-sm"
                  : "hover:bg-background/50"
              }`}
            >
              Emoji
            </Button>
            {uploadEnabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTab("upload")}
                className={`flex-1 px-2 py-1 text-xs h-auto ${
                  tab === "upload"
                    ? "bg-background shadow-sm"
                    : "hover:bg-background/50"
                }`}
              >
                Upload
              </Button>
            )}
          </div>

          {/* Lucide icons tab */}
          {tab === "lucide" && (
            <div className="space-y-3">
              {LUCIDE_CATEGORIES.map((category) => (
                <div key={category.name}>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 px-1">
                    {category.name}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5">
                    {category.icons.map((iconName) => {
                      const IconComponent = getLucideIcon(iconName);
                      if (!IconComponent) return null;
                      return (
                        <Button
                          key={iconName}
                          variant="ghost"
                          size="icon"
                          onClick={() => handleSelect(iconName)}
                          className={`h-8 w-8 ${
                            value === iconName
                              ? "bg-muted ring-1 ring-foreground/20"
                              : ""
                          }`}
                          title={iconName}
                        >
                          <IconComponent className="h-4 w-4" />
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Emoji tab */}
          {tab === "emoji" && (
            <div className="space-y-3">
              {EMOJI_CATEGORIES.map((category) => (
                <div key={category.name}>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 px-1">
                    {category.name}
                  </div>
                  <div className="grid grid-cols-10 gap-0.5">
                    {category.icons.map((icon) => (
                      <Button
                        key={icon}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleSelect(icon)}
                        className={`h-7 w-7 ${
                          value === icon
                            ? "bg-muted ring-1 ring-foreground/20"
                            : ""
                        }`}
                      >
                        {icon}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Upload tab — the org's reusable image library */}
          {tab === "upload" && uploadEnabled && (
            <div className="space-y-3">
              {isLibraryLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Spinner className="h-4 w-4" />
                </div>
              ) : libraryIcons.length > 0 ? (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 px-1">
                    Your images
                  </div>
                  <div className="grid grid-cols-5 gap-0.5">
                    {libraryIcons.map((asset) => (
                      <div key={asset.id} className="relative group">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleSelectLibraryIcon(asset.url)}
                          className={`h-10 w-10 ${
                            iconUrl === asset.url
                              ? "bg-muted ring-1 ring-foreground/20"
                              : ""
                          }`}
                          title={asset.file_name || "Uploaded image"}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={asset.url}
                            alt={asset.file_name || ""}
                            className="h-6 w-6 object-contain rounded-sm"
                          />
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLibraryIcon(asset)}
                          className={`absolute -top-1 -right-1 rounded-full p-0.5 shadow-sm ${
                            confirmDeleteId === asset.id
                              ? "flex bg-destructive text-white"
                              : "hidden group-hover:flex bg-muted text-muted-foreground hover:text-destructive"
                          }`}
                          title={
                            confirmDeleteId === asset.id
                              ? "Click again to delete from all dashboards"
                              : "Delete from library"
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground text-center py-3">
                  No images yet. Uploads are saved to your organization for
                  reuse on other dashboards.
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full text-xs flex flex-col gap-1 h-auto py-2"
              >
                {isUploading ? (
                  <Spinner variant="button" className="h-4 w-4" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span>Upload an image</span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  PNG, JPEG, WebP, or SVG · max 2MB
                </span>
              </Button>
              {iconUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveUpload}
                  className="w-full text-xs text-muted-foreground"
                >
                  Remove logo from this dashboard
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleFileSelected}
              />
              <p className="text-[10px] text-muted-foreground px-1">
                A custom logo overrides the icon or emoji selected on other
                tabs. Deleting an image removes it from all dashboards using
                it.
              </p>
            </div>
          )}

          {value && tab !== "upload" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="w-full text-xs text-muted-foreground"
            >
              Remove icon
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Simple display component for showing icon or fallback.
// Resolution priority: iconUrl (uploaded logo) > icon (Lucide name or emoji) > default.
export function DashboardIcon({
  icon,
  iconUrl,
  size = "md",
  className = "",
}: {
  icon?: string | null;
  iconUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const emojiSizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  // Uploaded custom logo wins over Lucide/emoji.
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        className={`${iconSizes[size]} object-contain rounded-sm ${className}`}
      />
    );
  }

  // No icon - show default
  if (!icon) {
    return (
      <LayoutDashboard
        className={`${iconSizes[size]} text-muted-foreground ${className}`}
      />
    );
  }

  // Check if it's a Lucide icon name
  if (isLucideIcon(icon)) {
    return <LucideGlyph name={icon} className={`${iconSizes[size]} ${className}`} />;
  }

  // Otherwise render as emoji/text
  return <span className={`${emojiSizes[size]} ${className}`}>{icon}</span>;
}

// Export the helper functions for external use
export { isLucideIcon, getLucideIcon, LUCIDE_ICONS };
