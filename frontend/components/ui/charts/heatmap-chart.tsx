"use client";

import {
  createWebGLRenderer,
  createWebGPURenderer,
  ChartAxes,
  ChartRoot,
  ChartTooltip,
  hexToRgb,
  type RendererProps,
  type WebGLRenderer,
  type WebGPURenderer,
  useBaseChart,
} from "./base-chart";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { viridis as defaultColorScale } from "@/components/ui/lib/color-scales";

// ============================================================================
// Heatmap Chart Types
// ============================================================================

export interface DataPoint {
  x: number | string;
  y: number | string;
  value: number;
  label?: string;
}

export interface HeatmapChartProps {
  data: DataPoint[];
  xAxis?: {
    label?: string;
    categories?: (string | number)[];
    formatter?: (value: number | string) => string;
  };
  yAxis?: {
    label?: string;
    categories?: (string | number)[];
    formatter?: (value: number | string) => string;
  };
  width?: number | string; // Support "100%", "50vw", etc.
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number; // e.g., 16/9, 4/3
  margin?: { top: number; right: number; bottom: number; left: number };
  showGrid?: boolean;
  showAxes?: boolean;
  showTooltip?: boolean;
  className?: string;
  preferWebGPU?: boolean;
  colorScale?: (value: number) => string; // Function to map value to color
  minValue?: number;
  maxValue?: number;
  cellGap?: number;
}

// Extended context for heatmap chart
interface HeatmapChartContextType {
  data: DataPoint[];
  xCategories: (string | number)[];
  yCategories: (string | number)[];
  xCategoryMap: Map<string | number, number>;
  yCategoryMap: Map<string | number, number>;
  colorScale: (value: number) => string;
  minValue: number;
  maxValue: number;
  cellGap: number;
}

const HeatmapChartContext = createContext<HeatmapChartContextType | null>(null);

function useHeatmapChartData() {
  const ctx = useContext(HeatmapChartContext);
  if (!ctx) {
    throw new Error(
      "HeatmapChart components must be used within HeatmapChart.Root"
    );
  }
  return ctx;
}

function useHeatmapChart() {
  const baseCtx = useBaseChart();
  const heatmapCtx = useHeatmapChartData();
  return { ...baseCtx, ...heatmapCtx };
}

// ============================================================================
// Shaders
// ============================================================================

const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec4 a_color;

uniform vec2 u_resolution;
uniform mat3 u_matrix;

varying vec4 v_color;

