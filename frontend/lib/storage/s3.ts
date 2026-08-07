/**
 * Tigris (S3-compatible) object storage — server-only.
 *
 * Replaces Supabase Storage. Tigris is Fly's S3-compatible blob store; it's
 * already the backend for recordings (the recorder service presigns those).
 * Here the Next server talks to it directly via the AWS SDK with credentials
 * held in Fly secrets — consistent with the other server-side secrets the
 * route handlers already use (DATABASE_URL, AUTH_SECRET, …).
 *
 * Two buckets:
 *   - ICONS_BUCKET   — dashboard icon images, public-read (served via publicUrl).
 *   - CONTEXT_BUCKET — source-context files, private (served via presignGetUrl).
 */

import "server-only";

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { globalSingleton } from "@/lib/global-singleton";

// S3 API endpoint — used for ALL signed SDK operations (put/delete/presign).
// These endpoints require signed requests even for public buckets.
const TIGRIS_ENDPOINT =
  process.env.TIGRIS_ENDPOINT || "https://fly.storage.tigris.dev";

// Anonymous public serving uses a DIFFERENT, dedicated domain — the S3 endpoints
// above reject unsigned requests. Tigris public virtual-host form is
// `<bucket>.t3.tigrisbucket.io/<key>` (aliases: t3.tigrisfiles.io / t3.tigrisblob.io).
const TIGRIS_PUBLIC_HOST =
  process.env.TIGRIS_PUBLIC_HOST || "t3.tigrisbucket.io";

/** Public-read bucket for the dashboard icon library. */
export const ICONS_BUCKET =
  process.env.TIGRIS_BUCKET_ICONS || "dashboard-icons";
/** Private bucket for source-context files (downloads via signed URL). */
export const CONTEXT_BUCKET =
  process.env.TIGRIS_BUCKET_CONTEXT || "source-context";

/** True when Tigris credentials are present — gates upload routes (503 if not). */
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.TIGRIS_ACCESS_KEY_ID && process.env.TIGRIS_SECRET_ACCESS_KEY,
  );
}

// HMR-safe singleton (Next reloads modules in dev; one client per process).
export function getS3Client(): S3Client {
  return globalSingleton(
    "tigrisS3",
    () =>
      new S3Client({
        endpoint: TIGRIS_ENDPOINT,
        region: process.env.TIGRIS_REGION || "auto",
        credentials: {
          accessKeyId: process.env.TIGRIS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.TIGRIS_SECRET_ACCESS_KEY!,
        },
        // Tigris uses virtual-host-style addressing (bucket.fly.storage.tigris.dev).
        forcePathStyle: false,
      }),
  );
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}

/** Short-lived presigned GET URL for a private object. */
export function presignGetUrl(
  bucket: string,
  key: string,
  ttlSec = 3600,
): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSec },
  );
}

/**
 * Anonymous public URL for an object in a public-read bucket. Uses the public
 * serving domain (NOT the S3 endpoint, which requires signed requests).
 */
export function publicUrl(bucket: string, key: string): string {
  return `https://${bucket}.${TIGRIS_PUBLIC_HOST}/${key}`;
}
