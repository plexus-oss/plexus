/**
 * Attitude Indicator Component
 *
 * A GPU-accelerated artificial horizon instrument for aviation and aerospace applications.
 * Displays aircraft pitch and roll orientation relative to the horizon.
 *
 * Features:
 * - Real-time pitch and roll visualization
 * - Pitch ladder with degree markings
 * - Bank angle indicator with arc
 * - Sky/ground color-coded hemispheres
 * - Fixed aircraft symbol
 * - WebGPU-accelerated rendering with WebGL fallback
 *
 * @example
 * ```tsx
 * import { AttitudeIndicator } from "@/components/charts";
 *
 * <AttitudeIndicator
 *   pitch={10}
 *   roll={-15}
 *   width={400}
 *   height={400}
 * />
 * ```
 *
 * @module attitude-indicator
 */
"use client";

import { createContext, useContext, useRef, useEffect } from "react";
import {
  createWebGLRenderer,
  createWebGPURenderer,
  ChartRoot,
  hexToRgb,
  type RendererProps,
  type WebGLRenderer,
  type WebGPURenderer,
  useBaseChart,
} from "./base-chart";

// ============================================================================
// Attitude Indicator Types
// ============================================================================

export interface AttitudeIndicatorProps {
  /**
   * Pitch angle in degrees (-90 to +90)
   * Positive values indicate nose up, negative values indicate nose down
   * @default 0
   */
  pitch?: number;

  /**
   * Roll angle in degrees (-180 to +180)
   * Positive values indicate right wing down, negative values indicate left wing down
   * @default 0
   */
  roll?: number;

  /**
   * Width of the indicator
   * Supports fixed pixel values or responsive units (e.g., "100%", "50vw")
   * @default 400
   */
  width?: number | string;

  /**
   * Height of the indicator
   * Supports fixed pixel values or responsive units (e.g., "100%", "50vh")
   * @default 400
   */
  height?: number | string;

  /**
   * Display pitch ladder with degree markings
   * @default true
   */
  showPitchLadder?: boolean;

  /**
   * Display bank angle indicator arc
   * @default true
   */
  showBankIndicator?: boolean;

  /**
   * Degrees between each pitch ladder mark
   * @default 10
   */
  pitchStep?: number;

  /**
   * Sky hemisphere color
   * Supports any valid CSS color value
   * @default "transparent"
   */
  skyColor?: string;

  /**
   * Ground hemisphere color
   * Supports any valid CSS color value
   * @default "#19191c"
   */
  groundColor?: string;

  /**
   * Horizon line color
   * Supports any valid CSS color value
   * @default "#9ca3af"
   */
  horizonColor?: string;

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

interface AttitudeIndicatorContextType {
  pitch: number;
  roll: number;
  showPitchLadder: boolean;
  showBankIndicator: boolean;
  pitchStep: number;
  skyColor: string;
  groundColor: string;
  horizonColor: string;
}

const AttitudeIndicatorContext =
  createContext<AttitudeIndicatorContextType | null>(null);

function useAttitudeIndicatorData() {
  const ctx = useContext(AttitudeIndicatorContext);
  if (!ctx) {
    throw new Error(
      "AttitudeIndicator components must be used within AttitudeIndicator.Root"
    );
  }
  return ctx;
}

function useAttitudeIndicator() {
  const baseCtx = useBaseChart();
  const attitudeCtx = useAttitudeIndicatorData();
  return { ...baseCtx, ...attitudeCtx };
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
// Geometry Helpers
// ============================================================================

function createRotatedRectangle(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  angle: number,
  color: [number, number, number],
  alpha: number = 1
) {
  const positions: number[] = [];
  const colors: number[] = [];

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const halfW = width / 2;
  const halfH = height / 2;

  const corners = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];

  const rotatedCorners = corners.map(([x, y]) => [
    centerX + x * cos - y * sin,
    centerY + x * sin + y * cos,
  ]);

  // Two triangles
  positions.push(
    rotatedCorners[0][0],
    rotatedCorners[0][1],
    rotatedCorners[1][0],
    rotatedCorners[1][1],
    rotatedCorners[2][0],
    rotatedCorners[2][1]
  );
  positions.push(
    rotatedCorners[0][0],
    rotatedCorners[0][1],
    rotatedCorners[2][0],
    rotatedCorners[2][1],
    rotatedCorners[3][0],
    rotatedCorners[3][1]
  );

  for (let i = 0; i < 6; i++) {
    colors.push(...color, alpha);
  }

  return { positions, colors };
}

function createLineGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: [number, number, number],
  alpha: number = 1
) {
  const positions: number[] = [];
  const colors: number[] = [];

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len;
  const ny = dx / len;

  const halfWidth = width / 2;

  positions.push(
    x1 + nx * halfWidth,
    y1 + ny * halfWidth,
    x2 + nx * halfWidth,
    y2 + ny * halfWidth,
    x1 - nx * halfWidth,
    y1 - ny * halfWidth
  );
  positions.push(
    x2 + nx * halfWidth,
    y2 + ny * halfWidth,
    x2 - nx * halfWidth,
    y2 - ny * halfWidth,
    x1 - nx * halfWidth,
    y1 - ny * halfWidth
  );

  for (let i = 0; i < 6; i++) {
    colors.push(...color, alpha);
  }

  return { positions, colors };
}

