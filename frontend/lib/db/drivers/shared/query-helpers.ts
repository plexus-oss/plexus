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