void main() {
  vec2 position = (u_matrix * vec3(a_position, 1.0)).xy;
  vec2 clipSpace = (position / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;

  gl_Position = vec4(clipSpace, 0.0, 1.0);
  v_color = a_color;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec4 v_color;

void main() {
  gl_FragColor = v_color;
}
`;

const WGSL_SHADER = `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

struct Uniforms {
  resolution: vec2f,
  transform: mat3x3f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  let transformed = uniforms.transform * vec3f(input.position, 1.0);
  var clipSpace = (transformed.xy / uniforms.resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;

  output.position = vec4f(clipSpace, 0.0, 1.0);
  output.color = input.color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return input.color;
}
`;

// ============================================================================
// Heatmap Renderers
// ============================================================================

interface HeatmapRendererProps extends RendererProps {
  data: DataPoint[];
  xCategoryMap: Map<string | number, number>;
  yCategoryMap: Map<string | number, number>;
  colorScale: (value: number) => string;
  minValue: number;
  maxValue: number;
  cellGap: number;
}

// Helper function to create heatmap geometry
function createHeatmapGeometry(
  data: DataPoint[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
  xCategoryMap: Map<string | number, number>,
  yCategoryMap: Map<string | number, number>,
  colorScale: (value: number) => string,
  minValue: number,
  maxValue: number,
  cellWidth: number,
  cellHeight: number,
  cellGap: number
) {
  const positions: number[] = [];
  const colors: number[] = [];

  for (const point of data) {
    const xIdx = xCategoryMap.get(point.x);
    const yIdx = yCategoryMap.get(point.y);

    if (xIdx === undefined || yIdx === undefined) continue;

    // xScale/yScale return the center position, so offset by half cell size
    // to position the cell correctly
    const centerX = xScale(xIdx);
    const centerY = yScale(yIdx);
    const x = centerX - cellWidth / 2;
    const y = centerY - cellHeight / 2;
    const w = cellWidth - cellGap;
    const h = cellHeight - cellGap;

    // Normalize value to [0, 1]
    const normalizedValue = (point.value - minValue) / (maxValue - minValue);
    const colorStr = colorScale(normalizedValue);
    const rgb = hexToRgb(colorStr);

    // Two triangles for rectangle
    positions.push(x, y, x + w, y, x, y + h, x + w, y, x + w, y + h, x, y + h);

    // Same color for all 6 vertices
    for (let i = 0; i < 6; i++) {
      colors.push(...rgb, 1.0);
    }
  }

  return { positions, colors };
}

// Factory function to create WebGL heatmap renderer
function createWebGLHeatmapRenderer(
  canvas: HTMLCanvasElement
): WebGLRenderer<HeatmapRendererProps> {
  const buffers = {
    position: null as WebGLBuffer | null,
    color: null as WebGLBuffer | null,
  };

  const renderer = createWebGLRenderer<HeatmapRendererProps>({
    canvas,
    createShaders: () => ({
      vertexSource: VERTEX_SHADER,
      fragmentSource: FRAGMENT_SHADER,
    }),
    onRender: (gl, program, props) => {
      const {
        data,
        xDomain,
        yDomain,
        width,
        height,
        margin,
        xCategoryMap,
        yCategoryMap,
        colorScale,
        minValue,
        maxValue,
        cellGap,
      } = props;

      gl.useProgram(program);

      const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
      gl.uniform2f(resolutionLoc, width, height);

      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;
      const matrix = [1, 0, 0, 0, 1, 0, margin.left, margin.top, 1];
      const matrixLoc = gl.getUniformLocation(program, "u_matrix");
      gl.uniformMatrix3fv(matrixLoc, false, matrix);

      const xScale = (x: number) =>
        ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerWidth;
      const yScale = (y: number) =>
        ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerHeight;
      const yScaleFlipped = (y: number) => innerHeight - yScale(y);

      const cellWidth = innerWidth / xCategoryMap.size;
      const cellHeight = innerHeight / yCategoryMap.size;

      const geometry = createHeatmapGeometry(
        data,
        xScale,
        yScaleFlipped,
        xCategoryMap,
        yCategoryMap,
        colorScale,
        minValue,
        maxValue,
        cellWidth,
        cellHeight,
        cellGap
      );

      if (geometry.positions.length === 0) return;

      if (!buffers.position) buffers.position = gl.createBuffer();
      if (!buffers.color) buffers.color = gl.createBuffer();

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(geometry.positions),
        gl.STATIC_DRAW
      );
      const positionLoc = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(geometry.colors),
        gl.STATIC_DRAW
      );
      const colorLoc = gl.getAttribLocation(program, "a_color");
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, geometry.positions.length / 2);
    },
    onDestroy: (gl) => {
      if (buffers.position) gl.deleteBuffer(buffers.position);
      if (buffers.color) gl.deleteBuffer(buffers.color);
    },
  });

  return renderer;
}

// Factory function to create WebGPU heatmap renderer
function createWebGPUHeatmapRenderer(
  canvas: HTMLCanvasElement,
  device: GPUDevice
): WebGPURenderer<HeatmapRendererProps> {
  const shaderModule = device.createShaderModule({ code: WGSL_SHADER });

  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform" },
      },
    ],
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // Persistent buffers for heatmap rendering (reused across frames)
  const heatmapBuffers = {
    position: null as GPUBuffer | null,
    color: null as GPUBuffer | null,
  };

  const renderer = createWebGPURenderer<HeatmapRendererProps>({
    canvas,
    device,
    createPipeline: (device, format) => {
      return device.createRenderPipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
        }),
        vertex: {
          module: shaderModule,
          entryPoint: "vertexMain",
          buffers: [
            {
              arrayStride: 8,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
              ],
            },
            {
              arrayStride: 16,
              attributes: [
                { shaderLocation: 1, offset: 0, format: "float32x4" },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
                alpha: {
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                  operation: "add",
                },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      });
    },
    onRender: async (device, context, pipeline, props) => {
      const {
        data,
        xDomain,
        yDomain,
        width,
        height,
        margin,
        xCategoryMap,
        yCategoryMap,
        colorScale,
        minValue,
        maxValue,
        cellGap,
      } = props;

      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;

      const uniformData = new Float32Array([
        width,
        height,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        margin.left,
        margin.top,
        1,
        0,
      ]);
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const xScale = (x: number) =>
        ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerWidth;
      const yScale = (y: number) =>
        ((y - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerHeight;
      const yScaleFlipped = (y: number) => innerHeight - yScale(y);

      const cellWidth = innerWidth / xCategoryMap.size;
      const cellHeight = innerHeight / yCategoryMap.size;

      const geometry = createHeatmapGeometry(
        data,
        xScale,
        yScaleFlipped,
        xCategoryMap,
        yCategoryMap,
        colorScale,
        minValue,
        maxValue,
        cellWidth,
        cellHeight,
        cellGap
      );

      if (geometry.positions.length === 0) return;

      const commandEncoder = device.createCommandEncoder();
      const textureView = context.getCurrentTexture().createView();

      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });

      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(0, bindGroup);

      const positionData = new Float32Array(geometry.positions);
      const colorData = new Float32Array(geometry.colors);

      // Create or resize position buffer with 1.5x growth factor
      if (
        !heatmapBuffers.position ||
        heatmapBuffers.position.size < positionData.byteLength * 1.5
      ) {
        heatmapBuffers.position?.destroy();
        heatmapBuffers.position = device.createBuffer({
          size: Math.ceil(positionData.byteLength * 1.5),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }

      // Create or resize color buffer with 1.5x growth factor
      if (
        !heatmapBuffers.color ||
        heatmapBuffers.color.size < colorData.byteLength * 1.5
      ) {
        heatmapBuffers.color?.destroy();
        heatmapBuffers.color = device.createBuffer({
          size: Math.ceil(colorData.byteLength * 1.5),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }

      // Write data to buffers
      device.queue.writeBuffer(heatmapBuffers.position, 0, positionData);
      device.queue.writeBuffer(heatmapBuffers.color, 0, colorData);

      passEncoder.setVertexBuffer(0, heatmapBuffers.position);
      passEncoder.setVertexBuffer(1, heatmapBuffers.color);

      passEncoder.draw(geometry.positions.length / 2);

      passEncoder.end();
      device.queue.submit([commandEncoder.finish()]);
    },
    onDestroy: () => {
      uniformBuffer.destroy();
      // Clean up heatmap buffers
      heatmapBuffers.position?.destroy();
      heatmapBuffers.color?.destroy();
    },
  });

  return renderer;
}

// ============================================================================
// Heatmap Chart Components
// ============================================================================

function Root({
  data,
  xAxis = {},
  yAxis = {},
  width = 800,
  height = 400,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  aspectRatio,
  margin,
  preferWebGPU = true,
  colorScale = defaultColorScale,
  minValue,
  maxValue,
  cellGap = 2,
  className,
  children,
}: {
  data: DataPoint[];
  xAxis?: {
    label?: string;
    categories?: (string | number)[];
    formatter?: (value: number | string) => string;
  };
  yAxis?: {
    label?: string;
    categories?: (string | number)[];
    formatter?: (value: number | string) => string;
  };
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  preferWebGPU?: boolean;
  colorScale?: (value: number) => string;
  minValue?: number;
  maxValue?: number;
  cellGap?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  // Extract categories - preserve insertion order for strings, sort numbers
  const xCategories = useMemo(() => {
    if (xAxis.categories) return xAxis.categories;
    const cats = new Set<string | number>();
    data.forEach((d: DataPoint) => {
      cats.add(d.x);
    });
    const arr = Array.from(cats);
    // Only sort if all categories are numbers
    if (arr.length > 0 && arr.every((c) => typeof c === "number")) {
      return arr.sort((a, b) => (a as number) - (b as number));
    }
    // For strings or mixed types, preserve insertion order
    return arr;
  }, [data, xAxis.categories]);

  const yCategories = useMemo(() => {
    if (yAxis.categories) return yAxis.categories;
    const cats = new Set<string | number>();
    data.forEach((d) => {
      cats.add(d.y);
    });
    const arr = Array.from(cats);
    // Only sort if all categories are numbers
    if (arr.length > 0 && arr.every((c) => typeof c === "number")) {
      return arr.sort((a, b) => (a as number) - (b as number));
    }
    // For strings or mixed types, preserve insertion order
    return arr;
  }, [data, yAxis.categories]);

  // Create category mappings
  const xCategoryMap = useMemo(() => {
    const map = new Map<string | number, number>();
    xCategories.forEach((cat, idx) => {
      map.set(cat, idx);
    });
    return map;
  }, [xCategories]);

  const yCategoryMap = useMemo(() => {
    const map = new Map<string | number, number>();
    yCategories.forEach((cat, idx) => {
      map.set(cat, idx);
    });
    return map;
  }, [yCategories]);

  // Calculate value range
  const calculatedMinValue = useMemo(() => {
    if (minValue !== undefined) return minValue;
    return Math.min(...data.map((d) => d.value));
  }, [data, minValue]);

  const calculatedMaxValue = useMemo(() => {
    if (maxValue !== undefined) return maxValue;
    return Math.max(...data.map((d) => d.value));
  }, [data, maxValue]);

  // Domains for rendering
  const xDomain: [number, number] = [-0.5, xCategories.length - 0.5];
  const yDomain: [number, number] = [-0.5, yCategories.length - 0.5];

  // Generate ticks at integer positions for categorical data
  const xTicksArray = useMemo(() => {
    // Show all X category ticks (usually not too many)
    return Array.from({ length: xCategories.length }, (_, i) => i);
  }, [xCategories.length]);

  const yTicksArray = useMemo(() => {
    // For Y axis, if there are many categories (>10), show a subset for readability
    if (yCategories.length > 10) {
      const step = Math.ceil(yCategories.length / 8);
      return Array.from(
        { length: Math.ceil(yCategories.length / step) },
        (_, i) => i * step
      ).filter((i) => i < yCategories.length);
    }
    return Array.from({ length: yCategories.length }, (_, i) => i);
  }, [yCategories.length]);

  // Formatters to map indices to category labels
  const xFormatter = useMemo(() => {
    return (
      xAxis.formatter ||
      ((value: number) => {
        const idx = Math.round(value);
        return idx >= 0 && idx < xCategories.length
          ? String(xCategories[idx])
          : "";
      })
    );
  }, [xCategories, xAxis.formatter]);

  const yFormatter = useMemo(() => {
    return (
      yAxis.formatter ||
      ((value: number) => {
        const idx = Math.round(value);
        return idx >= 0 && idx < yCategories.length
          ? String(yCategories[idx])
          : "";
      })
    );
  }, [yCategories, yAxis.formatter]);

  return (
    <ChartRoot
      width={width}
      height={height}
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      aspectRatio={aspectRatio}
      margin={margin}
      xAxis={{ ...xAxis, formatter: xFormatter }}
      yAxis={{ ...yAxis, formatter: yFormatter }}
      xDomain={xDomain}
      yDomain={yDomain}
      xTicks={xTicksArray}
      yTicks={yTicksArray}
      preferWebGPU={preferWebGPU}
      className={className}
    >
      <HeatmapChartContext.Provider
        value={{
          data,
          xCategories,
          yCategories,
          xCategoryMap,
          yCategoryMap,
          colorScale,
          minValue: calculatedMinValue,
          maxValue: calculatedMaxValue,
          cellGap,
        }}
      >
        {children}
      </HeatmapChartContext.Provider>
    </ChartRoot>
  );
}

function Canvas() {
  const ctx = useHeatmapChart();
  // Destructure ref/value fields off the merged context so the React Compiler
  // can track them as stable locals (reading/mutating through the spread-merged
  // `ctx` object trips the refs/immutability rules).
  const { canvasRef, width, height, devicePixelRatio } = ctx;
  const rendererRef = useRef<
    | WebGLRenderer<HeatmapRendererProps>
    | WebGPURenderer<HeatmapRendererProps>
    | null
  >(null);
  const mountedRef = useRef(true);

  // Initialize renderer once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    mountedRef.current = true;

    async function initRenderer() {
      if (!canvas) return;

      try {
        if (ctx.preferWebGPU && "gpu" in navigator) {
          const adapter = await navigator.gpu?.requestAdapter();
          if (adapter) {
            const device = await adapter.requestDevice();
            const renderer = createWebGPUHeatmapRenderer(canvas, device);

            if (!mountedRef.current) {
              renderer.destroy();
              return;
            }

            rendererRef.current = renderer;
            ctx.setRenderMode("webgpu");
            return;
          }
        }
      } catch (error) {
        console.warn("WebGPU failed, falling back to WebGL:", error);
      }

      try {
        const renderer = createWebGLHeatmapRenderer(canvas);

        if (!mountedRef.current) {
          renderer.destroy();
          return;
        }

        rendererRef.current = renderer;
        ctx.setRenderMode("webgl");
      } catch (error) {
        console.error("WebGL failed:", error);
      }
    }

    initRenderer();

    return () => {
      mountedRef.current = false;
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only initialize once

  // Update render when data changes
  useEffect(() => {
    const canvas = ctx.canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;

    const dpr = ctx.devicePixelRatio;

    const renderProps = {
      canvas,
      data: ctx.data,
      xDomain: ctx.xDomain,
      yDomain: ctx.yDomain,
      xTicks: ctx.xTicks,
      yTicks: ctx.yTicks,
      width: ctx.width * dpr,
      height: ctx.height * dpr,
      margin: {
        top: ctx.margin.top * dpr,
        right: ctx.margin.right * dpr,
        bottom: ctx.margin.bottom * dpr,
        left: ctx.margin.left * dpr,
      },
      showGrid: false,
      xCategoryMap: ctx.xCategoryMap,
      yCategoryMap: ctx.yCategoryMap,
      colorScale: ctx.colorScale,
      minValue: ctx.minValue,
      maxValue: ctx.maxValue,
      cellGap: ctx.cellGap * dpr,
    };

    renderer.render(renderProps);
  }, [
    ctx.canvasRef,
    ctx.data,
    ctx.xDomain,
    ctx.yDomain,
    ctx.xTicks,
    ctx.yTicks,
    ctx.width,
    ctx.height,
    ctx.devicePixelRatio,
    ctx.margin.top,
    ctx.margin.right,
    ctx.margin.bottom,
    ctx.margin.left,
    ctx.xCategoryMap,
    ctx.yCategoryMap,
    ctx.colorScale,
    ctx.minValue,
    ctx.maxValue,
    ctx.cellGap,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
}

function Grid() {
  const ctx = useHeatmapChart();

  useEffect(() => {
    const canvas = ctx.overlayRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = ctx.devicePixelRatio;

    // Get theme-aware colors
    const isDark = document.documentElement.classList.contains("dark");
    const gridColor = isDark
      ? "rgba(255, 255, 255, 0.05)"
      : "rgba(0, 0, 0, 0.05)";

    context.save();
    context.scale(dpr, dpr);
    context.strokeStyle = gridColor;
    context.lineWidth = 1;

    const innerWidth = ctx.width - ctx.margin.left - ctx.margin.right;
    const innerHeight = ctx.height - ctx.margin.top - ctx.margin.bottom;

    // Draw vertical grid lines (one for each x category)
    for (let i = 0; i <= ctx.xCategories.length; i++) {
      const x = ctx.margin.left + (i / ctx.xCategories.length) * innerWidth;
      context.beginPath();
      context.moveTo(x, ctx.margin.top);
      context.lineTo(x, ctx.height - ctx.margin.bottom);
      context.stroke();
    }

    // Draw horizontal grid lines (one for each y category)
    for (let i = 0; i <= ctx.yCategories.length; i++) {
      const y = ctx.margin.top + (i / ctx.yCategories.length) * innerHeight;
      context.beginPath();
      context.moveTo(ctx.margin.left, y);
      context.lineTo(ctx.width - ctx.margin.right, y);
      context.stroke();
    }

    context.restore();
  }, [
    ctx.overlayRef,
    ctx.width,
    ctx.height,
    ctx.margin,
    ctx.devicePixelRatio,
    ctx.xCategories.length,
    ctx.yCategories.length,
  ]);

  return null;
}

function Tooltip() {
  const ctx = useHeatmapChart();

  const handleHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (
      x < ctx.margin.left ||
      x > ctx.width - ctx.margin.right ||
      y < ctx.margin.top ||
      y > ctx.height - ctx.margin.bottom
    ) {
      ctx.setHoveredPoint(null);
      ctx.setTooltipData(null);
      return;
    }

    const innerWidth = ctx.width - ctx.margin.left - ctx.margin.right;
    const innerHeight = ctx.height - ctx.margin.top - ctx.margin.bottom;
    const cellWidth = innerWidth / ctx.xCategoryMap.size;
    const cellHeight = innerHeight / ctx.yCategoryMap.size;

    const relX = x - ctx.margin.left;
    const relY = y - ctx.margin.top;

    const xIdx = Math.floor(relX / cellWidth);
    const yIdx = Math.floor((innerHeight - relY) / cellHeight);

    if (
      xIdx < 0 ||
      xIdx >= ctx.xCategories.length ||
      yIdx < 0 ||
      yIdx >= ctx.yCategories.length
    ) {
      ctx.setHoveredPoint(null);
      ctx.setTooltipData(null);
      return;
    }

    const xCat = ctx.xCategories[xIdx];
    const yCat = ctx.yCategories[yIdx];

    // Find the data point
    const dataPoint = ctx.data.find((d) => d.x === xCat && d.y === yCat);

    if (dataPoint) {
      // Only update if the hovered cell has changed
      const cellChanged =
        !ctx.hoveredPoint ||
        !ctx.tooltipData ||
        ctx.tooltipData.items[0].value !== String(dataPoint.x) ||
        ctx.tooltipData.items[1].value !== String(dataPoint.y);

      if (cellChanged) {
        const screenX = ctx.margin.left + xIdx * cellWidth + cellWidth / 2;
        const screenY =
          ctx.margin.top +
          (ctx.yCategories.length - yIdx - 1) * cellHeight +
          cellHeight / 2;

        ctx.setHoveredPoint({
          seriesIdx: 0,
          pointIdx: 0,
          screenX,
          screenY,
        });

        ctx.setTooltipData({
          title: "Heatmap Cell",
          items: [
            { label: "X", value: String(dataPoint.x) },
            { label: "Y", value: String(dataPoint.y) },
            { label: "Value", value: dataPoint.value.toFixed(2) },
          ],
        });
      }
    } else {
      if (ctx.hoveredPoint !== null) {
        ctx.setHoveredPoint(null);
        ctx.setTooltipData(null);
      }
    }
  };

  return <ChartTooltip onHover={handleHover} />;
}

// ============================================================================
// Composed Component (Simple API)
// ============================================================================

export function HeatmapChart({
  data,
  xAxis = {},
  yAxis = {},
  width = 800,
  height = 400,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  aspectRatio,
  margin,
  showGrid = false,
  showAxes = true,
  showTooltip = false,
  preferWebGPU = true,
  colorScale = defaultColorScale,
  minValue,
  maxValue,
  cellGap = 2,
  className,
}: HeatmapChartProps) {
  return (
    <Root
      data={data}
      xAxis={xAxis}
      yAxis={yAxis}
      width={width}
      height={height}
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      aspectRatio={aspectRatio}
      margin={margin}
      preferWebGPU={preferWebGPU}
      colorScale={colorScale}
      minValue={minValue}
      maxValue={maxValue}
      cellGap={cellGap}
      className={className}
    >
      <Canvas />
      {showGrid && <Grid />}
      {showAxes && <ChartAxes />}
      {showTooltip && <Tooltip />}
    </Root>
  );
}

// ============================================================================
// Primitive API (Composable)
// ============================================================================

/**
 * HeatmapChart Primitives - Composable chart components for custom layouts
 *
 * @example Simple usage (monolithic)
 * ```tsx
 * <HeatmapChart data={data} showGrid showAxes showTooltip />
 * ```
 *
 * @example Advanced usage (composable)
 * ```tsx
 * <HeatmapChart.Root data={data} colorScale="viridis" width={800} height={400}>
 *   <HeatmapChart.Canvas />
 *   <HeatmapChart.Grid />
 *   <HeatmapChart.Axes />
 *   <HeatmapChart.Tooltip />
 * </HeatmapChart.Root>
 * ```
 */
HeatmapChart.Root = Root;
HeatmapChart.Canvas = Canvas;
HeatmapChart.Grid = Grid;
HeatmapChart.Axes = ChartAxes;
HeatmapChart.Tooltip = Tooltip;

export interface HeatmapChartRootProps {
  data: DataPoint[];
  xAxis?: {
    label?: string;
    formatter?: (value: number | string) => string;
  };
  yAxis?: {
    label?: string;
    formatter?: (value: number | string) => string;
  };
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  preferWebGPU?: boolean;
  colorScale?: (t: number) => [number, number, number];
  minValue?: number;
  maxValue?: number;
  cellGap?: number;
  className?: string;
  children?: React.ReactNode;
}

