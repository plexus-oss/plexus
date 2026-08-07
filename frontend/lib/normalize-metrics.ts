/**
 * Deduplicate and sort a metrics array. Collapses double-prefixed names of
 * the form "source:source:metric" → "source:metric" that arise when callers
 * pre-qualify metrics that are already qualified.
 */
export function normalizeMetrics(metrics: string[] | undefined | null): string[] {
  if (!metrics || !Array.isArray(metrics)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const m of metrics) {
    const colonIdx = m.indexOf(":");
    if (colonIdx === -1) {
      if (!seen.has(m)) { seen.add(m); result.push(m); }
      continue;
    }

    const secondColonIdx = m.indexOf(":", colonIdx + 1);
    if (secondColonIdx !== -1) {
      const firstPart = m.substring(0, colonIdx);
      const secondPart = m.substring(colonIdx + 1, secondColonIdx);
      if (firstPart === secondPart) {
        const normalized = firstPart + m.substring(secondColonIdx);
        if (!seen.has(normalized)) { seen.add(normalized); result.push(normalized); }
        continue;
      }
    }

    if (!seen.has(m)) { seen.add(m); result.push(m); }
  }

  return result.sort();
}
