/**
 * CSV Import Parser
 *
 * Parses CSV data and maps columns to telemetry fields.
 */

import Papa from "papaparse";

export interface ColumnMapping {
  timestamp: string;
  metric?: string;
  value: string;
  source_id?: string;
  tags?: string[];
}

export interface ParsedRow {
  metric: string;
  value: number;
  timestamp: number;
  source_id: string;
  tags?: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
  totalParsed: number;
}

/**
 * Parse CSV text and map columns to telemetry fields.
 */
export function parseCSV(
  csvText: string,
  mapping: ColumnMapping,
  defaults: {
    staticSourceId?: string;
    staticMetric?: string;
  } = {},
): ParseResult {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i] as Record<string, unknown>;

    // Timestamp
    const tsRaw = row[mapping.timestamp];
    if (tsRaw == null) {
      errors.push(`Row ${i + 1}: missing timestamp`);
      continue;
    }
    let ts: number;
    if (typeof tsRaw === "number") {
      ts = tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
    } else {
      ts = new Date(String(tsRaw)).getTime();
      if (isNaN(ts)) {
        errors.push(`Row ${i + 1}: invalid timestamp "${tsRaw}"`);
        continue;
      }
    }

    // Value
    const valRaw = row[mapping.value];
    const value = Number(valRaw);
    if (isNaN(value)) {
      errors.push(`Row ${i + 1}: invalid value "${valRaw}"`);
      continue;
    }

    // Metric
    const metric = mapping.metric
      ? String(row[mapping.metric] ?? defaults.staticMetric ?? "unknown")
      : (defaults.staticMetric ?? "unknown");

    // Source ID
    const sourceId = mapping.source_id
      ? String(row[mapping.source_id] ?? defaults.staticSourceId ?? "imported")
      : (defaults.staticSourceId ?? "imported");

    // Tags
    let tags: Record<string, string> | undefined;
    if (mapping.tags && mapping.tags.length > 0) {
      tags = {};
      for (const tagCol of mapping.tags) {
        if (row[tagCol] != null) {
          tags[tagCol] = String(row[tagCol]);
        }
      }
    }

    rows.push({ metric, value, timestamp: ts, source_id: sourceId, tags });
  }

  return {
    rows,
    errors: errors.slice(0, 100), // Cap error messages
    totalParsed: parsed.data.length,
  };
}

/**
 * Get column names from CSV header.
 */
export function getCSVColumns(csvText: string): string[] {
  const parsed = Papa.parse(csvText, {
    header: true,
    preview: 1,
  });
  return parsed.meta.fields || [];
}

/**
 * Preview first N rows of CSV.
 */
export function previewCSV(
  csvText: string,
  maxRows = 100,
): { columns: string[]; rows: Record<string, unknown>[] } {
  const parsed = Papa.parse(csvText, {
    header: true,
    preview: maxRows,
    dynamicTyping: true,
  });

  return {
    columns: parsed.meta.fields || [],
    rows: parsed.data as Record<string, unknown>[],
  };
}
