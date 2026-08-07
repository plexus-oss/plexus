/**
 * Radar Chart Component
 *
 * A GPU-accelerated polar radar display for multi-series data visualization.
 * Ideal for tracking, telemetry, and comparative analysis across multiple metrics.
 *
 * Features:
 * - Multi-series polar plotting
 * - Concentric rings for magnitude
 * - Radial sector divisions
 * - Optional animated radar sweep
 * - Customizable ring and sector counts
 * - WebGPU-accelerated rendering with WebGL fallback
 *
 * @example
 * ```tsx
 * import { RadarChart } from "@/components/charts";
 *
 * <RadarChart
 *   series={[
 *     { id: "target-1", data: [{angle: 45, distance: 0.8}], color: "#00ff00" }
 *   ]}
 *   rings={5}
 *   sectors={12}
 *   showSweep={true}
 * />
 * ```
 *
 * @module radar-chart
 */
"use client";

import { createContext, useContext, useRef, useEffect, useState } from "react";
import {
  createWebGLRenderer,
  createWebGPURenderer,
  ChartRoot,
  ChartTooltip,
  hexToRgb,
  type RendererProps,
  type WebGLRenderer,
  type WebGPURenderer,
  useBaseChart,
} from "./base-chart";

// ============================================================================
// Radar Chart Types
// ============================================================================

export interface RadarDataPoint {
  /**
   * Angular position in degrees (0-360)
   * 0° is North, increases clockwise
   */
  angle: number;

  /**
   * Distance from center (normalized 0-1)
   * 0 = center, 1 = outer edge
   */
  distance: number;

  /**
   * Optional label for this data point
   */
  label?: string;

  /**
   * Color intensity for this point (0-1)
   * @default 1
   */
  intensity?: number;
}

export interface RadarSeries {
  /**
   * Display name for this data series
   * @required
   */
  name: string;

  /**
   * Array of data points for this series
   * @required
   */
  data: RadarDataPoint[];

  /**
   * Color for this series
   * Supports any valid CSS color value
   * @default "#3b82f6"
   */
  color?: string;

  /**
   * Display trail effect for moving targets
   * @default false
   */
  showTrail?: boolean;

  /**
   * Length of trail in number of points
   * @default 5
   */
  trailLength?: number;

  /**
   * Connect points as a continuous line (for patterns like antenna radiation)
   * Points will be sorted by angle and connected
   * @default false
   */
  connectPoints?: boolean;

  /**
   * Fill the connected polygon area
   * Only applies when connectPoints is true
   * @default false
   */
  fillArea?: boolean;
}

export interface RadarChartProps {
  /**
   * Array of data series to display on the radar
   * @required
   */
  series: RadarSeries[];

  /**
   * Number of concentric rings (distance markers)
   * @default 4
   */
  rings?: number;

  /**
   * Number of radial sectors (angular divisions)
   * @default 12
   */
  sectors?: number;

  /**
   * Enable animated radar sweep effect
   * @default true
   */
  showSweep?: boolean;

  /**
   * Radar sweep rotation speed (degrees per second)
   * @default 2
   */
  sweepSpeed?: number;

  /**
   * Display grid lines (rings and sectors)
   * @default true
   */
  showGrid?: boolean;

  /**
   * Display cardinal direction labels (N, E, S, W)
   * @default true
   */
  showLabels?: boolean;

  /**
   * Width of the radar chart
   * Supports fixed pixel values or responsive units (e.g., "100%", "50vw")
   * @default 500
   */
  width?: number | string;

  /**
   * Height of the radar chart
   * Supports fixed pixel values or responsive units (e.g., "100%", "50vh")
   * @default 500
   */
  height?: number | string;

  /**
   * Additional CSS classes to apply to the container
   */
  className?: string;

  /**
   * Prefer WebGPU over WebGL for rendering
   * Falls back to WebGL if WebGPU is not available
   * @default false
   */
  preferWebGPU?: boolean;
}

interface RadarChartContextType {
  series: RadarSeries[];
  rings: number;
  sectors: number;
  showSweep: boolean;
  sweepSpeed: number;
  showGrid: boolean;
  showLabels: boolean;
  sweepAngle: number;
}