function createPitchLadder(
  centerX: number,
  centerY: number,
  radius: number,
  pitch: number,
  roll: number,
  pitchStep: number,
  color: [number, number, number]
) {
  const positions: number[] = [];
  const colors: number[] = [];

  const rollRad = (roll * Math.PI) / 180;
  const pixelsPerDegree = radius / 45; // 45 degrees fills the radius

  // Draw pitch lines from -90 to +90 degrees
  for (let p = -90; p <= 90; p += pitchStep) {
    if (p === 0) continue; // Skip horizon line

    const offset = (pitch - p) * pixelsPerDegree;

    // Check if this pitch line is visible
    if (Math.abs(offset) > radius * 1.5) continue;

    const lineLength = Math.abs(p) % 10 === 0 ? 80 : 50;
    const lineWidth = Math.abs(p) % 10 === 0 ? 3 : 2;

    // Rotate the line based on roll
    const cos = Math.cos(rollRad);
    const sin = Math.sin(rollRad);

    const x1 = centerX + (-lineLength / 2) * cos - offset * sin;
    const y1 = centerY + (-lineLength / 2) * sin + offset * cos;
    const x2 = centerX + (lineLength / 2) * cos - offset * sin;
    const y2 = centerY + (lineLength / 2) * sin + offset * cos;

    const geom = createLineGeometry(x1, y1, x2, y2, lineWidth, color, 0.9);
    positions.push(...geom.positions);
    colors.push(...geom.colors);
  }

  return { positions, colors };
}

function createBankIndicator(
  centerX: number,
  centerY: number,
  radius: number,
  roll: number,
  color: [number, number, number]
) {
  const positions: number[] = [];
  const colors: number[] = [];

  const indicatorRadius = radius + 15;
  const majorMarks = [0, -30, -60, 30, 60];
  const minorMarks = [-10, -20, -45, 10, 20, 45];

  // Draw arc marks
  for (const angle of majorMarks) {
    const rad = ((angle - 90) * Math.PI) / 180;
    const x1 = centerX + indicatorRadius * Math.cos(rad);
    const y1 = centerY + indicatorRadius * Math.sin(rad);
    const x2 = centerX + (indicatorRadius - 15) * Math.cos(rad);
    const y2 = centerY + (indicatorRadius - 15) * Math.sin(rad);

    const geom = createLineGeometry(x1, y1, x2, y2, 3, color, 0.8);
    positions.push(...geom.positions);
    colors.push(...geom.colors);
  }

  for (const angle of minorMarks) {
    const rad = ((angle - 90) * Math.PI) / 180;
    const x1 = centerX + indicatorRadius * Math.cos(rad);
    const y1 = centerY + indicatorRadius * Math.sin(rad);
    const x2 = centerX + (indicatorRadius - 8) * Math.cos(rad);
    const y2 = centerY + (indicatorRadius - 8) * Math.sin(rad);

    const geom = createLineGeometry(x1, y1, x2, y2, 2, color, 0.6);
    positions.push(...geom.positions);
    colors.push(...geom.colors);
  }

  // Draw triangle pointer at current roll angle
  const rollRad = ((roll - 90) * Math.PI) / 180;
  const pointerX = centerX + (indicatorRadius - 5) * Math.cos(rollRad);
  const pointerY = centerY + (indicatorRadius - 5) * Math.sin(rollRad);

  const triangleSize = 8;
  const perpAngle1 = rollRad + (2 * Math.PI) / 3;
  const perpAngle2 = rollRad - (2 * Math.PI) / 3;

  const p1x = pointerX + triangleSize * Math.cos(rollRad);
  const p1y = pointerY + triangleSize * Math.sin(rollRad);
  const p2x = pointerX + (triangleSize / 2) * Math.cos(perpAngle1);
  const p2y = pointerY + (triangleSize / 2) * Math.sin(perpAngle1);
  const p3x = pointerX + (triangleSize / 2) * Math.cos(perpAngle2);
  const p3y = pointerY + (triangleSize / 2) * Math.sin(perpAngle2);

  positions.push(p1x, p1y, p2x, p2y, p3x, p3y);
  colors.push(...color, 1, ...color, 1, ...color, 1);

  return { positions, colors };
}

