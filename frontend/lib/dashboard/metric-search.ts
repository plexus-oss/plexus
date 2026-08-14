/**
 * Pure helpers for the signal rail's metric list: space-tokenized
 * all-terms-must-match search, and middle truncation for long metric paths
 * (both ends of a path like `sensor_combined.gyro_rad[0]` carry meaning).
 */

/** Split a query into lowercase whitespace-separated tokens. */
export function tokenizeQuery(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * True when every token appears somewhere in `haystack` (case-insensitive).
 * "gyro 0" matches "sensor_combined.gyro_rad[0]". An empty token list
 * matches everything (no filter).
 */
export function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const h = haystack.toLowerCase();
  return tokens.every((t) => h.includes(t));
}

/**
 * Truncate the MIDDLE of a string with an ellipsis, keeping both ends.
 * Tail gets slightly more room than the head — the discriminating part of a
 * metric path (field name, array index) is usually at the end.
 */
export function truncateMiddle(s: string, max: number): string {
  if (max < 5 || s.length <= max) return s;
  const keep = max - 1; // room for the ellipsis
  const head = Math.ceil(keep / 2) - 1;
  const tail = keep - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}