const RadarChartContext = createContext<RadarChartContextType | null>(null);

function useRadarChartData() {
  const ctx = useContext(RadarChartContext);
  if (!ctx) {
    throw new Error("Radar components must be used within RadarChart.Root");
  }
  return ctx;
}

function useRadarChart() {
  const baseCtx = useBaseChart();
  const radarCtx = useRadarChartData();
  return { ...baseCtx, ...radarCtx };
}

// ============================================================================
// Shaders
// ============================================================================

const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec4 a_color;

uniform vec2 u_resolution;

varying vec4 v_color;

void main() {
  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
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

const POINT_VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec4 a_color;
attribute float a_size;

uniform vec2 u_resolution;

varying vec4 v_color;

void main() {
  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;

  gl_Position = vec4(clipSpace, 0.0, 1.0);
  gl_PointSize = a_size;
  v_color = a_color;
}
`;

const POINT_FRAGMENT_SHADER = `
precision mediump float;
varying vec4 v_color;

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) {
    discard;
  }
  gl_FragColor = v_color;
}
`;

// WGSL Shaders for WebGPU
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
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  var clipSpace = (input.position / uniforms.resolution) * 2.0 - 1.0;
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
// Radar Renderers
// ============================================================================

interface RadarRendererProps extends RendererProps {
  series: RadarSeries[];
  rings: number;
  sectors: number;
  showSweep: boolean;
  sweepAngle: number;
}

function createCircleGeometry(
  centerX: number,
  centerY: number,
  radius: number,
  color: [number, number, number],
  alpha: number,
  segments = 64
) {
  const positions: number[] = [];
  const colors: number[] = [];

  for (let i = 0; i < segments; i++) {
    const angle1 = (i / segments) * Math.PI * 2;
    const angle2 = ((i + 1) / segments) * Math.PI * 2;

    const x1 = centerX + radius * Math.cos(angle1);
    const y1 = centerY + radius * Math.sin(angle1);
    const x2 = centerX + radius * Math.cos(angle2);
    const y2 = centerY + radius * Math.sin(angle2);

    positions.push(x1, y1, x2, y2);
    colors.push(...color, alpha, ...color, alpha);
  }

  return { positions, colors };
}

function createSweepGeometry(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
  color: [number, number, number],
  sweepWidth = Math.PI / 6
) {
  const positions: number[] = [];
  const colors: number[] = [];

  const segments = 32;
  const startAngle = angle - sweepWidth;

  for (let i = 0; i < segments; i++) {
    const a = startAngle + (i / segments) * sweepWidth;
    const alpha = i / segments;

    const x = centerX + radius * Math.cos(a);
    const y = centerY + radius * Math.sin(a);

    positions.push(centerX, centerY, x, y);
    colors.push(...color, 0, ...color, alpha * 0.8); // Increased opacity from 0.3 to 0.8
  }

  return { positions, colors };
}

function createWebGLRadarRenderer(
  canvas: HTMLCanvasElement
): WebGLRenderer<RadarRendererProps> {
  const lineBuffers = {
    position: null as WebGLBuffer | null,
    color: null as WebGLBuffer | null,
  };

  const pointBuffers = {
    position: null as WebGLBuffer | null,
    color: null as WebGLBuffer | null,
    size: null as WebGLBuffer | null,
  };

  let lineProgram: WebGLProgram | null = null;
  let pointProgram: WebGLProgram | null = null;

  const renderer = createWebGLRenderer<RadarRendererProps>({
    canvas,
    createShaders: () => ({
      vertexSource: VERTEX_SHADER,
      fragmentSource: FRAGMENT_SHADER,
    }),
    onRender: (gl, program, props) => {
      const { series, rings, sectors, showSweep, sweepAngle, width, height } =
        props;

      if (!lineProgram) {
        lineProgram = program;
      }

      // Create point program if needed
      if (!pointProgram) {
        const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vertexShader, POINT_VERTEX_SHADER);
        gl.compileShader(vertexShader);

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fragmentShader, POINT_FRAGMENT_SHADER);
        gl.compileShader(fragmentShader);

        pointProgram = gl.createProgram()!;
        gl.attachShader(pointProgram, vertexShader);
        gl.attachShader(pointProgram, fragmentShader);
        gl.linkProgram(pointProgram);
      }

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.42;

      // === DRAW GRID LINES ===
      gl.useProgram(lineProgram);
      const resolutionLoc = gl.getUniformLocation(lineProgram, "u_resolution");
      gl.uniform2f(resolutionLoc, width, height);

      const linePositions: number[] = [];
      const lineColors: number[] = [];

      // Draw concentric rings
      // Use brighter colors with higher opacity for better visibility
      const gridColor = hexToRgb("#64748b"); // Lighter slate color
      for (let i = 1; i <= rings; i++) {
        const r = (radius * i) / rings;
        const { positions, colors } = createCircleGeometry(
          centerX,
          centerY,
          r,
          gridColor,
          0.6 // Increased opacity
        );
        linePositions.push(...positions);
        lineColors.push(...colors);
      }

      // Draw radial lines (sectors)
      for (let i = 0; i < sectors; i++) {
        const angle = (i / sectors) * Math.PI * 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);

        linePositions.push(centerX, centerY, x, y);
        lineColors.push(...gridColor, 0.6, ...gridColor, 0.6); // Increased opacity
      }

      // Draw sweep
      if (showSweep) {
        const sweepColor = hexToRgb("#3b82f6");
        const { positions, colors } = createSweepGeometry(
          centerX,
          centerY,
          radius,
          sweepAngle,
          sweepColor
        );
        linePositions.push(...positions);
        lineColors.push(...colors);
      }

      // Upload and draw lines
      if (!lineBuffers.position) {
        lineBuffers.position = gl.createBuffer();
      }
      if (!lineBuffers.color) {
        lineBuffers.color = gl.createBuffer();
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffers.position);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(linePositions),
        gl.DYNAMIC_DRAW
      );
      const positionLoc = gl.getAttribLocation(lineProgram, "a_position");
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffers.color);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(lineColors),
        gl.DYNAMIC_DRAW
      );
      const colorLoc = gl.getAttribLocation(lineProgram, "a_color");
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.LINES, 0, linePositions.length / 2);

      // === DRAW CONNECTED PATTERNS (like antenna radiation) ===
      for (const s of series) {
        if (s.connectPoints && s.data.length > 1) {
          const color = hexToRgb(s.color || "#3b82f6");

          // Sort points by angle for proper connection
          const sortedPoints = [...s.data].sort((a, b) => a.angle - b.angle);

          const patternPositions: number[] = [];
          const patternColors: number[] = [];

          // Draw lines connecting consecutive points
          for (let i = 0; i < sortedPoints.length; i++) {
            const point = sortedPoints[i];
            const nextPoint = sortedPoints[(i + 1) % sortedPoints.length];

            const angleRad1 = (point.angle * Math.PI) / 180 - Math.PI / 2;
            const dist1 = point.distance * radius;
            const x1 = centerX + dist1 * Math.cos(angleRad1);
            const y1 = centerY + dist1 * Math.sin(angleRad1);

            const angleRad2 = (nextPoint.angle * Math.PI) / 180 - Math.PI / 2;
            const dist2 = nextPoint.distance * radius;
            const x2 = centerX + dist2 * Math.cos(angleRad2);
            const y2 = centerY + dist2 * Math.sin(angleRad2);

            patternPositions.push(x1, y1, x2, y2);
            patternColors.push(...color, 0.9, ...color, 0.9);
          }

          // Draw the pattern lines using line program
          gl.useProgram(lineProgram);
          gl.uniform2f(resolutionLoc, width, height);

          gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffers.position);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(patternPositions),
            gl.DYNAMIC_DRAW
          );
          gl.enableVertexAttribArray(positionLoc);
          gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

          gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffers.color);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(patternColors),
            gl.DYNAMIC_DRAW
          );
          gl.enableVertexAttribArray(colorLoc);
          gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);

          gl.drawArrays(gl.LINES, 0, patternPositions.length / 2);
        }
      }

      // === DRAW POINTS (for non-connected series) ===
      gl.useProgram(pointProgram);
      const pointResolutionLoc = gl.getUniformLocation(
        pointProgram,
        "u_resolution"
      );
      gl.uniform2f(pointResolutionLoc, width, height);

      const pointPositions: number[] = [];
      const pointColors: number[] = [];
      const pointSizes: number[] = [];

      for (const s of series) {
        // Skip connected series - they're drawn as lines above
        if (s.connectPoints) continue;

        const color = hexToRgb(s.color || "#3b82f6");

        for (const point of s.data) {
          const angleRad = (point.angle * Math.PI) / 180 - Math.PI / 2;
          const dist = point.distance * radius;

          const x = centerX + dist * Math.cos(angleRad);
          const y = centerY + dist * Math.sin(angleRad);

          pointPositions.push(x, y);
          const intensity = point.intensity ?? 1;
          pointColors.push(...color, intensity);
          pointSizes.push(8);
        }
      }

      if (pointPositions.length > 0) {
        if (!pointBuffers.position) {
          pointBuffers.position = gl.createBuffer();
        }
        if (!pointBuffers.color) {
          pointBuffers.color = gl.createBuffer();
        }
        if (!pointBuffers.size) {
          pointBuffers.size = gl.createBuffer();
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffers.position);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array(pointPositions),
          gl.DYNAMIC_DRAW
        );
        const pointPositionLoc = gl.getAttribLocation(pointProgram, "a_position");
        gl.enableVertexAttribArray(pointPositionLoc);
        gl.vertexAttribPointer(pointPositionLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffers.color);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array(pointColors),
          gl.DYNAMIC_DRAW
        );
        const pointColorLoc = gl.getAttribLocation(pointProgram, "a_color");
        gl.enableVertexAttribArray(pointColorLoc);
        gl.vertexAttribPointer(pointColorLoc, 4, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffers.size);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array(pointSizes),
          gl.DYNAMIC_DRAW
        );
        const pointSizeLoc = gl.getAttribLocation(pointProgram, "a_size");
        gl.enableVertexAttribArray(pointSizeLoc);
        gl.vertexAttribPointer(pointSizeLoc, 1, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, pointPositions.length / 2);
      }
    },
  });

  return renderer;
}

async function createWebGPURadarRenderer(
  canvas: HTMLCanvasElement,
  device: GPUDevice
): Promise<WebGPURenderer<RadarRendererProps>> {
  const buffers: {
    position: GPUBuffer | null;
    color: GPUBuffer | null;
    uniform: GPUBuffer | null;
  } = {
    position: null,
    color: null,
    uniform: null,
  };

  return createWebGPURenderer<RadarRendererProps>({
    canvas,
    device,
    createPipeline: (device: GPUDevice, format: GPUTextureFormat) => {
      const shaderModule = device.createShaderModule({
        code: WGSL_SHADER,
      });

      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shaderModule,
          entryPoint: "vertexMain",
          buffers: [
            {
              arrayStride: 2 * 4,
              attributes: [
                {
                  shaderLocation: 0,
                  offset: 0,
                  format: "float32x2",
                },
              ],
            },
            {
              arrayStride: 4 * 4,
              attributes: [
                {
                  shaderLocation: 1,
                  offset: 0,
                  format: "float32x4",
                },
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
        primitive: {
          topology: "line-list",
        },
      });

      return pipeline;
    },
    onRender: async (device, context, pipeline, props) => {
      const { series, rings, sectors, showSweep, sweepAngle, width, height } =
        props;

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.42;

      const linePositions: number[] = [];
      const lineColors: number[] = [];

      // Draw concentric rings
      // Use brighter colors with higher opacity for better visibility
      const gridColor = hexToRgb("#64748b"); // Lighter slate color
      for (let i = 1; i <= rings; i++) {
        const r = (radius * i) / rings;
        const { positions, colors } = createCircleGeometry(
          centerX,
          centerY,
          r,
          gridColor,
          0.6 // Increased opacity
        );
        linePositions.push(...positions);
        lineColors.push(...colors);
      }

      // Draw radial lines (sectors)
      for (let i = 0; i < sectors; i++) {
        const angle = (i / sectors) * Math.PI * 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);

        linePositions.push(centerX, centerY, x, y);
        lineColors.push(...gridColor, 0.6, ...gridColor, 0.6); // Increased opacity
      }

      // Draw sweep
      if (showSweep) {
        const sweepColor = hexToRgb("#3b82f6");
        const { positions, colors } = createSweepGeometry(
          centerX,
          centerY,
          radius,
          sweepAngle,
          sweepColor
        );
        linePositions.push(...positions);
        lineColors.push(...colors);
      }

      // Draw data points as small circles
      for (const s of series) {
        const color = hexToRgb(s.color || "#3b82f6");

        for (const point of s.data) {
          const angleRad = (point.angle * Math.PI) / 180 - Math.PI / 2;
          const dist = point.distance * radius;

          const x = centerX + dist * Math.cos(angleRad);
          const y = centerY + dist * Math.sin(angleRad);

          const intensity = point.intensity ?? 1;
          const pointRadius = 4;
          const segments = 8;

          // Draw point as a small circle made of line segments
          for (let i = 0; i < segments; i++) {
            const angle1 = (i / segments) * Math.PI * 2;
            const angle2 = ((i + 1) / segments) * Math.PI * 2;

            const x1 = x + pointRadius * Math.cos(angle1);
            const y1 = y + pointRadius * Math.sin(angle1);
            const x2 = x + pointRadius * Math.cos(angle2);
            const y2 = y + pointRadius * Math.sin(angle2);

            linePositions.push(x1, y1, x2, y2);
            lineColors.push(...color, intensity, ...color, intensity);
          }
        }
      }

      // Create or update buffers
      const positionData = new Float32Array(linePositions);
      const colorData = new Float32Array(lineColors);

      if (
        !buffers.position ||
        buffers.position.size < positionData.byteLength * 1.5
      ) {
        buffers.position?.destroy();
        buffers.position = device.createBuffer({
          size: Math.ceil(positionData.byteLength * 1.5),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }

      if (!buffers.color || buffers.color.size < colorData.byteLength * 1.5) {
        buffers.color?.destroy();
        buffers.color = device.createBuffer({
          size: Math.ceil(colorData.byteLength * 1.5),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
      }

      device.queue.writeBuffer(buffers.position, 0, positionData);
      device.queue.writeBuffer(buffers.color, 0, colorData);

      // Create uniform buffer
      const uniformData = new Float32Array([width, height]);
      if (!buffers.uniform) {
        buffers.uniform = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      }
      device.queue.writeBuffer(buffers.uniform, 0, uniformData);

      // Create bind group
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: buffers.uniform,
            },
          },
        ],
      });

      // Render
      const commandEncoder = device.createCommandEncoder();
      const textureView = context.getCurrentTexture().createView();

      const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      };

      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setPipeline(pipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.setVertexBuffer(0, buffers.position);
      passEncoder.setVertexBuffer(1, buffers.color);
      passEncoder.draw(linePositions.length / 2, 1, 0, 0);
      passEncoder.end();

      device.queue.submit([commandEncoder.finish()]);
    },
    onDestroy: () => {
      buffers.position?.destroy();
      buffers.color?.destroy();
      buffers.uniform?.destroy();
    },
  });
}

// ============================================================================
// Root Component
// ============================================================================

interface RootProps extends RadarChartProps {
  children: React.ReactNode;
}

function Root({
  children,
  series,
  rings = 4,
  sectors = 12,
  showSweep = true,
  sweepSpeed = 2,
  showGrid = true,
  showLabels = true,
  width = 500,
  height = 500,
  preferWebGPU = false,
  className,
}: RootProps) {
  const [sweepAngle, setSweepAngle] = useState(0);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!showSweep) return;

    let animationFrameId: number;

    const animate = (currentTime: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = currentTime;
      }

      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;

      // Update sweep angle based on delta time (60fps normalized)
      const increment = (sweepSpeed * Math.PI * deltaTime) / (180 * 16.67);
      setSweepAngle((prev) => (prev + increment) % (Math.PI * 2));

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      lastTimeRef.current = 0;
    };
  }, [showSweep, sweepSpeed]);

  const radarData: RadarChartContextType = {
    series,
    rings,
    sectors,
    showSweep,
    sweepSpeed,
    showGrid,
    showLabels,
    sweepAngle,
  };

  return (
    <RadarChartContext.Provider value={radarData}>
      <ChartRoot
        width={width}
        height={height}
        preferWebGPU={preferWebGPU}
        className={className}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        {children}
      </ChartRoot>
    </RadarChartContext.Provider>
  );
}

// ============================================================================
// Canvas Component
// ============================================================================

function Canvas() {
  const ctx = useRadarChart();
  const rendererRef = useRef<
    | WebGLRenderer<RadarRendererProps>
    | WebGPURenderer<RadarRendererProps>
    | null
  >(null);
  const frameRef = useRef<number>(0);

  // Initialize renderer once
  useEffect(() => {
    const canvasRef = ctx.canvasRef;
    const devicePixelRatio = ctx.devicePixelRatio;
    const width = ctx.width;
    const height = ctx.height;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    let mounted = true;

    async function initRenderer() {
      if (!canvas) return;

      try {
        if (ctx.renderMode === "webgpu" && ctx.gpuDevice) {
          const renderer = await createWebGPURadarRenderer(
            canvas,
            ctx.gpuDevice
          );

          if (!mounted) {
            renderer.destroy();
            return;
          }

          rendererRef.current = renderer;
          return;
        }
      } catch (error) {
        console.warn("WebGPU failed, falling back to WebGL:", error);
      }

      try {
        const renderer = createWebGLRadarRenderer(canvas);

        if (!mounted) {
          renderer.destroy();
          return;
        }

        rendererRef.current = renderer;
      } catch (error) {
        console.error("WebGL failed:", error);
      }
    }

    initRenderer();

    return () => {
      mounted = false;
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, [
    ctx.renderMode,
    ctx.gpuDevice,
    ctx.width,
    ctx.height,
    ctx.devicePixelRatio,
    ctx.canvasRef,
  ]);

  // Render when data changes (skip if not visible)
  useEffect(() => {
    const canvas = ctx.canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !ctx.renderMode || !ctx.isVisible) return;

    const dpr = ctx.devicePixelRatio;

    async function render() {
      const currentRenderer = rendererRef.current;
      const currentCanvas = ctx.canvasRef.current;
      if (!currentRenderer || !currentCanvas) return;

      const renderProps: RadarRendererProps = {
        canvas: currentCanvas,
        series: ctx.series,
        rings: ctx.rings,
        sectors: ctx.sectors,
        showSweep: ctx.showSweep,
        sweepAngle: ctx.sweepAngle,
        width: ctx.width * dpr,
        height: ctx.height * dpr,
        margin: {
          top: ctx.margin.top * dpr,
          right: ctx.margin.right * dpr,
          bottom: ctx.margin.bottom * dpr,
          left: ctx.margin.left * dpr,
        },
        xDomain: [0, 1],
        yDomain: [0, 1],
        xTicks: [],
        yTicks: [],
        showGrid: ctx.showGrid,
      };

      await currentRenderer.render(renderProps);

      // Continue animation loop if sweep is enabled
      if (ctx.showSweep) {
        frameRef.current = requestAnimationFrame(render);
      }
    }

    // Start render loop
    frameRef.current = requestAnimationFrame(render);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [
    ctx.series,
    ctx.rings,
    ctx.sectors,
    ctx.showSweep,
    ctx.sweepAngle,
    ctx.showGrid,
    ctx.width,
    ctx.height,
    ctx.margin,
    ctx.devicePixelRatio,
    ctx.renderMode,
    ctx.canvasRef,
    ctx.isVisible,
  ]);

  const { canvasRef, width: ctxWidth, height: ctxHeight } = ctx;
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{
        width: `${ctxWidth}px`,
        height: `${ctxHeight}px`,
      }}
    />
  );
}

// ============================================================================
// Labels Component
// ============================================================================

function Labels() {
  const ctx = useRadarChart();

  if (!ctx.showLabels) return null;

  const centerX = ctx.width / 2;
  const centerY = ctx.height / 2;
  const radius = Math.min(ctx.width, ctx.height) * 0.47;

  const cardinalDirections = [
    { angle: 0, label: "N" },
    { angle: 90, label: "E" },
    { angle: 180, label: "S" },
    { angle: 270, label: "W" },
  ];

  return (
    <>
      {cardinalDirections.map(({ angle, label }) => {
        const angleRad = (angle * Math.PI) / 180 - Math.PI / 2;
        const x = centerX + radius * Math.cos(angleRad);
        const y = centerY + radius * Math.sin(angleRad);

        return (
          <div
            key={angle}
            className="absolute text-sm font-semibold text-zinc-400 pointer-events-none"
            style={{
              left: x,
              top: y,
              transform: "translate(-50%, -50%)",
            }}
          >
            {label}
          </div>
        );
      })}
    </>
  );
}

// ============================================================================
// Tooltip Component
// ============================================================================

interface ClosestPoint {
  seriesIdx: number;
  pointIdx: number;
  distance: number;
  point: RadarDataPoint;
  screenX: number;
  screenY: number;
}

function Tooltip() {
  const ctx = useRadarChart();

  const handleHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const centerX = ctx.width / 2;
    const centerY = ctx.height / 2;
    const radius = Math.min(ctx.width, ctx.height) * 0.42;

    let closestPoint: ClosestPoint | null = null as ClosestPoint | null;

    // Find closest data point
    ctx.series.forEach((series, seriesIdx) => {
      series.data.forEach((point, pointIdx) => {
        const angleRad = (point.angle * Math.PI) / 180 - Math.PI / 2;
        const dist = point.distance * radius;

        const screenX = centerX + dist * Math.cos(angleRad);
        const screenY = centerY + dist * Math.sin(angleRad);

        const distanceToMouse = Math.sqrt(
          Math.pow(mouseX - screenX, 2) + Math.pow(mouseY - screenY, 2)
        );

        if (distanceToMouse < 15) {
          // Within 15px threshold
          if (!closestPoint || distanceToMouse < closestPoint.distance) {
            closestPoint = {
              seriesIdx,
              pointIdx,
              distance: distanceToMouse,
              point,
              screenX,
              screenY,
            };
          }
        }
      });
    });

    if (closestPoint !== null) {
      ctx.setHoveredPoint({
        seriesIdx: closestPoint.seriesIdx,
        pointIdx: closestPoint.pointIdx,
        screenX: closestPoint.screenX,
        screenY: closestPoint.screenY,
      });

      const series = ctx.series[closestPoint.seriesIdx];
      ctx.setTooltipData({
        title:
          closestPoint.point?.label || `Target ${closestPoint.pointIdx + 1}`,
        items: [
          { label: "Category", value: series.name },
          { label: "Angle", value: `${closestPoint.point.angle.toFixed(1)}°` },
          {
            label: "Distance",
            value: `${(closestPoint.point.distance * 100).toFixed(1)}%`,
          },
          ...(closestPoint.point.intensity !== undefined
            ? [
                {
                  label: "Intensity",
                  value: `${(closestPoint.point.intensity * 100).toFixed(0)}%`,
                },
              ]
            : []),
        ],
      });
    } else {
      ctx.setHoveredPoint(null);
      ctx.setTooltipData(null);
    }
  };

  return (
    <>
      <ChartTooltip onHover={handleHover} />
      {ctx.hoveredPoint && (
        <div
          className="absolute pointer-events-none z-20"
          style={{
            left: ctx.hoveredPoint.screenX - 8,
            top: ctx.hoveredPoint.screenY - 8,
          }}
        >
          <div
            className="w-4 h-4 rounded-full border-2 border-white dark:border-zinc-900"
            style={{
              backgroundColor:
                ctx.series[ctx.hoveredPoint.seriesIdx].color || "#3b82f6",
            }}
          />
        </div>
      )}
    </>
  );
}

// ============================================================================
// Composed Component
// ============================================================================

export function RadarChart(props: RadarChartProps) {
  return (
    <Root {...props}>
      <Canvas />
      <Labels />
      <Tooltip />
    </Root>
  );
}

RadarChart.Root = Root;
RadarChart.Canvas = Canvas;
RadarChart.Labels = Labels;
RadarChart.Tooltip = Tooltip;

