import {
  LayoutDashboard,
  Database,
  AlertTriangle,
  Pencil,
  Copy,
  Share2,
  ExternalLink,
  Trash2,
  Wifi,
  Eye,
  Zap,
  Check,
  UserMinus,
  FileText,
  Boxes,
  Tag,
  type LucideIcon,
} from "lucide-react";

export const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Database,
  AlertTriangle,
  Pencil,
  Copy,
  Share2,
  ExternalLink,
  Trash2,
  Wifi,
  Eye,
  Zap,
  Check,
  UserMinus,
  FileText,
  Boxes,
  Tag,
};

export function resolveIcon(name: string): LucideIcon | undefined {
  return ICON_MAP[name];
}
