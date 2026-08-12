export const DEFAULT_QUERY_LIMIT = 1000;
export const MAX_QUERY_LIMIT = 10000;
export const DEFAULT_QUERY_TIMEOUT = 30000;

export function validateReadOnlyQuery(query: string): { valid: boolean; error?: string } {
  const trimmed = query.trim().toUpperCase();

  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    return { valid: false, error: "Only SELECT queries are allowed" };
  }

  const dangerousPatterns = [
    /\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /\bDROP\b/i,
    /\bCREATE\b/i, /\bALTER\b/i, /\bTRUNCATE\b/i, /\bGRANT\b/i,
    /\bREVOKE\b/i, /\bEXEC\b/i, /\bEXECUTE\b/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(query)) {
      return {
        valid: false,
        error: `Query contains forbidden keyword: ${pattern.source.replace(/\\b/g, "")}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Strip SQL comments and string literals so keyword/identifier checks can't be
 * evaded by hiding tokens inside `'...'`, `` `...` ``, `--`, or block comments.
 * Quoted spans are replaced with a single space (not removed) so token
 * boundaries around them are preserved.
 */
function stripSqlNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/'(?:[^'\\]|\\.|'')*'/g, " ") // single-quoted string literals
    .replace(/`(?:[^`]|``)*`/g, " ") // backtick-quoted identifiers
    .replace(/"(?:[^"\\]|\\.|"")*"/g, " "); // double-quoted identifiers
}

// ClickHouse table/dictionary functions that read data outside the caller's
// org-scoped CTE — cross-tenant reads (`merge`, `cluster`, `view`) or outright
// SSRF / remote fetch (`url`, `s3`, `remote`, `file`, external DB engines).
// These have no legitimate use in the customer-facing telemetry query console.
const CH_FORBIDDEN_FUNCTIONS = [
  "merge", "remote", "remotesecure", "cluster", "clusterallreplicas",
  "url", "urlcluster", "s3", "s3cluster", "gcs", "file", "hdfs", "hdfscluster",
  "mysql", "postgresql", "mongodb", "jdbc", "odbc", "redis", "sqlite",
  "azureblobstorage", "deltalake", "hudi", "iceberg", "input",
  "view", "viewifpermitted", "dictionary", "executable",
];

/**
 * Strict guard for the INTERNAL ClickHouse telemetry query console
 * (`/api/telemetry/connection/query`). That route wraps the user's SQL in an
 * org-scoped CTE that shadows the unqualified `telemetry` table — but the CTE
 * only shadows the *bare* identifier. This guard closes the two ways to read
 * around it: (1) ClickHouse table functions like `merge('plexus','^telemetry$')`
 * or `url(...)`, and (2) schema-qualified table references like `plexus.events`
 * or `system.tables`. The only legitimate FROM/JOIN target here is the
 * unqualified, CTE-shadowed `telemetry`. Call this IN ADDITION to
 * `validateReadOnlyQuery`. Defense-in-depth only — the durable fix is a
 * least-privilege ClickHouse user (SELECT on plexus.telemetry only, table
 * functions revoked); see clickhouse/server/schema.sql.
 */
export function validateInternalTelemetryQuery(query: string): { valid: boolean; error?: string } {
  const sql = stripSqlNoise(query);

  // 1. No schema-qualified table sources: `FROM db.table`, `JOIN db.table`.
  //    (Column refs like `alias.col` are never preceded by FROM/JOIN, so they
  //    are unaffected.) This blocks plexus.events, system.*, information_schema.*.
  const qualifiedSource = /\b(?:FROM|JOIN)\s+["`]?[A-Za-z_]\w*["`]?\s*\.\s*["`]?[A-Za-z_]\w*/i;
  if (qualifiedSource.test(sql)) {
    return {
      valid: false,
      error:
        "Schema-qualified table references are not allowed — query the unqualified 'telemetry' table only.",
    };
  }

  // 2. No dangerous ClickHouse table/dictionary functions anywhere.
  for (const fn of CH_FORBIDDEN_FUNCTIONS) {
    // function name followed by an opening paren (optional whitespace)
    const re = new RegExp(`\\b${fn}\\s*\\(`, "i");
    if (re.test(sql)) {
      return { valid: false, error: `Query uses a forbidden table function: ${fn}()` };
    }
  }

  // 3. Belt-and-suspenders: the `system` database is never reachable here.
  if (/\bsystem\s*\./i.test(sql)) {
    return { valid: false, error: "Access to the system database is not allowed." };
  }

  // 4. No query-level SETTINGS. The row-policy backstop injects the tenant's
  //    `plexus_org_id` as a request-level setting; a query-level `SETTINGS`
  //    clause would override it (or relax readonly/limits), so forbid it here.
  if (/\bSETTINGS\b/i.test(sql)) {
    return { valid: false, error: "A SETTINGS clause is not allowed in this query." };
  }

  return { valid: true };
}