function createAircraftSymbol(
  centerX: number,
  centerY: number,
  color: [number, number, number]
) {
  const positions: number[] = [];
  const colors: number[] = [];

  // Center dot
  const dotRadius = 5;
  const segments = 16;
  for (let i = 0; i < segments; i++) {
    const a1 = (i / segments) * Math.PI * 2;
    const a2 = ((i + 1) / segments) * Math.PI * 2;

    const x1 = centerX + dotRadius * Math.cos(a1);
    const y1 = centerY + dotRadius * Math.sin(a1);
    const x2 = centerX + dotRadius * Math.cos(a2);
    const y2 = centerY + dotRadius * Math.sin(a2);

    positions.push(centerX, centerY, x1, y1, x2, y2);
    colors.push(...color, 1, ...color, 1, ...color, 1);
  }

  // Left wing
  const wingY = centerY;
  const wingLeft = centerX - 60;
  const wingLeftInner = centerX - 15;
  const geomLeft = createLineGeometry(
    wingLeft,
    wingY,
    wingLeftInner,
    wingY,
    4,
    color,
    1
  );
  positions.push(...geomLeft.positions);
  colors.push(...geomLeft.colors);

  // Right wing
  const wingRight = centerX + 60;
  const wingRightInner = centerX + 15;
  const geomRight = createLineGeometry(
    wingRightInner,
    wingY,
    wingRight,
    wingY,
    4,
    color,
    1
  );
  positions.push(...geomRight.positions);
  colors.push(...geomRight.colors);

  return { positions, colors };
}

// ============================================================================
// Renderer
// ============================================================================

interface AttitudeRendererProps extends RendererProps {
  pitch: number;
  roll: number;
  showPitchLadder: boolean;
  showBankIndicator: boolean;
  pitchStep: number;
  skyColor: string;
  groundColor: string;
  horizonColor: string;
}

