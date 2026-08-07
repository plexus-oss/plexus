/**
 * Storage helpers for the dashboard icon library.
 *
 * Icon images live in the public Tigris bucket `dashboard-icons` (see
 * lib/storage/s3.ts). Library uploads are stored at `{orgId}/library/{uuid}.{ext}`
 * and tracked in the `dashboard_icon_assets` table so they can be reused across
 * dashboards. (Legacy one-off uploads at `{orgId}/{dashboardId}/...` still
 * resolve via their public URLs but are not part of the library.)
 */

import { ICONS_BUCKET, isStorageConfigured } from "./s3";

export const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB — these are icons, not photos
export const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
export const BUCKET_NAME = ICONS_BUCKET;

export { isStorageConfigured };

// Returns an error message, or null when the file is acceptable.
export function validateIconFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return "File too large (max 2MB)";
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return "Unsupported file type (use PNG, JPEG, WebP, or SVG)";
  }
  return null;
}

export function deriveExtension(file: File): string {
  return file.name.includes(".") && file.name.split(".").pop()
    ? file.name.split(".").pop()!.toLowerCase()
    : file.type.split("/")[1] || "bin";
}
