/**
 * Connection Health Check Cron
 *
 * External cron (every 5 min) that pings all connection sources across all orgs.
 * Also performs schema drift detection by comparing against previous snapshots.
 * The app deploys to Fly (not Vercel), so the schedule is driven by an external
 * cron runner rather than Vercel Cron.
 *
 * POST /api/cron/check-connections
 * Auth: CRON_SECRET bearer header
 */

import { NextRequest, NextResponse } from "next/server";
import { adminSourceQueries } from "@/lib/db/server";
import { decrypt } from "@/lib/encryption";
import {
  testConnection,
  getSchema,
  diffSchema,
} from "@/lib/db/data-source-connections";
import type { SchemaInfo } from "@/lib/db/data-source-connections";
import type { DataSourceType } from "@/lib/db/types";

export const maxDuration = 60; // Allow up to 60s for checking many connections
export const dynamic = "force-dynamic";

const CONCURRENCY_LIMIT = 5;

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = {
    checked: 0,
    online: 0,
    errors: 0,
    schemaDrifts: 0,
  };

  try {
    const connections = await adminSourceQueries.findAllConnections();

    await processInBatches(connections, CONCURRENCY_LIMIT, async (source) => {
      results.checked++;

      try {
        if (!source.credentials_encrypted || !source.connection_type) {
          return;
        }

        const connectionString = decrypt(source.credentials_encrypted);
        const connectionType = source.connection_type as DataSourceType;
        const existingConfig = (source.config as Record<string, unknown>) || {};

        // Step 1: Test connection health
        const testResult = await testConnection({
          type: connectionType,
          connectionString,
          existingConfig,
        });

        if (!testResult.success) {
          results.errors++;
          await adminSourceQueries.setError(
            source.id,
            testResult.error || "Connection failed"
          );
          return;
        }

        results.online++;

        // Step 2: Schema drift detection
        // Only fetch the full schema when there's a reason to (table count
        // changed, no previous snapshot, or enough time has elapsed).
        // This avoids hammering user DBs with expensive information_schema
        // queries every 5 minutes.
        let schemaConfig: Record<string, unknown> = {};
        try {
          const previousSnapshot = existingConfig.schemaSnapshot as
            | SchemaInfo
            | undefined;
          const lastChecked = existingConfig.schemaCheckedAt as string | undefined;

          const previousTableCount = previousSnapshot?.tables?.length ?? -1;
          const currentTableCount = testResult.metadata?.tables ?? -1;
          const tableCountChanged = previousTableCount !== currentTableCount;

          // Re-fetch schema if: no snapshot yet, table count changed,
          // or it's been more than 30 minutes since last check
          const staleThresholdMs = 30 * 60 * 1000; // 30 minutes
          const isStale = !lastChecked ||
            Date.now() - new Date(lastChecked).getTime() > staleThresholdMs;

          if (!previousSnapshot || tableCountChanged || isStale) {
            const currentSchema = await getSchema({
              type: connectionType,
              connectionString,
              existingConfig,
            });

            // Compute drift if we have a previous snapshot
            let drift = null;
            if (previousSnapshot) {
              drift = diffSchema(previousSnapshot, currentSchema);
              if (drift) {
                results.schemaDrifts++;
              }
            }

            schemaConfig = {
              schemaSnapshot: currentSchema,
              schemaCheckedAt: new Date().toISOString(),
              ...(drift !== undefined && { schemaDrift: drift }),
            };
          }
        } catch (schemaError) {
          // Schema fetch failed — not critical, still mark connection as online
          console.warn(
            `[check-connections] Schema fetch failed for ${source.id}:`,
            schemaError
          );
        }

        await adminSourceQueries.updateLastConnected(source.id, schemaConfig);
      } catch (error) {
        results.errors++;
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error(
          `[check-connections] Error checking ${source.id}:`,
          message
        );
        try {
          await adminSourceQueries.setError(source.id, message);
        } catch {
          // If we can't even update the error status, just log it
          console.error(
            `[check-connections] Failed to set error status for ${source.id}`
          );
        }
      }
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("[check-connections] Fatal error:", error);
    return NextResponse.json(
      {
        error: "Health check failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
