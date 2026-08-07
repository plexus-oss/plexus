/**
 * Zod schemas for chart data validation
 */

import { z } from "zod";

// Base point schema for numeric data
const NumericPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

// Point schema for bar charts (allows categorical x-axis)
const CategoricalPointSchema = z.object({
  x: z.union([z.number().finite(), z.string().min(1)]),
  y: z.number().finite(),
});

// Series schema for line/area charts
const NumericSeriesSchema = z.object({
  name: z.string().min(1),
  data: z
    .array(NumericPointSchema)
    .min(2, "Line/area charts require at least 2 points per series"),
  color: z.string().optional(),
});

// Series schema for bar charts
const BarSeriesSchema = z.object({
  name: z.string().min(1),
  data: z
    .array(CategoricalPointSchema)
    .min(1, "Bar charts require at least 1 data point"),
  color: z.string().optional(),
});

// Series schema for scatter charts
const ScatterSeriesSchema = z.object({
  name: z.string().min(1),
  data: z
    .array(
      NumericPointSchema.extend({
        size: z.number().positive().optional(),
      }),
    )
    .min(1, "Scatter charts require at least 1 point"),
  color: z.string().optional(),
  size: z.number().positive().optional(),
});

// Chart data schemas
export const LineChartDataSchema = z.object({
  series: z.array(NumericSeriesSchema).min(1, "At least one series required"),
});

export const AreaChartDataSchema = z.object({
  series: z
    .array(
      NumericSeriesSchema.extend({
        fillOpacity: z.number().min(0).max(1).optional(),
        baseline: z.number().optional(),
      }),
    )
    .min(1, "At least one series required"),
});

export const BarChartDataSchema = z.object({
  series: z.array(BarSeriesSchema).min(1, "At least one series required"),
});

export const ScatterChartDataSchema = z.object({
  series: z.array(ScatterSeriesSchema).min(1, "At least one series required"),
});

// Map chart types to their schemas
export const ChartTypeSchemas = {
  line: LineChartDataSchema,
  area: AreaChartDataSchema,
  bar: BarChartDataSchema,
  scatter: ScatterChartDataSchema,
} as const;

export type ChartType = keyof typeof ChartTypeSchemas;
