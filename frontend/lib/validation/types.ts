/**
 * Chart validation types
 */

export interface ValidationIssue {
  type: "error" | "warning";
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface ValidationStats {
  totalPoints: number;
  validPoints: number;
  skippedPoints: number;
  coercedPoints: number;
}

export interface ValidationResult<T = unknown> {
  isValid: boolean;
  validData: T | null;
  issues: ValidationIssue[];
  stats: ValidationStats;
}

export interface ChartRequirements {
  minPoints: number;
  maxPoints?: number;
  requiresNumericX: boolean;
  requiresNumericY: boolean;
  supportsCategories: boolean;
  supportsMixedTypes: boolean;
}

export const CHART_REQUIREMENTS: Record<string, ChartRequirements> = {
  line: {
    minPoints: 2,
    requiresNumericX: true,
    requiresNumericY: true,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  area: {
    minPoints: 2,
    requiresNumericX: true,
    requiresNumericY: true,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  bar: {
    minPoints: 1,
    requiresNumericX: false,
    requiresNumericY: true,
    supportsCategories: true,
    supportsMixedTypes: true,
  },
  scatter: {
    minPoints: 1,
    requiresNumericX: true,
    requiresNumericY: true,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  text: {
    minPoints: 0,
    requiresNumericX: false,
    requiresNumericY: false,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  video: {
    minPoints: 0,
    requiresNumericX: false,
    requiresNumericY: false,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  audio: {
    minPoints: 0,
    requiresNumericX: false,
    requiresNumericY: false,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  map: {
    minPoints: 0,
    requiresNumericX: false,
    requiresNumericY: false,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  calendar: {
    minPoints: 0,
    requiresNumericX: false,
    requiresNumericY: false,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
  list: {
    minPoints: 0,
    requiresNumericX: false,
    requiresNumericY: false,
    supportsCategories: false,
    supportsMixedTypes: false,
  },
};

export interface ValidatedSeries {
  name: string;
  data: Array<{ x: number; y: number }>;
  color?: string;
}

export interface ValidatedChartData {
  series: ValidatedSeries[];
}

