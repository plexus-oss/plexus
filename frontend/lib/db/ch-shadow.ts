/**
 * ClickHouse row-policy SHADOW audit.
 *
 * The row-policy backstop (see clickhouse.ts + clickhouse/server/schema.sql)
 * fails CLOSED: once the policies are applied, any org-scoped read that reaches
 * ClickHouse as `nextjs_reader` WITHOUT the `plexus_org_id` setting stamped
 * returns ZERO rows. Cross-org reads that should use `getGlobalReadClient()`
 * (nextjs_global) but still ride `nextjs_reader` would likewise blank to one org.
 *
 * Before enforcing (PLEXUS_CH_ROW_POLICY=1) we run this shadow pass to prove no
 * legitimate read would blank. It NEVER alters a query or its result and NEVER
 * throws into the caller — it only observes and emits a structured line per read
 * so a 48h prod sample can be grepped (`[ch-shadow]`) for RISK records. Expected
 * clean result: zero RISK lines.
 *
 * Gated entirely OFF unless PLEXUS_CH_ROW_POLICY_SHADOW=1, independent of the
 * enforcement flag. Default: pure no-op, unused by customers.
 */

import type { ClickHouseClient } from "@clickhouse/client";

/** Read the flag at call time (not a captured const) so it's togglable + testable. */
export function isChShadowEnabled(): boolean {
  return process.env.PLEXUS_CH_ROW_POLICY_SHADOW === "1";
}

/** Tenant tables the row policies attach to — a read here is org-scoped data. */
const TENANT_TABLE_RE =
  /\b(telemetry|telemetry_1min|telemetry_1hr|events|video_sessions)(_dist)?\b/i;

/** Only SELECT/WITH reads are subject to row policies; DDL/DESCRIBE/SYSTEM aren't. */
const READ_STMT_RE = /^\s*(with|select)\b/i;

/** How a client was obtained, which determines policy exposure once enforcing. */
export type ReadKind =
  | "org-scoped" // getClient(orgId): setting stamped → policy passes it. SAFE.
  | "global" //     getGlobalReadClient(): nextjs_global bypasses policy. SAFE.
  | "unscoped"; //  getClient() with no orgId: no setting → tenant read BLANKS. RISK.

export interface ShadowVerdict {
  risk: boolean;
  kind: ReadKind;
  tenantTable: string | null;
  reason: string;
}

/**
 * Decide whether a read would break once the row policy enforces. RISK only when
 * an UNSCOPED read touches a tenant table (it would return zero rows). Org-scoped
 * and global reads are safe by construction; non-tenant/non-read statements are
 * irrelevant to the policy.
 */
export function classifyRead(sql: string, kind: ReadKind): ShadowVerdict {
  const table = TENANT_TABLE_RE.exec(sql)?.[0] ?? null;
  const isRead = READ_STMT_RE.test(sql);

  if (!table || !isRead) {
    return { risk: false, kind, tenantTable: table, reason: "not-a-tenant-read" };
  }
  if (kind === "unscoped") {
    return {
      risk: true,
      kind,
      tenantTable: table,
      reason: "tenant read via bare getClient() — would blank under policy; pass orgId or use getGlobalReadClient()",
    };
  }
  return { risk: false, kind, tenantTable: table, reason: "scoped" };
}

/** First app frame above this module, to locate the offending call site. */
function callSite(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(1);
  for (const line of lines) {
    if (
      !line.includes("ch-shadow") &&
      !line.includes("clickhouse.ts") &&
      /\/(app|lib|components|hooks)\//.test(line)
    ) {
      return line.trim().replace(/^at\s+/, "");
    }
  }
  return "unknown";
}

function emit(verdict: ShadowVerdict, sql: string): void {
  const record = {
    risk: verdict.risk,
    kind: verdict.kind,
    table: verdict.tenantTable,
    reason: verdict.reason,
    site: verdict.risk ? callSite() : undefined,
    sql: verdict.risk ? sql.slice(0, 160) : undefined,
  };
  // WARN for risks (grep-able, alerting-friendly); risks are what block the flip.
  if (verdict.risk) console.warn(`[ch-shadow] ${JSON.stringify(record)}`);
  else if (verdict.tenantTable)
    // Sampled INFO so the log isn't flooded by healthy scoped reads.
    console.info(`[ch-shadow] ${JSON.stringify(record)}`);
}

/**
 * Wrap a read client so every query/command/exec is classified and recorded
 * before it runs. Pure pass-through: the original call is invoked unchanged, and
 * any instrumentation error is swallowed so a read can never fail because of the
 * shadow audit.
 */
export function withShadowAudit(
  client: ClickHouseClient,
  kind: ReadKind,
): ClickHouseClient {
  if (!isChShadowEnabled()) return client;
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query" || prop === "command" || prop === "exec") {
        const orig = Reflect.get(target, prop, receiver) as (
          params: Record<string, unknown>,
        ) => unknown;
        return (params: Record<string, unknown>) => {
          try {
            const sql = typeof params?.query === "string" ? params.query : "";
            if (sql) emit(classifyRead(sql, kind), sql);
          } catch {
            // Never let auditing interfere with the read.
          }
          return orig.call(target, params);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