function createWebGLAttitudeRenderer(
  canvas: HTMLCanvasElement
): WebGLRenderer<AttitudeRendererProps> {
  const buffers = {
    position: null as WebGLBuffer | null,
    color: null as WebGLBuffer | null,
  };

  const renderer = createWebGLRenderer<AttitudeRendererProps>({
    canvas,
    createShaders: () => ({
      vertexSource: VERTEX_SHADER,
      fragmentSource: FRAGMENT_SHADER,
    }),
    onRender: (gl, program, props) => {
      const {
        pitch,
        roll,
        showPitchLadder,
        showBankIndicator,
        pitchStep,
        skyColor,
        groundColor,
        horizonColor,
        width,
        height,
      } = props;

      gl.useProgram(program);

      const resolutionLoc = gl.getUniformLocation(program, "u_resolution");
      gl.uniform2f(resolutionLoc, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.35;

      const allPositions: number[] = [];
      const allColors: number[] = [];

      const rollRad = (roll * Math.PI) / 180;
      const pixelsPerDegree = radius / 45;
      const verticalOffset = pitch * pixelsPerDegree;

      // Calculate horizon size - make it large enough to cover entire canvas when rotated
      // Use a very large multiplier to ensure no gaps at any rotation angle
      const canvasDiagonal = Math.sqrt(width * width + height * height);
      const horizonSize = canvasDiagonal * 3; // 3x diagonal ensures full coverage

      // Sky (upper half)
      if (skyColor !== "transparent") {
        const skyRgb = hexToRgb(skyColor);
        const skyGeom = createRotatedRectangle(
          centerX,
          centerY - horizonSize / 2 - verticalOffset,
          horizonSize,
          horizonSize,
          rollRad,
          skyRgb,
          1
        );
        allPositions.push(...skyGeom.positions);
        allColors.push(...skyGeom.colors);
      }

      // Ground (lower half)
      const groundRgb = hexToRgb(groundColor);
      const groundGeom = createRotatedRectangle(
        centerX,
        centerY + horizonSize / 2 - verticalOffset,
        horizonSize,
        horizonSize,
        rollRad,
        groundRgb,
        1
      );
      allPositions.push(...groundGeom.positions);
      allColors.push(...groundGeom.colors);

      // Horizon line
      const horizonRgb = hexToRgb(horizonColor);
      const cos = Math.cos(rollRad);
      const sin = Math.sin(rollRad);
      const horizonLineLength = radius * 2;
      const hx1 =
        centerX + (-horizonLineLength / 2) * cos - -verticalOffset * sin;
      const hy1 =
        centerY + (-horizonLineLength / 2) * sin + -verticalOffset * cos;
      const hx2 =
        centerX + (horizonLineLength / 2) * cos - -verticalOffset * sin;
      const hy2 =
        centerY + (horizonLineLength / 2) * sin + -verticalOffset * cos;

      const horizonGeom = createLineGeometry(
        hx1,
        hy1,
        hx2,
        hy2,
        4,
        horizonRgb,
        1
      );
      allPositions.push(...horizonGeom.positions);
      allColors.push(...horizonGeom.colors);

      // Pitch ladder
      if (showPitchLadder) {
        const ladderColor = hexToRgb("#ffffff");
        const ladderGeom = createPitchLadder(
          centerX,
          centerY,
          radius,
          pitch,
          roll,
          pitchStep,
          ladderColor
        );
        allPositions.push(...ladderGeom.positions);
        allColors.push(...ladderGeom.colors);
      }

      // Bank indicator
      if (showBankIndicator) {
        const bankColor = hexToRgb("#ffffff");
        const bankGeom = createBankIndicator(
          centerX,
          centerY,
          radius,
          roll,
          bankColor
        );
        allPositions.push(...bankGeom.positions);
        allColors.push(...bankGeom.colors);
      }

      // Fixed aircraft symbol (always in center, not rotated)
      const aircraftColor = hexToRgb("#ffff00");
      const aircraftGeom = createAircraftSymbol(
        centerX,
        centerY,
        aircraftColor
      );
      allPositions.push(...aircraftGeom.positions);
      allColors.push(...aircraftGeom.colors);

      // Upload buffers
      if (!buffers.position) {
        buffers.position = gl.createBuffer();
      }
      if (!buffers.color) {
        buffers.color = gl.createBuffer();
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(allPositions),
        gl.STATIC_DRAW
      );
      const positionLoc = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(allColors),
        gl.STATIC_DRAW
      );
      const colorLoc = gl.getAttribLocation(program, "a_color");
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);

      // Draw
      gl.drawArrays(gl.TRIANGLES, 0, allPositions.length / 2);
    },
  });

  return renderer;
}

