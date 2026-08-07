/** biome-ignore-all lint/a11y/noSvgWithoutTitle: <explanation> */
"use client";

import * as React from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useChartVisibility } from "@/components/ui/lib/visibility";

/**
 * Default GPU error fallback component
 */
function GPUErrorFallback({
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="text-center px-4 py-3 max-w-xs">
        <p className="text-sm text-muted-foreground mb-2">
          Chart failed to render
        </p>
        <button
          onClick={resetErrorBoundary}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          type="button"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export interface Point {
  x: number;
  y: number;
}

export interface Axis {
  label?: string;
  domain?: [number, number] | "auto";
  type?: "number" | "time";
  formatter?: (value: number) => string;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HoveredPoint<TData = unknown> {
  seriesIdx: number;
  pointIdx: number;
  screenX: number;
  screenY: number;
  data?: TData;
}

export interface TooltipData {
  title: string;
  items: { label: string; value: string; color?: string }[];
}

export interface TimeSeriesState {
  isPlaying: boolean;
  currentTime: number;
  startTime: number;
  endTime: number;
  playbackSpeed: number;
}

export interface BaseChartContext {
  width: number;
  height: number;
  margin: Margin;
  devicePixelRatio: number;
  xAxis: Axis;
  yAxis: Axis;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  xScale: (x: number) => number;
  yScale: (y: number) => number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  preferWebGPU: boolean;
  renderMode: "webgpu" | "webgl" | null;
  setRenderMode: (mode: "webgpu" | "webgl" | null) => void;
  gpuDevice: GPUDevice | null;
  hoveredPoint: HoveredPoint<unknown> | null;
  setHoveredPoint: (point: HoveredPoint<unknown> | null) => void;
  tooltipData: TooltipData | null;
  setTooltipData: (data: TooltipData | null) => void;
  timeSeriesState: TimeSeriesState | null;
  setTimeSeriesState: React.Dispatch<
    React.SetStateAction<TimeSeriesState | null>
  >;
  /** Whether the chart is visible (in viewport and tab active). Use to pause expensive rendering. */
  isVisible: boolean;
}

const BaseChartContext = React.createContext<BaseChartContext | null>(null);

// Module-level stable defaults so unset props don't create new objects per render.
const DEFAULT_MARGIN: Margin = { top: 20, right: 20, bottom: 50, left: 60 };
const EMPTY_AXIS: Axis = {};

export function useBaseChart() {
  const ctx = React.useContext(BaseChartContext);
  if (!ctx) {
    throw new Error("Chart components must be used within Chart.Root");
  }
  return ctx;
}

/**
 * Calculate domain (min/max) with optional padding
 */
export function getDomain(
  points: Point[],
  accessor: (p: Point) => number,
  paddingPercent: number = 0.05,
): [number, number] {
  if (points.length === 0) return [0, 1];

  let min = accessor(points[0]);
  let max = accessor(points[0]);

  for (const point of points) {
    const value = accessor(point);
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = max - min;
  const padding = range * paddingPercent || 1;
  // Always pad both sides symmetrically — don't clamp to 0
  // (clamping squishes charts when values are far from zero, e.g. azimuth ~343°)
  const domainMin = min - padding;
  const domainMax = max + padding;

  return [domainMin, domainMax];
}

// Shared offscreen 2D context for text measurement (axis labels, limit pills).
let measureContext: CanvasRenderingContext2D | null = null;

/**
 * Widest rendered width of the given labels in the given CSS font.
 * Falls back to a ~7px/char estimate when no canvas is available (SSR).
 */
export function measureTextWidth(labels: string[], font: string): number {
  if (labels.length === 0) return 0;
  if (!measureContext && typeof document !== "undefined") {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) {
    return Math.max(...labels.map((l) => l.length * 7));
  }
  measureContext.font = font;
  let max = 0;
  for (const label of labels) {
    const w = measureContext.measureText(label).width;
    if (w > max) max = w;
  }
  return max;
}

/**
 * Round a number to a "nice" value (1, 2, 5, 10 multiples)
 * Used for creating human-readable axis bounds and tick intervals
 */
function niceNumber(value: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / Math.pow(10, exponent);
  let niceFraction: number;

  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }

  return niceFraction * Math.pow(10, exponent);
}

/**
 * Calculate a "nice" domain with stable, human-readable bounds.
 * Rounds min/max to clean numbers that don't jump around with small data changes.
 */
export function getNiceDomain(
  points: Point[],
  accessor: (p: Point) => number,
  tickCount: number = 6,
): [number, number] {
  if (points.length === 0) return [0, 1];

  let min = accessor(points[0]);
  let max = accessor(points[0]);

  for (const point of points) {
    const value = accessor(point);
    if (value < min) min = value;
    if (value > max) max = value;
  }

  // Handle edge case where all values are the same
  if (min === max) {
    if (min === 0) return [-1, 1];
    const padding = Math.abs(min) * 0.1;
    return [min - padding, max + padding];
  }

  const range = niceNumber(max - min, false);
  const tickSpacing = niceNumber(range / (tickCount - 1), true);

  // Round min down and max up to nice tick boundaries
  const niceMin = Math.floor(min / tickSpacing) * tickSpacing;
  const niceMax = Math.ceil(max / tickSpacing) * tickSpacing;

  // For positive-only data, don't go below 0
  if (min >= 0 && niceMin < 0) {
    return [0, niceMax];
  }

  return [niceMin, niceMax];
}

/**
 * Generate evenly spaced tick values for axis using nice intervals
 */
export function getTicks(domain: [number, number], count: number): number[] {
  const [min, max] = domain;
  const range = max - min;

  if (range === 0) return [min];

  // Calculate a nice tick spacing
  const roughStep = range / (count - 1);
  const exponent = Math.floor(Math.log10(roughStep));
  const fraction = roughStep / Math.pow(10, exponent);

  let niceStep: number;
  if (fraction <= 1) niceStep = 1;
  else if (fraction <= 2) niceStep = 2;
  else if (fraction <= 5) niceStep = 5;
  else niceStep = 10;

  niceStep *= Math.pow(10, exponent);

  // Generate ticks starting from a nice minimum
  const ticks: number[] = [];
  const niceMin = Math.ceil(min / niceStep) * niceStep;

  for (let tick = niceMin; tick <= max + niceStep * 0.001; tick += niceStep) {
    // Round to avoid floating point precision issues
    const roundedTick = Math.round(tick * 1e10) / 1e10;
    ticks.push(roundedTick);
  }

  // Ensure we have at least min and max represented
  if (ticks.length === 0) {
    return [min, max];
  }

  return ticks;
}

/**
 * Nice time intervals in milliseconds for axis ticks.
 * These are common intervals that produce clean time labels.
 */
const NICE_TIME_INTERVALS = [
  1000, // 1 second
  2000, // 2 seconds
  5000, // 5 seconds
  10000, // 10 seconds
  15000, // 15 seconds
  30000, // 30 seconds
  60000, // 1 minute
  120000, // 2 minutes
  300000, // 5 minutes
  600000, // 10 minutes
  900000, // 15 minutes
  1800000, // 30 minutes
  3600000, // 1 hour
  7200000, // 2 hours
  14400000, // 4 hours
  21600000, // 6 hours
  43200000, // 12 hours
  86400000, // 1 day
];

/**
 * Get the nice time interval for a given data range.
 * Returns an interval in milliseconds that produces clean time labels.
 */
export function getNiceTimeInterval(
  range: number,
  targetCount: number = 6,
): number {
  if (range <= 0) return NICE_TIME_INTERVALS[0];

  const idealInterval = range / (targetCount - 1);

  // Find the closest nice interval
  for (const niceInterval of NICE_TIME_INTERVALS) {
    if (niceInterval >= idealInterval) {
      return niceInterval;
    }
  }

  return NICE_TIME_INTERVALS[NICE_TIME_INTERVALS.length - 1];
}

/**
 * Quantize a time domain to nice tick boundaries.
 * This prevents the domain from changing continuously - it only jumps
 * when data crosses a tick boundary. This is key for stable axis labels.
 */
export function getQuantizedTimeDomain(
  dataDomain: [number, number],
  targetCount: number = 6,
): [number, number] {
  const [dataMin, dataMax] = dataDomain;
  const range = dataMax - dataMin;

  if (range <= 0) return dataDomain;

  const interval = getNiceTimeInterval(range, targetCount);

  // Round min down and max up to tick boundaries
  // This ensures the domain only changes in discrete steps
  const quantizedMin = Math.floor(dataMin / interval) * interval;
  const quantizedMax = Math.ceil(dataMax / interval) * interval;

  return [quantizedMin, quantizedMax];
}

/**
 * Generate time-based tick values anchored to absolute time boundaries.
 * Unlike regular ticks, these don't shift when new data arrives - they're
 * fixed to wall-clock time (e.g., :00, :10, :20 seconds).
 */
export function getNiceTimeTicks(
  domain: [number, number],
  targetCount: number = 6,
): number[] {
  const [min, max] = domain;
  const range = max - min;

  if (range <= 0) return [min];

  const interval = getNiceTimeInterval(range, targetCount);

  // Generate ticks aligned to absolute time boundaries
  // For example, if interval is 10 seconds, ticks are at :00, :10, :20, etc.
  const ticks: number[] = [];
  const firstTick = Math.ceil(min / interval) * interval;

  for (let tick = firstTick; tick <= max; tick += interval) {
    ticks.push(tick);
  }

  // Ensure at least 2 ticks
  if (ticks.length < 2 && range > 0) {
    return [min, max];
  }

  return ticks;
}

/**
 * Format numeric value with intelligent precision and SI suffixes.
 * Adapts decimal places based on the magnitude and avoids excessive decimals.
 */
export function formatValue(value: number): string {
  const absValue = Math.abs(value);

  // Handle zero
  if (value === 0) return "0";

  // Large numbers: use SI suffixes
  if (absValue >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toPrecision(3)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${(value / 1_000_000).toPrecision(3)}M`;
  }
  if (absValue >= 1_000) {
    return `${(value / 1_000).toPrecision(3)}k`;
  }

  // Small numbers: use scientific notation
  if (absValue < 0.001 && absValue !== 0) {
    return value.toExponential(1);
  }

  // Numbers between 0.001 and 1000: use appropriate decimal places
  // The key insight: show fewer decimals for larger numbers
  if (absValue >= 100) {
    return Math.round(value).toString();
  }
  if (absValue >= 10) {
    return (Math.round(value * 10) / 10).toString();
  }
  if (absValue >= 1) {
    return (Math.round(value * 100) / 100).toString();
  }

  // For values < 1, show 2-3 significant figures
  return value.toPrecision(2);
}

/**
 * Convert hex or rgb color to normalized RGB values [0-1]
 */
export function hexToRgb(color: string): [number, number, number] {
  const rgbMatch = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(color);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1]) / 255,
      parseInt(rgbMatch[2]) / 255,
      parseInt(rgbMatch[3]) / 255,
    ];
  }

  const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  return hexMatch
    ? [
        parseInt(hexMatch[1], 16) / 255,
        parseInt(hexMatch[2], 16) / 255,
        parseInt(hexMatch[3], 16) / 255,
      ]
    : [0, 0, 1];
}

export interface RendererProps {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  margin: Margin;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  showGrid: boolean;
}

export interface WebGLRenderer<TProps extends RendererProps = RendererProps> {
  render: (props: TProps) => void;
  destroy: () => void;
  getGL: () => WebGL2RenderingContext;
  getProgram: () => WebGLProgram | null;
}

export interface WebGLRendererConfig<
  TProps extends RendererProps = RendererProps,
> {
  canvas: HTMLCanvasElement;
  createShaders: (gl: WebGL2RenderingContext) => {
    vertexSource: string;
    fragmentSource: string;
  };
  onRender: (
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    props: TProps,
  ) => void;
  onDestroy?: (
    gl: WebGL2RenderingContext,
    program: WebGLProgram | null,
  ) => void;
}

/**
 * Create a WebGL2 renderer with custom shaders and render logic
 */
export function createWebGLRenderer<
  TProps extends RendererProps = RendererProps,
>(config: WebGLRendererConfig<TProps>): WebGLRenderer<TProps> {
  const gl = config.canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });

  if (!gl) {
    throw new Error("WebGL2 not supported");
  }

  const createShader = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  };

  const createProgram = (
    vertexSource: string,
    fragmentSource: string,
  ): WebGLProgram => {
    const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertexShader || !fragmentShader) {
      throw new Error("Failed to create shaders");
    }

    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      throw new Error("Failed to link program");
    }

    return program;
  };

  const setupBlending = () => {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  };

  const clear = (width: number, height: number) => {
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0); // Transparent
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  // Initialize program
  const { vertexSource, fragmentSource } = config.createShaders(gl);
  const program = createProgram(vertexSource, fragmentSource);
  setupBlending();

  return {
    render: (props: TProps) => {
      clear(props.width, props.height);
      // Clip rendering to the plot area (inside margins) so lines/fills
      // don't bleed past the axes.
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        props.margin.left,
        props.margin.bottom,
        props.width - props.margin.left - props.margin.right,
        props.height - props.margin.top - props.margin.bottom,
      );
      config.onRender(gl, program, props);
      gl.disable(gl.SCISSOR_TEST);
    },
    destroy: () => {
      if (config.onDestroy) {
        config.onDestroy(gl, program);
      }
      if (program) {
        gl.deleteProgram(program);
      }
    },
    getGL: () => gl,
    getProgram: () => program,
  };
}

export interface WebGPURenderer<TProps extends RendererProps = RendererProps> {
  render: (props: TProps) => Promise<void>;
  destroy: () => void;
  getDevice: () => GPUDevice;
  getContext: () => GPUCanvasContext;
  getPipeline: () => GPURenderPipeline | null;
}

export interface WebGPURendererConfig<
  TProps extends RendererProps = RendererProps,
> {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  format?: GPUTextureFormat;
  createPipeline: (
    device: GPUDevice,
    format: GPUTextureFormat,
  ) => GPURenderPipeline;
  onRender: (
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    props: TProps,
  ) => Promise<void>;
  onDestroy?: (device: GPUDevice, pipeline: GPURenderPipeline | null) => void;
}

/**
 * Create a WebGPU renderer with custom pipeline and render logic
 */
export function createWebGPURenderer<
  TProps extends RendererProps = RendererProps,
>(config: WebGPURendererConfig<TProps>): WebGPURenderer<TProps> {
  const device = config.device;
  const format = config.format ?? "bgra8unorm";

  const context = config.canvas.getContext("webgpu");
  if (!context) {
    throw new Error("WebGPU context not available");
  }

  const gpuContext = context as GPUCanvasContext;
  gpuContext.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  // Initialize pipeline
  const pipeline = config.createPipeline(device, format);

  return {
    render: async (props: TProps) => {
      await config.onRender(device, gpuContext, pipeline, props);
    },
    destroy: () => {
      if (config.onDestroy) {
        config.onDestroy(device, pipeline);
      }
    },
    getDevice: () => device,
    getContext: () => gpuContext,
    getPipeline: () => pipeline,
  };
}

export interface BaseChartRootProps {
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  margin?: Margin;
  xAxis?: Axis;
  yAxis?: Axis;
  xDomain?: [number, number] | "auto";
  yDomain?: [number, number] | "auto";
  xTicks?: number[];
  yTicks?: number[];
  preferWebGPU?: boolean;
  className?: string;
  children?: React.ReactNode;
  enableTimeSeries?: boolean;
  timeRange?: [number, number];
  disableErrorBoundary?: boolean;
  errorFallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /**
   * Automatically pause rendering when chart is off-screen or tab is hidden.
   * Improves performance by skipping GPU work for invisible charts.
   * @default true
   */
  autoHide?: boolean;
}

/**
 * Root chart component providing context and responsive container
 */
export function ChartRoot({
  width: widthProp = 800,
  height: heightProp = 400,
  minWidth = 200,
  minHeight = 150,
  maxWidth,
  maxHeight,
  aspectRatio,
  margin = DEFAULT_MARGIN,
  xAxis = EMPTY_AXIS,
  yAxis = EMPTY_AXIS,
  xDomain: xDomainProp,
  yDomain: yDomainProp,
  xTicks: xTicksProp,
  yTicks: yTicksProp,
  preferWebGPU = true,
  className,
  children,
  enableTimeSeries = false,
  timeRange,
  disableErrorBoundary = false,
  errorFallback,
  onError,
  autoHide = true,
}: BaseChartRootProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLCanvasElement>(null);

  // Visibility detection for auto-pausing when off-screen
  const { isVisible: visibilityState } = useChartVisibility(containerRef);
  const isVisible = autoHide ? visibilityState : true;

  const [dimensions, setDimensions] = React.useState<{
    width: number;
    height: number;
  }>(() => {
    const w = typeof widthProp === "number" ? widthProp : 800;
    const h = typeof heightProp === "number" ? heightProp : 400;
    return { width: w, height: h };
  });

  const [hoveredPoint, setHoveredPoint] =
    React.useState<HoveredPoint<unknown> | null>(null);
  const [tooltipData, setTooltipData] = React.useState<TooltipData | null>(
    null,
  );
  const [renderMode, setRenderMode] = React.useState<"webgpu" | "webgl" | null>(
    null,
  );

  const [gpuDevice, setGpuDevice] = React.useState<GPUDevice | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!preferWebGPU) {
        if (!cancelled) setRenderMode("webgl");
        return;
      }

      if (!navigator.gpu) {
        if (!cancelled) {
          console.warn("WebGPU not supported, falling back to WebGL");
          setRenderMode("webgl");
        }
        return;
      }

      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          if (!cancelled) {
            console.warn("No WebGPU adapter found, falling back to WebGL");
            setRenderMode("webgl");
          }
          return;
        }

        const device = await adapter.requestDevice();
        if (!cancelled) {
          setGpuDevice(device);
          setRenderMode("webgpu");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to initialize WebGPU:", error);
          setRenderMode("webgl");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preferWebGPU]);

  const [timeSeriesState, setTimeSeriesState] =
    React.useState<TimeSeriesState | null>(() => {
      if (!enableTimeSeries || !timeRange) return null;
      return {
        isPlaying: false,
        currentTime: timeRange[0],
        startTime: timeRange[0],
        endTime: timeRange[1],
        playbackSpeed: 1,
      };
    });

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width: observedWidth, height: observedHeight } =
        entry.contentRect;

      let newWidth = observedWidth;
      let newHeight = observedHeight;

      if (newWidth === 0 && newHeight === 0) {
        newWidth = typeof widthProp === "number" ? widthProp : 800;
        newHeight = typeof heightProp === "number" ? heightProp : 400;
      }

      if (minWidth !== undefined) newWidth = Math.max(minWidth, newWidth);
      if (maxWidth !== undefined) newWidth = Math.min(maxWidth, newWidth);
      if (minHeight !== undefined) newHeight = Math.max(minHeight, newHeight);
      if (maxHeight !== undefined) newHeight = Math.min(maxHeight, newHeight);

      if (typeof widthProp === "number") {
        newWidth = Math.min(widthProp, newWidth);
      }
      if (typeof heightProp === "number") {
        newHeight = Math.min(heightProp, newHeight);
      }

      if (aspectRatio !== undefined) {
        const currentRatio = newWidth / newHeight;
        if (currentRatio > aspectRatio) {
          newWidth = newHeight * aspectRatio;
        } else {
          newHeight = newWidth / aspectRatio;
        }
      }

      setDimensions({
        width: Math.round(newWidth),
        height: Math.round(newHeight),
      });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [
    widthProp,
    heightProp,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    aspectRatio,
  ]);

  const { width, height } = dimensions;

  // Memoize so "auto"/undefined don't create a new [0, 100] array per render —
  // Canvas render effect has xDomain/yDomain in its deps and would otherwise fire every render.
  const xDomain = React.useMemo<[number, number]>(
    () =>
      xDomainProp === "auto" || !xDomainProp
        ? [0, 100]
        : [xDomainProp[0], xDomainProp[1]],
    [xDomainProp],
  );
  const yDomain = React.useMemo<[number, number]>(
    () =>
      yDomainProp === "auto" || !yDomainProp
        ? [0, 100]
        : [yDomainProp[0], yDomainProp[1]],
    [yDomainProp],
  );

  const xTicks = React.useMemo(
    () => xTicksProp || getTicks(xDomain, 6),
    [xTicksProp, xDomain],
  );
  const yTicks = React.useMemo(
    () => yTicksProp || getTicks(yDomain, 6),
    [yTicksProp, yDomain],
  );

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xScale = React.useCallback(
    (x: number) =>
      margin.left + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerWidth,
    [xDomain, margin.left, innerWidth],
  );

  const yScale = React.useCallback(
    (y: number) =>
      margin.top +
      innerHeight -
      ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerHeight,
    [yDomain, margin.top, innerHeight],
  );

  const [devicePixelRatio] = React.useState(() =>
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  );

  // Memoize the context value so every consumer of useBaseChart doesn't re-render
  // on every ChartRoot render. Canvas render effect depends on ~15 of these
  // fields; without this memo a new object identity triggers GPU redraw per render.
  const contextValue = React.useMemo<BaseChartContext>(
    () => ({
      width,
      height,
      margin,
      devicePixelRatio,
      xAxis,
      yAxis,
      xDomain,
      yDomain,
      xTicks,
      yTicks,
      xScale,
      yScale,
      canvasRef,
      overlayRef,
      containerRef,
      preferWebGPU,
      renderMode,
      setRenderMode,
      gpuDevice,
      hoveredPoint,
      setHoveredPoint,
      tooltipData,
      setTooltipData,
      timeSeriesState,
      setTimeSeriesState,
      isVisible,
    }),
    [
      width,
      height,
      margin,
      devicePixelRatio,
      xAxis,
      yAxis,
      xDomain,
      yDomain,
      xTicks,
      yTicks,
      xScale,
      yScale,
      preferWebGPU,
      renderMode,
      gpuDevice,
      hoveredPoint,
      tooltipData,
      timeSeriesState,
      isVisible,
    ],
  );

  // Container style with responsive support
  // For responsive behavior: always use 100% width/height and let constraints control size
  const containerStyle: React.CSSProperties = {
    position: "relative",
    width:
      typeof widthProp === "string"
        ? widthProp
        : typeof widthProp === "number"
          ? `${widthProp}px`
          : "100%",
    height:
      typeof heightProp === "string"
        ? heightProp
        : typeof heightProp === "number"
          ? `${heightProp}px`
          : "100%",
    minWidth: minWidth,
    minHeight: minHeight,
    maxWidth: typeof widthProp === "number" ? widthProp : maxWidth,
    maxHeight: typeof heightProp === "number" ? heightProp : maxHeight,
    overflow: "hidden",
  };

  const chartContent = (
    <BaseChartContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={`relative bg-white dark:bg-zinc-950 rounded-lg ${className || ""}`}
        style={containerStyle}
      >
        {children}
      </div>
    </BaseChartContext.Provider>
  );

  if (disableErrorBoundary) {
    return chartContent;
  }

  return (
    <ErrorBoundary
      fallbackRender={
        errorFallback
          ? () => <>{errorFallback}</>
          : ({ error, resetErrorBoundary }) => (
              <GPUErrorFallback
                error={error}
                resetErrorBoundary={resetErrorBoundary}
              />
            )
      }
      onError={onError}
      resetKeys={[preferWebGPU, renderMode]}
    >
      {chartContent}
    </ErrorBoundary>
  );
}

// ============================================================================
// Axes Component
// ============================================================================

export interface ChartAxesProps {
  showXAxis?: boolean;
  showYAxis?: boolean;
}

export function ChartAxes({
  showXAxis = true,
  showYAxis = true,
}: ChartAxesProps = {}) {
  const ctx = useBaseChart();

  React.useEffect(() => {
    const { overlayRef, devicePixelRatio, width, height } = ctx;
    const canvas = overlayRef.current;
    if (!canvas) return;

    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.scale(dpr, dpr);
    context.clearRect(0, 0, ctx.width, ctx.height);

    const isDark = document.documentElement.classList.contains("dark");
    const textColor = isDark ? "#6e6e6e" : "#999999";

    context.strokeStyle = textColor;
    context.fillStyle = textColor;
    context.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";

    // X-axis
    if (showXAxis) {
      context.beginPath();
      context.moveTo(ctx.margin.left, ctx.height - ctx.margin.bottom);
      context.lineTo(
        ctx.width - ctx.margin.right,
        ctx.height - ctx.margin.bottom,
      );
      context.stroke();

      const getFilteredXTicks = () => {
        if (ctx.xTicks.length === 0) return [];

        const sampleLabel = ctx.xAxis.formatter
          ? ctx.xAxis.formatter(ctx.xTicks[0])
          : formatValue(ctx.xTicks[0]);
        const labelWidth = context.measureText(sampleLabel).width;
        const minSpacing = labelWidth + 20;

        const innerWidth = ctx.width - ctx.margin.left - ctx.margin.right;
        const availableSpace = innerWidth / ctx.xTicks.length;

        if (availableSpace >= minSpacing) {
          return ctx.xTicks;
        }

        const skipFactor = Math.ceil(minSpacing / availableSpace);
        return ctx.xTicks.filter((_, i) => i % skipFactor === 0);
      };

      const visibleXTicks = getFilteredXTicks();

      ctx.xTicks.forEach((tick) => {
        const x = ctx.xScale(tick);
        context.beginPath();
        context.moveTo(x, ctx.height - ctx.margin.bottom);
        context.lineTo(x, ctx.height - ctx.margin.bottom + 6);
        context.stroke();
      });

      visibleXTicks.forEach((tick) => {
        const x = ctx.xScale(tick);
        context.textAlign = "center";
        const label = ctx.xAxis.formatter
          ? ctx.xAxis.formatter(tick)
          : formatValue(tick);
        context.fillText(label, x, ctx.height - ctx.margin.bottom + 20);
      });

      if (ctx.xAxis.label) {
        context.font = "14px -apple-system, BlinkMacSystemFont, sans-serif";
        context.textAlign = "center";
        context.fillText(ctx.xAxis.label, ctx.width / 2, ctx.height - 5);
      }
    }

    // Y-axis
    if (showYAxis) {
      context.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
      context.beginPath();
      context.moveTo(ctx.margin.left, ctx.margin.top);
      context.lineTo(ctx.margin.left, ctx.height - ctx.margin.bottom);
      context.stroke();

      ctx.yTicks.forEach((tick) => {
        const y = ctx.yScale(tick);
        context.beginPath();
        context.moveTo(ctx.margin.left - 6, y);
        context.lineTo(ctx.margin.left, y);
        context.stroke();

        context.textAlign = "right";
        context.textBaseline = "middle";
        const label = ctx.yAxis.formatter
          ? ctx.yAxis.formatter(tick)
          : formatValue(tick);
        context.fillText(label, ctx.margin.left - 10, y);
      });

      if (ctx.yAxis.label) {
        context.save();
        context.translate(15, ctx.height / 2);
        context.rotate(-Math.PI / 2);
        context.font = "14px -apple-system, BlinkMacSystemFont, sans-serif";
        context.textAlign = "center";
        context.fillText(ctx.yAxis.label, 0, 0);
        context.restore();
      }
    }
  }, [ctx, showXAxis, showYAxis]);

  const { overlayRef, width: ctxWidth, height: ctxHeight } = ctx;
  return (
    <canvas
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: ctxWidth, height: ctxHeight }}
    />
  );
}

// ============================================================================
// Tooltip Component
// ============================================================================

export function ChartTooltip({
  onHover,
}: {
  onHover?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const ctx = useBaseChart();

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (onHover) {
      onHover(e);
    }
  };

  const handleMouseLeave = () => {
    ctx.setHoveredPoint(null);
    ctx.setTooltipData(null);
  };

  if (!ctx.hoveredPoint || !ctx.tooltipData) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Tooltip overlay requires mouse tracking
      <div
        className="absolute inset-0"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    );
  }

  // Calculate tooltip position
  const tooltipWidth = 160;
  const tooltipHeight = 20 + ctx.tooltipData.items.length * 20 + 10;
  let tooltipX = ctx.hoveredPoint.screenX + 12;
  let tooltipY = ctx.hoveredPoint.screenY - tooltipHeight / 2;

  if (tooltipX + tooltipWidth > ctx.width) {
    tooltipX = ctx.hoveredPoint.screenX - tooltipWidth - 12;
  }
  if (tooltipY < 0) tooltipY = 4;
  if (tooltipY + tooltipHeight > ctx.height) {
    tooltipY = ctx.height - tooltipHeight - 4;
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Tooltip overlay requires mouse tracking */}
      <div
        className="absolute inset-0"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* Crosshair - Linear-style subtle vertical line only */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width: ctx.width, height: ctx.height }}
        aria-label="Crosshair indicator"
      >
        <line
          x1={ctx.hoveredPoint.screenX}
          y1={ctx.margin.top}
          x2={ctx.hoveredPoint.screenX}
          y2={ctx.height - ctx.margin.bottom}
          stroke="currentColor"
          strokeWidth="1"
          className="text-zinc-300 dark:text-zinc-700"
          opacity="0.8"
        />
      </svg>

      {/* Tooltip - Linear/Notion glass-morphism style */}
      <div
        className="absolute z-50 px-3 py-2.5 backdrop-blur-md bg-white/90 dark:bg-zinc-900/90 text-sm rounded-xl shadow-lg shadow-black/5 dark:shadow-black/20 pointer-events-none border border-zinc-200/50 dark:border-zinc-700/50"
        style={{ left: tooltipX, top: tooltipY }}
      >
        <div className="font-medium text-zinc-900 dark:text-zinc-100 mb-1.5">
          {ctx.tooltipData.title}
        </div>
        {ctx.tooltipData.items.map((item, idx) => (
          <div
            key={idx}
            className="text-zinc-600 dark:text-zinc-300 text-xs flex items-center gap-2"
          >
            {item.color && (
              <div
                className="w-2 h-2 rounded-full ring-1 ring-black/5 dark:ring-white/10"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {item.label}:
              </span>{" "}
              <span className="font-medium font-mono text-zinc-800 dark:text-zinc-200">
                {item.value}
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
