/**
 * Shared types for editable table components
 */

export interface EditingCell {
  rowId: string;
  column: string;
}

export interface DataRow {
  id: string;
  timestamp: string;
  time: string;
  [key: string]: unknown;
}

export interface Annotation {
  label: string | null;
  notes: string | null;
}

export interface TableColumn {
  id: string;
  label: string;
  width: number;
  editable: boolean;
  sortable: boolean;
}

export interface SortState {
  columnId: string | null;
  direction: "asc" | "desc" | null;
}

export interface TelemetryDataPoint {
  id?: string;
  timestamp: string;
  value: number;
  source_id?: string | null;
}

export type TelemetryData = Record<string, TelemetryDataPoint[]>;