async function createWebGPUAttitudeRenderer(
  canvas: HTMLCanvasElement,
  device: GPUDevice
): Promise<WebGPURenderer<AttitudeRendererProps>> {
  const buffers: {
    position: GPUBuffer | null;
    color: GPUBuffer | null;
    uniform: GPUBuffer | null;
  } = {
    position: null,
    color: null,
    uniform: null,
  };

  return createWebGPURenderer<AttitudeRendererProps>({
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
          topology: "triangle-list",
        },
      });

      return pipeline;
    },
    onRender: async (device, context, pipeline, props) => {
      const {
        pitch,
        roll,
        showPitchLadder,
        showBankIndicator,
        pitchStep,
        skyColor,
        groundColor,
        horizonColor,
        width,
        height,
      } = props;

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.35;

      const allPositions: number[] = [];
      const allColors: number[] = [];

      const rollRad = (roll * Math.PI) / 180;
      const pixelsPerDegree = radius / 45;
      const verticalOffset = pitch * pixelsPerDegree;

      // Calculate horizon size - make it large enough to cover entire canvas when rotated
      // Use a very large multiplier to ensure no gaps at any rotation angle
      const canvasDiagonal = Math.sqrt(width * width + height * height);
      const horizonSize = canvasDiagonal * 3; // 3x diagonal ensures full coverage

      // Sky (upper half)
      if (skyColor !== "transparent") {
        const skyRgb = hexToRgb(skyColor);
        const skyGeom = createRotatedRectangle(
          centerX,
          centerY - horizonSize / 2 - verticalOffset,
          horizonSize,
          horizonSize,
          rollRad,
          skyRgb,
          1
        );
        allPositions.push(...skyGeom.positions);
        allColors.push(...skyGeom.colors);
      }

      // Ground (lower half)
      const groundRgb = hexToRgb(groundColor);
      const groundGeom = createRotatedRectangle(
        centerX,
        centerY + horizonSize / 2 - verticalOffset,
        horizonSize,
        horizonSize,
        rollRad,
        groundRgb,
        1
      );
      allPositions.push(...groundGeom.positions);
      allColors.push(...groundGeom.colors);

      // Horizon line
      const horizonRgb = hexToRgb(horizonColor);
      const cos = Math.cos(rollRad);
      const sin = Math.sin(rollRad);
      const horizonLineLength = radius * 2;
      const hx1 =
        centerX + (-horizonLineLength / 2) * cos - -verticalOffset * sin;
      const hy1 =
        centerY + (-horizonLineLength / 2) * sin + -verticalOffset * cos;
      const hx2 =
        centerX + (horizonLineLength / 2) * cos - -verticalOffset * sin;
      const hy2 =
        centerY + (horizonLineLength / 2) * sin + -verticalOffset * cos;

      const horizonGeom = createLineGeometry(
        hx1,
        hy1,
        hx2,
        hy2,
        4,
        horizonRgb,
        1
      );
      allPositions.push(...horizonGeom.positions);
      allColors.push(...horizonGeom.colors);

      // Pitch ladder
      if (showPitchLadder) {
        const ladderColor = hexToRgb("#ffffff");
        const ladderGeom = createPitchLadder(
          centerX,
          centerY,
          radius,
          pitch,
          roll,
          pitchStep,
          ladderColor
        );
        allPositions.push(...ladderGeom.positions);
        allColors.push(...ladderGeom.colors);
      }

      // Bank indicator
      if (showBankIndicator) {
        const bankColor = hexToRgb("#ffffff");
        const bankGeom = createBankIndicator(
          centerX,
          centerY,
          radius,
          roll,
          bankColor
        );
        allPositions.push(...bankGeom.positions);
        allColors.push(...bankGeom.colors);
      }

      // Fixed aircraft symbol
      const aircraftColor = hexToRgb("#ffff00");
      const aircraftGeom = createAircraftSymbol(
        centerX,
        centerY,
        aircraftColor
      );
      allPositions.push(...aircraftGeom.positions);
      allColors.push(...aircraftGeom.colors);

      // Create or update buffers
      const positionData = new Float32Array(allPositions);
      const colorData = new Float32Array(allColors);

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
      passEncoder.draw(allPositions.length / 2, 1, 0, 0);
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

interface RootProps extends AttitudeIndicatorProps {
  children: React.ReactNode;
}

function Root({
  children,
  pitch = 0,
  roll = 0,
  width = 400,
  height = 400,
  showPitchLadder = true,
  showBankIndicator = true,
  pitchStep = 10,
  skyColor = "transparent",
  groundColor = "#19191c",
  horizonColor = "#9ca3af",
  preferWebGPU = false,
  className,
}: RootProps) {
  const attitudeData: AttitudeIndicatorContextType = {
    pitch,
    roll,
    showPitchLadder,
    showBankIndicator,
    pitchStep,
    skyColor,
    groundColor,
    horizonColor,
  };

  return (
    <AttitudeIndicatorContext.Provider value={attitudeData}>
      <ChartRoot
        width={width}
        height={height}
        preferWebGPU={preferWebGPU}
        className={className}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        {children}
      </ChartRoot>
    </AttitudeIndicatorContext.Provider>
  );
}

// ============================================================================
// Canvas Component
// ============================================================================

function Canvas() {
  const ctx = useAttitudeIndicator();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<
    | WebGLRenderer<AttitudeRendererProps>
    | WebGPURenderer<AttitudeRendererProps>
    | null
  >(null);
  // In-flight guard for async WebGPU renderer creation. Not used for rendering,
  // so a ref (not state) avoids a setState-in-effect / re-render cycle.
  const isInitializingRef = useRef(false);

  useEffect(() => {
    if (!canvasRef.current || isInitializingRef.current) return;
    if (ctx.renderMode === null) return;

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = ctx.width * dpr;
    canvas.height = ctx.height * dpr;
    canvas.style.width = `${ctx.width}px`;
    canvas.style.height = `${ctx.height}px`;

    const renderProps = () => {
      const props: AttitudeRendererProps = {
        pitch: ctx.pitch,
        roll: ctx.roll,
        showPitchLadder: ctx.showPitchLadder,
        showBankIndicator: ctx.showBankIndicator,
        pitchStep: ctx.pitchStep,
        skyColor: ctx.skyColor,
        groundColor: ctx.groundColor,
        horizonColor: ctx.horizonColor,
        width: canvas.width,
        height: canvas.height,
        margin: ctx.margin,
        xDomain: [0, 1],
        yDomain: [0, 1],
        xTicks: [],
        yTicks: [],
        showGrid: false,
        canvas,
      };

      if (rendererRef.current) {
        rendererRef.current.render(props);
      }
    };

    if (!rendererRef.current) {
      if (ctx.renderMode === "webgpu" && ctx.gpuDevice) {
        isInitializingRef.current = true;
        createWebGPUAttitudeRenderer(canvas, ctx.gpuDevice)
          .then((renderer) => {
            rendererRef.current = renderer;
            isInitializingRef.current = false;
            renderProps();
          })
          .catch((error) => {
            console.error("Failed to create WebGPU renderer:", error);
            rendererRef.current = createWebGLAttitudeRenderer(canvas);
            isInitializingRef.current = false;
            renderProps();
          });
        return;
      } else {
        rendererRef.current = createWebGLAttitudeRenderer(canvas);
      }
    }

    renderProps();
  }, [ctx]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

// ============================================================================
// Value Display Component
// ============================================================================

function ValueDisplay() {
  const ctx = useAttitudeIndicator();

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Pitch display */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded text-sm font-mono">
        <span className="text-zinc-400">PITCH:</span>{" "}
        <span className="text-white font-bold tabular-nums">
          {ctx.pitch > 0 && "+"}
          {ctx.pitch.toFixed(1)}°
        </span>
      </div>

      {/* Roll display */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded text-sm font-mono">
        <span className="text-zinc-400">ROLL:</span>{" "}
        <span className="text-white font-bold tabular-nums">
          {ctx.roll > 0 && "+"}
          {ctx.roll.toFixed(1)}°
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Composed Component
// ============================================================================

export function AttitudeIndicator(props: AttitudeIndicatorProps) {
  return (
    <Root {...props}>
      <Canvas />
    </Root>
  );
}

AttitudeIndicator.Root = Root;
AttitudeIndicator.Canvas = Canvas;
AttitudeIndicator.ValueDisplay = ValueDisplay;

