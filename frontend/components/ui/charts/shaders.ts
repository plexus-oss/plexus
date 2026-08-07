/**
 * Shared shader sources for all chart types.
 *
 * Two variants:
 * - Standard: position + color (+ optional normal/width for lines)
 * - Scatter: position + color + pointCoord for circular SDF
 */

// ============================================================================
// Standard shaders (line, area, bar, grid)
// ============================================================================

/** Line chart vertex shader — uses normal + width attributes for thick lines */
export const LINE_VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_width;

uniform vec2 u_resolution;
uniform mat3 u_matrix;

varying vec4 v_color;

void main() {
  vec2 position = (u_matrix * vec3(a_position, 1.0)).xy;
  vec2 offset = a_normal * a_width * 0.5;
  vec2 clipSpace = ((position + offset) / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
  v_color = a_color;
}
`;

/** Standard vertex shader — position + color only (area fill, bar, grid) */
export const STANDARD_VERTEX_SHADER = `
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

/** Passthrough fragment shader — used by all non-scatter charts */
export const STANDARD_FRAGMENT_SHADER = `
precision mediump float;
varying vec4 v_color;
void main() {
  gl_FragColor = v_color;
}
`;

// ============================================================================
// Scatter shaders (circular points with SDF antialiasing)
// ============================================================================

export const SCATTER_VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec4 a_color;
attribute float a_size;

uniform vec2 u_resolution;
uniform mat3 u_matrix;

varying vec4 v_color;

void main() {
  vec2 position = (u_matrix * vec3(a_position, 1.0)).xy;
  vec2 clipSpace = (position / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
  gl_PointSize = a_size;
  v_color = a_color;
}
`;

export const SCATTER_FRAGMENT_SHADER = `
precision mediump float;
varying vec4 v_color;
void main() {
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);
  if (dist > 0.5) { discard; }
  float alpha = smoothstep(0.5, 0.45, dist);
  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

// ============================================================================
// WGSL shaders (WebGPU)
// ============================================================================

/** Line chart WGSL — uses normal + width for thick lines */
export const LINE_WGSL_SHADER = `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec4f,
  @location(2) normal: vec2f,
  @location(3) width: f32,
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
  let offset = input.normal * input.width * 0.5;
  var clipSpace = ((transformed.xy + offset) / uniforms.resolution) * 2.0 - 1.0;
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

/** Standard WGSL — position + color only (area fill, bar, grid) */
export const STANDARD_WGSL_SHADER = `
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

/** Scatter WGSL — uses pointCoord for circular SDF */
export const SCATTER_WGSL_SHADER = `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec4f,
  @location(2) pointCoord: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) pointCoord: vec2f,
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
  output.pointCoord = input.pointCoord;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let center = input.pointCoord - vec2f(0.5);
  let dist = length(center);
  if (dist > 0.5) { discard; }
  let alpha = smoothstep(0.5, 0.45, dist);
  return vec4f(input.color.rgb, input.color.a * alpha);
}
`;
